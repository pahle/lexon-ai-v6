import { jsonSchema, stepCountIs, streamText, tool } from 'ai';
import type { ToolSet } from 'ai';
import { ModelAllowlistSchema } from './model-allowlist.js';
import { createOpenRouterProvider } from './openrouter-provider.js';
import { mapProviderError } from './provider-errors.js';
import { validateRealModelPrerequisites } from './real-model-prerequisites.js';
import {
  mapProviderPart,
  readProviderUsage,
  toModelMessages,
} from './provider-stream.js';
import type {
  ModelAttemptOutcome,
  ModelEvent,
  ModelGateway,
  ModelInput,
  ModelOutcome,
} from './model-contracts.js';

export interface RealModelGatewayOptions {
  readonly allowlist: unknown;
  readonly key?: string | undefined;
  readonly attestation?: string | undefined;
  readonly fetch?: typeof fetch | undefined;
}

export function createRealModelGateway(
  options: RealModelGatewayOptions,
): ModelGateway {
  const allowlist = ModelAllowlistSchema.parse(options.allowlist);
  return {
    generate(input) {
      return generate(input, options, allowlist.models);
    },
  };
}

async function* generate(
  input: ModelInput,
  options: RealModelGatewayOptions,
  allowedModels: readonly {
    readonly id: string;
    readonly provider: string;
    readonly region: string;
    readonly zeroDataRetention: true;
    readonly reviewedAt: string;
  }[],
): AsyncGenerator<ModelEvent> {
  if (!options.key) throw new Error('OpenRouter API key is required');
  validateRealModelPrerequisites({
    LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: options.attestation,
  });
  const route = allowedModels.find(
    (candidate) =>
      candidate.id === input.model && candidate.provider === input.provider,
  );
  if (!route) throw new Error('Requested model is not allowlisted');

  const provider = createOpenRouterProvider({
    apiKey: options.key,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const metadataQueue = new MetadataQueue();
  let queuedGenerationId: string | undefined;
  const baseModel = provider(input.model);
  const model = new Proxy(baseModel, {
    get(target, property, receiver) {
      if (property !== 'doStream')
        return Reflect.get(target, property, receiver);
      return async (callOptions: Parameters<typeof baseModel.doStream>[0]) => {
        const result = await baseModel.doStream(callOptions);
        const stream = result.stream.pipeThrough(
          new TransformStream({
            async transform(part, controller) {
              if (
                part.type === 'response-metadata' &&
                part.id &&
                part.id !== queuedGenerationId
              ) {
                queuedGenerationId = part.id;
                await metadataQueue.push({
                  event: {
                    type: 'metadata',
                    generationId: part.id,
                  },
                });
              }
              controller.enqueue(part);
            },
            flush() {
              metadataQueue.close();
            },
          }),
        );
        return { ...result, stream };
      };
    },
  });

  let lastGenerationId: string | undefined;
  let latestUsage: (ModelEvent & { readonly type: 'usage' }) | undefined;
  let providerName: string | undefined;
  let finished = false;
  let attemptOutcome: ModelAttemptOutcome = 'unknown';
  let definitiveFailure = false;
  let uncertainFailure = false;
  let finishReason: ModelOutcome['finishReason'] = 'error';
  let safeCode: ModelOutcome['safeCode'];
  let streamIterator: AsyncIterator<unknown> | undefined;
  const requestAbort = new AbortController();
  const abortRequest = () => requestAbort.abort(input.signal.reason);
  if (input.signal.aborted) abortRequest();
  else input.signal.addEventListener('abort', abortRequest, { once: true });

  try {
    const tools = Object.fromEntries(
      Object.entries(input.schemas ?? {}).map(([name, schema]) => [
        name,
        tool({ inputSchema: jsonSchema(schema as never) }),
      ]),
    ) as ToolSet;
    const result = streamText({
      model,
      messages: toModelMessages(input),
      tools,
      stopWhen: stepCountIs(1),
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 0,
      streamRetries: 0,
      abortSignal: requestAbort.signal,
      onError: () => undefined,
      providerOptions: {
        openrouter: {
          provider: {
            only: [route.provider],
            order: [route.provider],
            allow_fallbacks: false,
            zdr: true,
            data_collection: 'deny',
          },
        },
      },
      telemetry: {
        isEnabled: false,
        recordInputs: false,
        recordOutputs: false,
      },
    });

    streamIterator = result.fullStream[Symbol.asyncIterator]();
    let nextPart = streamIterator.next();
    let nextMetadata = metadataQueue.next();
    while (true) {
      const ready = await Promise.race([
        nextPart.then((value) => ({ source: 'part' as const, value })),
        nextMetadata.then((value) => ({ source: 'metadata' as const, value })),
      ]);
      if (ready.source === 'metadata') {
        if (ready.value.done) {
          nextMetadata = new Promise(() => undefined);
          continue;
        }
        const queued = ready.value.value;
        if (queued.event.type === 'metadata') {
          lastGenerationId = queued.event.generationId;
          try {
            yield queued.event;
          } finally {
            queued.acknowledge();
          }
        } else {
          queued.acknowledge();
        }
        nextMetadata = metadataQueue.next();
        continue;
      }
      if (ready.value.done) break;
      const part = ready.value.value;
      nextPart = streamIterator.next();
      for (const event of mapProviderPart(part)) yield event;
      if (isRecord(part) && part.type === 'error') {
        const mapped = mapProviderError(part.error);
        attemptOutcome = mapped.attemptOutcome;
        safeCode = mapped.safeCode;
        definitiveFailure ||= mapped.attemptOutcome === 'failed';
        uncertainFailure ||= mapped.attemptOutcome === 'unknown';
      }
      if (isRecord(part) && part.type === 'abort') {
        attemptOutcome = 'unknown';
        uncertainFailure = true;
        safeCode = 'AI_PROVIDER_UNAVAILABLE';
      }
      if (isRecord(part) && part.type === 'finish') {
        finished = true;
        finishReason = normalizeFinishReason(part.finishReason);
        attemptOutcome = definitiveFailure
          ? 'failed'
          : uncertainFailure || finishReason === 'error'
            ? 'unknown'
            : 'succeeded';
        if (finishReason === 'error' && !safeCode) safeCode = 'AI_INTERNAL';
        const usageResult = readProviderUsage(await result.providerMetadata);
        providerName = usageResult.provider ?? providerName;
        lastGenerationId ??= usageResult.generationId;
        latestUsage = usageResult.usage;
        if (latestUsage) yield latestUsage;
        if (usageResult.invalidCost) {
          finishReason = 'error';
          attemptOutcome = 'unknown';
          safeCode = 'AI_INTERNAL';
        }
        break;
      }
    }
    if (
      !finished &&
      !requestAbort.signal.aborted &&
      attemptOutcome === 'unknown'
    ) {
      safeCode = 'AI_PROVIDER_UNAVAILABLE';
    }
  } catch (error) {
    const mapped = mapProviderError(error);
    attemptOutcome = requestAbort.signal.aborted
      ? 'unknown'
      : mapped.attemptOutcome;
    safeCode = requestAbort.signal.aborted
      ? 'AI_PROVIDER_UNAVAILABLE'
      : mapped.safeCode;
  } finally {
    if (!requestAbort.signal.aborted) requestAbort.abort();
    input.signal.removeEventListener('abort', abortRequest);
    if (streamIterator?.return)
      await streamIterator.return().catch(() => undefined);
    metadataQueue.close();
  }

  yield {
    type: 'outcome',
    outcome: {
      finishReason,
      attemptOutcome,
      ...(lastGenerationId ? { generationId: lastGenerationId } : {}),
      ...(providerName ? { provider: providerName } : {}),
      ...(latestUsage ? { usage: latestUsage.usage } : {}),
      ...(latestUsage?.costUsd !== undefined
        ? { costUsd: latestUsage.costUsd }
        : {}),
      ...(safeCode ? { safeCode } : {}),
    },
  };
}

class MetadataQueue {
  private items: Array<{
    event: ModelEvent;
    acknowledge: () => void;
  }> = [];
  private waiters: Array<
    (
      value: IteratorResult<{ event: ModelEvent; acknowledge: () => void }>,
    ) => void
  > = [];
  private closed = false;

  async push(item: { event: ModelEvent }): Promise<void> {
    await new Promise<void>((resolve) => {
      const queued = { ...item, acknowledge: resolve };
      const waiter = this.waiters.shift();
      if (waiter) waiter({ value: queued, done: false });
      else this.items.push(queued);
    });
  }

  next(): Promise<
    IteratorResult<{ event: ModelEvent; acknowledge: () => void }>
  > {
    const item = this.items.shift();
    if (item) return Promise.resolve({ value: item, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0))
      waiter({ value: undefined, done: true });
  }
}

function normalizeFinishReason(value: unknown): ModelOutcome['finishReason'] {
  if (value === 'stop') return 'stop';
  if (value === 'tool-calls' || value === 'tool_calls') return 'tool_calls';
  return 'error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
