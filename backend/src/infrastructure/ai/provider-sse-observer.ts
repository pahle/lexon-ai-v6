export const MAX_PROVIDER_SSE_FRAME_BYTES = 1_048_576;
export const MAX_REASONING_SUMMARY_BYTES = 16_384;

export type ProviderReasoningSignal =
  | { readonly type: 'reasoning-start'; readonly attemptId: string }
  | {
      readonly type: 'reasoning-summary-delta';
      readonly attemptId: string;
      readonly text: string;
    }
  | {
      readonly type: 'reasoning-end';
      readonly attemptId: string;
      readonly durationMs: number | null;
    };

export interface ProviderSseObserver {
  readonly attemptId: string;
  readonly observe: (event: unknown) => Promise<unknown>;
  readonly finish: () => Promise<void>;
}

export function createProviderSseObserver(options: {
  readonly attemptId: string;
  readonly now?: () => number;
  readonly onEvent: (event: ProviderReasoningSignal) => void | Promise<void>;
}): ProviderSseObserver {
  const now = options.now ?? (() => performance.now());
  let signalAt: number | undefined;
  let answerAt: number | undefined;
  let summaryBytes = 0;
  let ended = false;

  const emit = (event: ProviderReasoningSignal) => {
    const result = options.onEvent(event);
    if (result && typeof (result as Promise<void>).then === 'function')
      return result;
  };

  const observe = async (value: unknown): Promise<unknown> => {
    if (!isRecord(value)) return safeFailureFrame();
    if (isRecord(value.error)) return safeErrorFrame();
    if (!Array.isArray(value.choices)) return safeFailureFrame();
    for (const choice of value.choices) {
      if (!isRecord(choice) || !isRecord(choice.delta))
        return safeFailureFrame();
      const delta = choice.delta;
      if (
        Object.hasOwn(delta, 'content') &&
        delta.content !== null &&
        typeof delta.content !== 'string'
      )
        return safeFailureFrame();
      let sawTypedSignal = false;
      const safeDetails: Record<string, unknown>[] = [];
      if (Array.isArray(delta.reasoning_details)) {
        for (const detail of delta.reasoning_details) {
          if (!isRecord(detail) || typeof detail.type !== 'string') continue;
          if (detail.type.startsWith('reasoning.')) {
            sawTypedSignal = true;
          }
          if (
            detail.type !== 'reasoning.summary' ||
            typeof detail.summary !== 'string'
          )
            continue;
          const remaining = Math.max(
            0,
            MAX_REASONING_SUMMARY_BYTES - summaryBytes,
          );
          if (!remaining) continue;
          const text = takeUtf8(detail.summary, remaining);
          if (!text) continue;
          summaryBytes += Buffer.byteLength(text, 'utf8');
          safeDetails.push({ type: 'reasoning.summary', summary: text });
        }
      } else if (Object.hasOwn(delta, 'reasoning_details')) {
        // Malformed typed metadata is discarded before the provider validator sees it.
        delete delta.reasoning_details;
      }
      // Capture both boundaries from the provider frame before awaiting downstream
      // queue/database/publication work, which may apply backpressure.
      const firstSignal = sawTypedSignal && signalAt === undefined;
      if (firstSignal) signalAt = now();
      const answerPresent =
        typeof delta.content === 'string' && delta.content.length > 0;
      if (answerPresent && answerAt === undefined) answerAt = now();
      if (firstSignal) {
        await emit({ type: 'reasoning-start', attemptId: options.attemptId });
      }
      for (const detail of safeDetails)
        await emit({
          type: 'reasoning-summary-delta',
          attemptId: options.attemptId,
          text: detail.summary as string,
        });
      delete delta.reasoning;
      if (Array.isArray(delta.reasoning_details)) {
        if (safeDetails.length) delta.reasoning_details = safeDetails;
        else delete delta.reasoning_details;
      }
      if (signalAt !== undefined && answerAt !== undefined && !ended) {
        ended = true;
        await emit({
          type: 'reasoning-end',
          attemptId: options.attemptId,
          durationMs: Math.max(0, Math.round(answerAt - signalAt)),
        });
      }
    }
    return value;
  };

  return {
    attemptId: options.attemptId,
    observe,
    async finish() {
      if (signalAt !== undefined && !ended) {
        ended = true;
        await emit({
          type: 'reasoning-end',
          attemptId: options.attemptId,
          durationMs: null,
        });
      }
    },
  };
}

function safeFailureFrame(): Record<string, unknown> {
  return { error: { message: 'Provider stream frame was invalid' } };
}

function safeErrorFrame(): Record<string, unknown> {
  return { error: { message: 'Provider stream failed' } };
}

export function isProviderSseFrameTooLarge(byteLength: number): boolean {
  return byteLength > MAX_PROVIDER_SSE_FRAME_BYTES;
}

function takeUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes)
    end--;
  if (end > 0 && end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!))
    end--;
  return value.slice(0, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
