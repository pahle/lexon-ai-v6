import type { ModelEvent, ModelGateway } from '../model-contracts.js';
import { jsonSchema, stepCountIs, streamText } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { mapProviderPart, toSdkPrompt } from '../provider-stream.js';
import type { ModelInput } from '../model-contracts.js';
import type { JsonValue, ModelOutcome } from '../model-contracts.js';

export interface SdkModelScript {
  readonly text?: string;
  readonly dropOutcome?: boolean;
  readonly toolCall?: {
    readonly toolName: string;
    readonly input: JsonValue;
    readonly toolCallId?: string;
  };
  readonly outcome?: ModelOutcome;
}

type MockStreamPart =
  Awaited<
    ReturnType<MockLanguageModelV4['doStream']>
  >['stream'] extends ReadableStream<infer Part>
    ? Part
    : never;

export interface ModelScript {
  readonly events: readonly ModelEvent[];
}

export function createScriptedModelGateway(
  scripts: readonly ModelScript[],
): ModelGateway {
  let nextScript = 0;
  return {
    generate() {
      const script = scripts[nextScript++];
      if (!script) throw new Error('No scripted model response remains');
      return scriptedEvents(script.events);
    },
  };
}

export function createSdkScriptedModelGateway(
  responseFor: (input: ModelInput) => SdkModelScript,
  onRequest: (runId: string | undefined) => void = () => undefined,
): ModelGateway {
  return {
    generate(input) {
      onRequest(input.runId);
      return sdkEvents(input, responseFor(input));
    },
  };
}

async function* sdkEvents(
  input: ModelInput,
  script: SdkModelScript,
): AsyncGenerator<ModelEvent> {
  const text = script.text ?? '';
  const streamChunks = script.toolCall
    ? [
        {
          type: 'tool-call' as const,
          toolCallId: script.toolCall.toolCallId ?? 'evaluation-tool-call',
          toolName: script.toolCall.toolName,
          input: JSON.stringify(script.toolCall.input),
        },
        {
          type: 'finish' as const,
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: {
            inputTokens: {
              total: 12,
              noCache: 12,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
        },
      ]
    : [
        { type: 'text-start' as const, id: 'evaluation-text' },
        { type: 'text-delta' as const, id: 'evaluation-text', delta: text },
        { type: 'text-end' as const, id: 'evaluation-text' },
        {
          type: 'finish' as const,
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: {
            inputTokens: {
              total: 12,
              noCache: 12,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
        },
      ];
  const model = new MockLanguageModelV4({
    provider: 'lexon-evaluation',
    modelId: input.model,
    doStream: async () => ({
      stream: simulateReadableStream<MockStreamPart>({
        initialDelayInMs: 0,
        chunkDelayInMs: 0,
        chunks: streamChunks,
      }),
    }),
  });
  yield {
    type: 'metadata',
    generationId: `eval-${input.runId ?? 'stateless'}`,
    provider: input.provider,
  };
  const tools = Object.fromEntries(
    Object.entries(input.schemas ?? {}).map(([name, schema]) => [
      name,
      { inputSchema: jsonSchema(schema as never) },
    ]),
  );
  const result = streamText({
    model,
    ...toSdkPrompt(input),
    tools,
    stopWhen: stepCountIs(1),
    maxOutputTokens: input.maxOutputTokens,
    maxRetries: 0,
    streamRetries: 0,
    abortSignal: input.signal,
    telemetry: { isEnabled: false },
  });
  for await (const part of result.fullStream)
    for (const event of mapProviderPart(part)) yield event;
  const usage = await result.usage;
  yield {
    type: 'usage',
    usage: {
      ...(usage.inputTokens !== undefined
        ? { inputTokens: usage.inputTokens }
        : {}),
      ...(usage.outputTokens !== undefined
        ? { outputTokens: usage.outputTokens }
        : {}),
    },
  };
  if (script.dropOutcome) return;
  const sdkOutcome: ModelOutcome = {
    finishReason: script.toolCall ? 'tool_calls' : 'stop',
    attemptOutcome: 'succeeded',
    retryable: false,
    generationId: `eval-${input.runId ?? 'stateless'}`,
    provider: input.provider,
    usage: { inputTokens: 12, outputTokens: 1 },
  };
  yield {
    type: 'outcome',
    outcome: script.outcome ?? {
      ...sdkOutcome,
      ...(usage.inputTokens !== undefined || usage.outputTokens !== undefined
        ? {
            usage: {
              ...(usage.inputTokens !== undefined
                ? { inputTokens: usage.inputTokens }
                : {}),
              ...(usage.outputTokens !== undefined
                ? { outputTokens: usage.outputTokens }
                : {}),
            },
          }
        : {}),
    },
  };
}

async function* scriptedEvents(
  events: readonly ModelEvent[],
): AsyncGenerator<ModelEvent> {
  for (const event of events) yield event;
}
