import { expect, it } from 'vitest';
import { mapProviderError, normalizeProviderCost } from './provider-errors.js';
import { mapProviderPart, readProviderUsage } from './provider-stream.js';

it('maps a definitive retryable provider status without exposing its body', () => {
  const mapped = mapProviderError({
    name: 'APICallError',
    statusCode: 503,
    message: 'K1-private provider response body',
  });
  expect(mapped).toEqual({
    safeCode: 'AI_PROVIDER_UNAVAILABLE',
    attemptOutcome: 'failed',
  });
  expect(JSON.stringify(mapped)).not.toMatch(/K1|private|body/i);
});

it('classifies interrupted or unknown errors as unknown and hides raw details', () => {
  const mapped = mapProviderError(
    new Error('connection interrupted K1-secret'),
  );
  expect(mapped.attemptOutcome).toBe('unknown');
  expect(mapped.safeCode).toBe('AI_PROVIDER_UNAVAILABLE');
  expect(JSON.stringify(mapped)).not.toContain('K1-secret');
  expect(mapProviderError({ body: 'malformed K1-secret' }).attemptOutcome).toBe(
    'unknown',
  );
});

it('rejects provider costs outside the canonical finite nonnegative decimal boundary', () => {
  expect(() => normalizeProviderCost(-1)).toThrow(/cost/i);
  expect(() => normalizeProviderCost(Number.NaN)).toThrow(/cost/i);
  expect(() => normalizeProviderCost(Number.POSITIVE_INFINITY)).toThrow(
    /cost/i,
  );
  expect(normalizeProviderCost(0)).toBe('0');
  expect(normalizeProviderCost(1.23e-12)).toBe('0.00000000000123');
});

it('preserves reasoning/cache usage and leaves unknown usage and cost absent', () => {
  expect(
    readProviderUsage({
      openrouter: {
        provider: 'Azure',
        usage: {
          promptTokens: 10,
          completionTokens: 3,
          promptTokensDetails: { cachedTokens: 4 },
          completionTokensDetails: { reasoningTokens: 2 },
          cost: 1.23e-12,
        },
      },
    }).usage,
  ).toEqual({
    type: 'usage',
    usage: {
      inputTokens: 10,
      outputTokens: 3,
      cachedInputTokens: 4,
      reasoningOutputTokens: 2,
    },
    costUsd: '0.00000000000123',
  });
  expect(
    readProviderUsage({ openrouter: { usage: {} } }).usage,
  ).toBeUndefined();
  const invalidCost = readProviderUsage({
    openrouter: { usage: { promptTokens: 4, cost: -0.01 } },
  });
  expect(invalidCost.invalidCost).toBe(true);
  expect(invalidCost.usage).toEqual({
    type: 'usage',
    usage: { inputTokens: 4 },
  });
});

it('translates provider text and tool calls into neutral events without executing tools', () => {
  expect(mapProviderPart({ type: 'text-delta', text: 'safe text' })).toEqual([
    { type: 'text', text: 'safe text' },
  ]);
  expect(
    mapProviderPart({
      type: 'tool-call',
      toolCallId: 'sdk-id',
      toolName: 'lookup',
      input: { query: 'synthetic' },
    }),
  ).toEqual([
    {
      type: 'tool-proposal',
      toolCallId: 'sdk-id',
      toolName: 'lookup',
      input: { query: 'synthetic' },
    },
  ]);
  expect(mapProviderPart({ type: 'error', error: 'private' })).toEqual([]);
});
