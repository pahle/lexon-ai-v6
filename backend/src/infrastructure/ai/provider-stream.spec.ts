import { expect, it } from 'vitest';
import { APICallError } from 'ai';
import { mapProviderError, normalizeProviderCost } from './provider-errors.js';
import { mapProviderPart, readProviderUsage } from './provider-stream.js';

it.each([
  { statusCode: 408, outcome: 'failed', retryable: true },
  { statusCode: 429, outcome: 'failed', retryable: true },
  { statusCode: 500, outcome: 'failed', retryable: true },
  { statusCode: 502, outcome: 'failed', retryable: true },
  { statusCode: 503, outcome: 'failed', retryable: true },
  { statusCode: 504, outcome: 'failed', retryable: true },
  { statusCode: 400, outcome: 'failed', retryable: false },
  { statusCode: 401, outcome: 'failed', retryable: false },
  { statusCode: 403, outcome: 'failed', retryable: false },
  { statusCode: 422, outcome: 'failed', retryable: false },
  { statusCode: 501, outcome: 'failed', retryable: false },
])(
  'maps HTTP $statusCode to safe retryability without exposing body',
  ({ statusCode, outcome, retryable }) => {
    const mapped = mapProviderError({
      name: 'APICallError',
      statusCode,
      message: 'K1-private provider response body',
    });
    expect(mapped).toMatchObject({
      safeCode:
        statusCode === 401 || statusCode === 403
          ? 'AI_PROVIDER_AUTH'
          : 'AI_PROVIDER_UNAVAILABLE',
      attemptOutcome: outcome,
      retryable,
    });
    expect(JSON.stringify(mapped)).not.toMatch(/K1|private|body/i);
  },
);

it('marks only recognized network and SDK transport failures retryable', () => {
  const networkCause = Object.assign(new Error('socket reset'), {
    code: 'ECONNRESET',
  });
  const fetchError = new TypeError('fetch failed', { cause: networkCause });
  expect(mapProviderError(fetchError)).toMatchObject({
    safeCode: 'AI_PROVIDER_UNAVAILABLE',
    attemptOutcome: 'unknown',
    retryable: true,
  });
  expect(
    mapProviderError({
      name: 'AI_APICallError',
      statusCode: undefined,
      isRetryable: true,
    }),
  ).toMatchObject({ attemptOutcome: 'unknown', retryable: false });
  expect(
    mapProviderError(new Error('unclassified private error')),
  ).toMatchObject({
    attemptOutcome: 'unknown',
    retryable: false,
  });
  expect(
    mapProviderError(new TypeError('invalid adapter state')),
  ).toMatchObject({
    attemptOutcome: 'unknown',
    retryable: false,
  });
});

it('trusts only branded SDK errors and recognized raw transport causes', () => {
  expect(
    mapProviderError(
      new APICallError({
        message: 'private SDK message',
        url: 'https://invalid.example',
        requestBodyValues: {},
        isRetryable: true,
      }),
    ),
  ).toMatchObject({
    safeCode: 'AI_PROVIDER_UNAVAILABLE',
    attemptOutcome: 'unknown',
    retryable: true,
  });
  expect(
    mapProviderError({ name: 'AI_APICallError', isRetryable: true }),
  ).toMatchObject({ attemptOutcome: 'unknown', retryable: false });

  for (const code of ['CERT_HAS_EXPIRED', 'SOMETHING_ELSE']) {
    expect(
      mapProviderError(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('private cause'), { code }),
        }),
      ),
    ).toMatchObject({ attemptOutcome: 'unknown', retryable: false });
  }
  expect(
    mapProviderError(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
      }),
    ),
  ).toMatchObject({ attemptOutcome: 'unknown', retryable: true });
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
