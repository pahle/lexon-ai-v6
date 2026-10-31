import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { streamText, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createOpenRouterProvider } from './openrouter-provider.js';
import { ModelAllowlistSchema } from './model-allowlist.js';

it('constructs OpenRouter and streams a v4 mock in ESM without network', async () => {
  const network = vi.fn<typeof fetch>(async () => {
    throw new Error('Unexpected network');
  });
  const provider = createOpenRouterProvider({
    apiKey: 'test-only-key',
    fetch: network,
  });
  expect(provider('test-only/model').specificationVersion).toBe('v4');
  const result = streamText({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Hello' },
            { type: 'text-delta', id: 'text-1', delta: ' world' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 2, text: 2, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    }),
    prompt: 'Test fixture',
  });
  let text = '';
  for await (const part of result.textStream) text += part;
  expect(text).toBe('Hello world');
  expect(await result.finishReason).toBe('stop');
  expect(network).not.toHaveBeenCalled();
});
const entry = {
  id: 'test-only/model',
  provider: 'test-only-provider',
  region: 'test-only-region',
  zeroDataRetention: true,
  reviewedAt: '2026-10-31T00:00:00Z',
};
it('keeps F0 empty and accepts a reviewed model-provider-region entry', async () => {
  const config = ModelAllowlistSchema.parse(
    JSON.parse(
      await readFile(
        new URL('../../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  expect(config).toEqual({ version: 1, models: [] });
  expect(
    ModelAllowlistSchema.safeParse({ version: 1, models: [entry] }).success,
  ).toBe(true);
});
it('rejects missing region, ZDR, provider, review date and duplicate model-provider pairs', () => {
  for (const [key, value] of [
    ['region', undefined],
    ['region', ' '],
    ['zeroDataRetention', undefined],
    ['zeroDataRetention', false],
    ['reviewedAt', undefined],
    ['reviewedAt', 'yesterday'],
    ['provider', undefined],
    ['provider', ''],
    ['id', ''],
  ] as const) {
    const invalid = { ...entry, [key]: value };
    expect(
      ModelAllowlistSchema.safeParse({ version: 1, models: [invalid] }).success,
    ).toBe(false);
  }
  expect(
    ModelAllowlistSchema.safeParse({
      version: 1,
      models: [entry, { ...entry, region: 'another-region' }],
    }).success,
  ).toBe(false);
  expect(
    ModelAllowlistSchema.safeParse({
      version: 1,
      models: [entry, { ...entry, provider: 'another-provider' }],
    }).success,
  ).toBe(true);
});
