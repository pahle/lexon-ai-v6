import type {
  JsonValue,
  ModelEvent,
  ModelInput,
  ModelToolResultPart,
} from './model-contracts.js';
import { normalizeProviderCost } from './provider-errors.js';
import type { ModelMessage as AiModelMessage } from 'ai';

export interface ProviderUsageResult {
  readonly usage?: Extract<ModelEvent, { readonly type: 'usage' }>;
  readonly generationId?: string;
  readonly provider?: string;
  readonly invalidCost?: boolean;
}

export function toModelMessages(input: ModelInput) {
  const calledTools = new Map<string, string>();
  return input.messages.map((message): AiModelMessage => {
    if (message.role === 'system' || message.role === 'user') {
      return {
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content),
      };
    }
    if (message.role === 'assistant') {
      if (typeof message.content === 'string')
        return { role: 'assistant', content: message.content };
      const content = message.content.map((part) => {
        if (part.type === 'text') return part;
        assertOpaque(part.toolCallId, 256);
        assertOpaque(part.toolName, 128);
        assertJsonValue(part.input);
        if (calledTools.has(part.toolCallId))
          throw new Error('Invalid model tool message');
        calledTools.set(part.toolCallId, part.toolName);
        return part;
      });
      return { role: 'assistant', content };
    }
    if (!Array.isArray(message.content))
      throw new Error('Invalid model tool message');
    const toolParts = message.content as readonly ModelToolResultPart[];
    const content = toolParts.map((part) => {
      assertOpaque(part.toolCallId, 256);
      assertOpaque(part.toolName, 128);
      assertJsonValue(part.result);
      if (calledTools.get(part.toolCallId) !== part.toolName)
        throw new Error('Invalid model tool message');
      return {
        type: 'tool-result' as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: { type: 'json' as const, value: part.result },
      };
    });
    return { role: 'tool', content };
  });
}

export function mapProviderPart(part: unknown): ModelEvent[] {
  if (!isRecord(part)) return [];
  if (part.type === 'text-delta' && typeof part.text === 'string') {
    return [{ type: 'text', text: part.text }];
  }
  if (
    part.type === 'tool-call' &&
    typeof part.toolCallId === 'string' &&
    typeof part.toolName === 'string' &&
    isJsonValue(part.input)
  ) {
    return [
      {
        type: 'tool-proposal',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      },
    ];
  }
  return [];
}

export function readProviderUsage(metadata: unknown): ProviderUsageResult {
  if (!isRecord(metadata)) return {};
  const openrouter = metadata.openrouter;
  if (!isRecord(openrouter)) return {};
  const usageMetadata = openrouter.usage;
  const usage: Partial<{
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningOutputTokens: number;
  }> = {};
  if (!isRecord(usageMetadata)) {
    const provider = stringField(openrouter.provider);
    return provider ? { provider } : {};
  }
  if (typeof usageMetadata.promptTokens === 'number')
    usage.inputTokens = usageMetadata.promptTokens;
  if (typeof usageMetadata.completionTokens === 'number')
    usage.outputTokens = usageMetadata.completionTokens;
  if (
    isRecord(usageMetadata.promptTokensDetails) &&
    typeof usageMetadata.promptTokensDetails.cachedTokens === 'number'
  )
    usage.cachedInputTokens = usageMetadata.promptTokensDetails.cachedTokens;
  if (
    isRecord(usageMetadata.completionTokensDetails) &&
    typeof usageMetadata.completionTokensDetails.reasoningTokens === 'number'
  )
    usage.reasoningOutputTokens =
      usageMetadata.completionTokensDetails.reasoningTokens;
  const cost = usageMetadata.cost;
  const invalidCost =
    cost !== undefined &&
    cost !== null &&
    (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0);
  const costUsd =
    !invalidCost && typeof cost === 'number'
      ? normalizeProviderCost(cost)
      : undefined;
  if (Object.keys(usage).length === 0 && costUsd === undefined) {
    return {
      ...(stringField(openrouter.provider)
        ? { provider: stringField(openrouter.provider)! }
        : {}),
      ...(stringField(openrouter.id)
        ? { generationId: stringField(openrouter.id)! }
        : {}),
      ...(invalidCost ? { invalidCost: true } : {}),
    };
  }
  return {
    ...(stringField(openrouter.provider)
      ? { provider: stringField(openrouter.provider)! }
      : {}),
    ...(stringField(openrouter.id)
      ? { generationId: stringField(openrouter.id)! }
      : {}),
    ...(invalidCost ? { invalidCost: true } : {}),
    usage: {
      type: 'usage',
      usage,
      ...(costUsd !== undefined ? { costUsd: costUsd as `${number}` } : {}),
    },
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) throw new Error('Invalid model tool message');
}

function assertOpaque(value: string, maxLength: number): void {
  if (!value || value.length > maxLength)
    throw new Error('Invalid model tool message');
}
