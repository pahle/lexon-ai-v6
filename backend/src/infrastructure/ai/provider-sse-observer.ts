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

export type ProviderReasoningKind =
  'summary' | 'raw' | 'encrypted' | 'unclassifiable';

export interface ProviderSseObserver {
  readonly attemptId: string;
  readonly observe: (event: unknown) => Promise<unknown>;
  readonly finish: () => Promise<void>;
}

type ProjectedEnvelope = Record<string, unknown> & {
  readonly choices: readonly Record<string, unknown>[];
};

export function createProviderSseObserver(options: {
  readonly attemptId: string;
  readonly now?: () => number;
  readonly onReasoningKind?: (kind: ProviderReasoningKind) => void;
  readonly onEvent: (event: ProviderReasoningSignal) => void | Promise<void>;
}): ProviderSseObserver {
  const now = options.now ?? (() => performance.now());
  let signalAt: number | undefined;
  let answerAt: number | undefined;
  let summaryBytes = 0;
  let ended = false;
  let timingClosed = false;

  const emit = (event: ProviderReasoningSignal) => {
    const result = options.onEvent(event);
    if (result && typeof (result as Promise<void>).then === 'function')
      return result;
  };

  const observe = async (value: unknown): Promise<unknown> => {
    if (!isRecord(value)) return safeFailureFrame();
    if (isRecord(value.error)) return safeErrorFrame();

    observeRawReasoningKinds(value, options.onReasoningKind);
    const envelope = projectEnvelope(value);
    if (!envelope) return safeFailureFrame();
    const choice = envelope.choices[0];
    const delta = isRecord(choice?.delta) ? choice.delta : undefined;
    let sawTypedSignal = false;
    const safeDetails: Record<string, unknown>[] = [];

    if (delta && Array.isArray(delta.reasoning_details)) {
      for (const detail of delta.reasoning_details) {
        if (!isRecord(detail) || typeof detail.type !== 'string') continue;
        if (detail.type.startsWith('reasoning.')) sawTypedSignal = true;
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
    }

    // The provider transformer consumes only choices[0]. Capture signal and answer
    // boundaries before awaited downstream delivery can apply backpressure.
    const firstSignal =
      !timingClosed && sawTypedSignal && signalAt === undefined;
    if (firstSignal) signalAt = now();
    const answerPresent =
      typeof delta?.content === 'string' && delta.content.length > 0;
    const firstAnswer = answerPresent && answerAt === undefined;
    if (firstAnswer) {
      answerAt = now();
      if (signalAt === undefined) timingClosed = true;
    }

    if (firstSignal) {
      await emit({ type: 'reasoning-start', attemptId: options.attemptId });
    }
    if (!timingClosed) {
      for (const detail of safeDetails) {
        await emit({
          type: 'reasoning-summary-delta',
          attemptId: options.attemptId,
          text: detail.summary as string,
        });
      }
    }
    if (delta && Array.isArray(delta.reasoning_details)) {
      if (timingClosed || !safeDetails.length) delete delta.reasoning_details;
      else delta.reasoning_details = safeDetails;
    }
    if (signalAt !== undefined && answerAt !== undefined && !ended) {
      ended = true;
      await emit({
        type: 'reasoning-end',
        attemptId: options.attemptId,
        durationMs: Math.max(0, Math.round(answerAt - signalAt)),
      });
    }
    return envelope;
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

function observeRawReasoningKinds(
  value: Record<string, unknown>,
  onKind: ((kind: ProviderReasoningKind) => void) | undefined,
): void {
  if (!onKind || !Array.isArray(value.choices)) return;
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) return;
  const delta = choice.delta;

  if (Object.hasOwn(delta, 'reasoning')) onKind('unclassifiable');
  if (!Object.hasOwn(delta, 'reasoning_details')) return;
  if (!Array.isArray(delta.reasoning_details)) {
    onKind('unclassifiable');
    return;
  }

  for (const detail of delta.reasoning_details) {
    if (!isRecord(detail) || typeof detail.type !== 'string') {
      onKind('unclassifiable');
      continue;
    }
    if (detail.type === 'reasoning.summary') onKind('summary');
    else if (detail.type === 'reasoning.text') onKind('raw');
    else if (detail.type === 'reasoning.encrypted') onKind('encrypted');
    else onKind('unclassifiable');
  }
}

function projectEnvelope(
  value: Record<string, unknown>,
): ProjectedEnvelope | undefined {
  const projected: Record<string, unknown> = {};
  for (const key of ['id', 'model', 'provider'] as const) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'string') return undefined;
    projected[key] = value[key];
  }
  if (!Array.isArray(value.choices)) return undefined;
  const choices = value.choices;
  if (choices.length) {
    const choice = choices[0];
    if (!isRecord(choice)) return undefined;
    const safeChoice: Record<string, unknown> = {};
    if (Object.hasOwn(choice, 'index')) {
      if (choice.index !== null && typeof choice.index !== 'number')
        return undefined;
      safeChoice.index = choice.index;
    }
    if (Object.hasOwn(choice, 'finish_reason')) {
      if (
        choice.finish_reason !== null &&
        typeof choice.finish_reason !== 'string'
      )
        return undefined;
      safeChoice.finish_reason = choice.finish_reason;
    }
    if (Object.hasOwn(choice, 'delta')) {
      if (choice.delta === null) {
        safeChoice.delta = null;
      } else {
        if (!isRecord(choice.delta)) return undefined;
        const delta = projectDelta(choice.delta);
        if (!delta) return undefined;
        safeChoice.delta = delta;
      }
    }
    projected.choices = [safeChoice];
  } else {
    projected.choices = [];
  }
  if (Object.hasOwn(value, 'usage')) {
    const usage = projectUsage(value.usage);
    if (!usage.ok) return undefined;
    projected.usage = usage.value;
  }
  return projected as ProjectedEnvelope;
}

function projectDelta(value: Record<string, unknown>) {
  const projected: Record<string, unknown> = {};
  if (Object.hasOwn(value, 'role')) {
    if (value.role !== 'assistant') return undefined;
    projected.role = 'assistant';
  }
  if (Object.hasOwn(value, 'content')) {
    if (value.content !== null && typeof value.content !== 'string')
      return undefined;
    projected.content = value.content;
  }
  if (Array.isArray(value.reasoning_details)) {
    projected.reasoning_details = value.reasoning_details.filter(
      (detail) => isRecord(detail) && typeof detail.type === 'string',
    );
  }
  if (Object.hasOwn(value, 'tool_calls')) {
    if (value.tool_calls === null) {
      projected.tool_calls = null;
    } else {
      if (!Array.isArray(value.tool_calls)) return undefined;
      const toolCalls = value.tool_calls.map(projectToolCall);
      if (toolCalls.some((toolCall) => !toolCall)) return undefined;
      projected.tool_calls = toolCalls;
    }
  }
  return projected;
}

function projectToolCall(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const projected: Record<string, unknown> = {};
  if (Object.hasOwn(value, 'index')) {
    if (value.index !== null && typeof value.index !== 'number')
      return undefined;
    projected.index = value.index;
  }
  if (Object.hasOwn(value, 'id')) {
    if (value.id !== null && typeof value.id !== 'string') return undefined;
    projected.id = value.id;
  }
  if (Object.hasOwn(value, 'type')) {
    if (value.type !== 'function') return undefined;
    projected.type = value.type;
  }
  if (Object.hasOwn(value, 'function')) {
    if (!isRecord(value.function)) return undefined;
    const fn: Record<string, unknown> = {};
    for (const key of ['name', 'arguments'] as const) {
      if (!Object.hasOwn(value.function, key)) continue;
      const item = value.function[key];
      if (item !== null && typeof item !== 'string') return undefined;
      fn[key] = item;
    }
    projected.function = fn;
  }
  return projected;
}

function projectUsage(
  value: unknown,
):
  | { readonly ok: true; readonly value: Record<string, unknown> | null }
  | { readonly ok: false } {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value)) return { ok: false };
  const projected: Record<string, unknown> = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (typeof value[key] !== 'number') return { ok: false };
    projected[key] = value[key];
  }
  if (Object.hasOwn(value, 'cost')) {
    if (typeof value.cost !== 'number') return { ok: false };
    projected.cost = value.cost;
  }
  const promptDetails = projectUsageDetail(
    value.prompt_tokens_details,
    ['cached_tokens', 'cache_write_tokens'],
    ['cached_tokens'],
  );
  if (!promptDetails.ok) return { ok: false };
  if (promptDetails.present)
    projected.prompt_tokens_details = promptDetails.value;
  const completionDetails = projectUsageDetail(
    value.completion_tokens_details,
    ['reasoning_tokens'],
    ['reasoning_tokens'],
  );
  if (!completionDetails.ok) return { ok: false };
  if (completionDetails.present)
    projected.completion_tokens_details = completionDetails.value;
  const costDetails = projectUsageDetail(
    value.cost_details,
    ['upstream_inference_cost'],
    [],
  );
  if (!costDetails.ok) return { ok: false };
  if (costDetails.present) projected.cost_details = costDetails.value;
  return { ok: true, value: projected };
}

function projectUsageDetail(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
):
  | {
      readonly ok: true;
      readonly present: boolean;
      readonly value?: Record<string, unknown> | null;
    }
  | { readonly ok: false } {
  if (value === undefined) return { ok: true, present: false };
  if (value === null) return { ok: true, present: true, value: null };
  if (!isRecord(value)) return { ok: false };
  const projected: Record<string, unknown> = {};
  for (const key of required) {
    if (typeof value[key] !== 'number') return { ok: false };
    projected[key] = value[key];
  }
  for (const key of allowed) {
    if (Object.hasOwn(projected, key) || !Object.hasOwn(value, key)) continue;
    const item = value[key];
    if (item !== null && typeof item !== 'number') return { ok: false };
    projected[key] = item;
  }
  return { ok: true, present: true, value: projected };
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
