import type { JsonValue, ModelEvent, ModelInput } from './model-contracts.js';
import { normalizeProviderCost } from './provider-errors.js';
import type { ModelMessage as AiModelMessage } from 'ai';

export interface ProviderUsageResult {
  readonly usage?: Extract<ModelEvent, { readonly type: 'usage' }>;
  readonly generationId?: string;
  readonly provider?: string;
  readonly invalidCost?: boolean;
}

export function toModelMessages(input: ModelInput) {
  if (!Array.isArray(input.messages)) throw new Error('Invalid model message');
  const outstandingTools = new Map<string, string>();
  const seenToolIds = new Set<string>();
  const converted = input.messages.map((message): AiModelMessage => {
    if (!isRecord(message)) throw new Error('Invalid model message');
    if (message.role === 'system' || message.role === 'user') {
      assertExactKeys(message, ['content', 'role'], 'Invalid model message');
      if (typeof message.content !== 'string' && !isJsonValue(message.content))
        throw new Error('Invalid model message');
      return {
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content),
      };
    }
    if (message.role === 'assistant') {
      assertExactKeys(message, ['content', 'role'], 'Invalid model message');
      if (typeof message.content === 'string')
        return { role: 'assistant', content: message.content };
      if (!Array.isArray(message.content))
        throw new Error('Invalid model message');
      const content = message.content.map((part: unknown) => {
        if (!isRecord(part)) throw new Error('Invalid model tool message');
        if (part.type === 'text') {
          assertExactKeys(part, ['text', 'type'], 'Invalid model tool message');
          if (typeof part.text !== 'string')
            throw new Error('Invalid model tool message');
          return { type: 'text' as const, text: part.text };
        }
        if (part.type !== 'tool-call')
          throw new Error('Invalid model tool message');
        assertExactKeys(
          part,
          ['input', 'toolCallId', 'toolName', 'type'],
          'Invalid model tool message',
        );
        assertOpaque(part.toolCallId, 256);
        assertOpaque(part.toolName, 128);
        assertJsonValue(part.input);
        if (seenToolIds.has(part.toolCallId))
          throw new Error('Invalid model tool message');
        seenToolIds.add(part.toolCallId);
        outstandingTools.set(part.toolCallId, part.toolName);
        return {
          type: 'tool-call' as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        };
      });
      return { role: 'assistant', content };
    }
    if (message.role !== 'tool') throw new Error('Invalid model message');
    assertExactKeys(message, ['content', 'role'], 'Invalid model tool message');
    if (!Array.isArray(message.content))
      throw new Error('Invalid model tool message');
    const toolParts = message.content as readonly unknown[];
    const content = toolParts.map((part) => {
      if (!isRecord(part) || part.type !== 'tool-result')
        throw new Error('Invalid model tool message');
      assertExactKeys(
        part,
        ['result', 'toolCallId', 'toolName', 'type'],
        'Invalid model tool message',
      );
      assertOpaque(part.toolCallId, 256);
      assertOpaque(part.toolName, 128);
      assertJsonValue(part.result);
      if (outstandingTools.get(part.toolCallId) !== part.toolName)
        throw new Error('Invalid model tool message');
      outstandingTools.delete(part.toolCallId);
      return {
        type: 'tool-result',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: { type: 'json', value: part.result },
      };
    });
    return { role: 'tool', content } as AiModelMessage;
  });
  if (outstandingTools.size > 0) throw new Error('Invalid model tool message');
  return converted;
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

function assertOpaque(
  value: unknown,
  maxLength: number,
): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > maxLength)
    throw new Error('Invalid model tool message');
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  message: string,
): void {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  )
    throw new Error(message);
}
