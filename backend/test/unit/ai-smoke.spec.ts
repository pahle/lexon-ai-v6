import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { runAiSmoke } from '../../src/ai/smoke.js';
import { estimateInputTokens } from '../../src/modules/usage/token-estimator.js';

const allowlist = JSON.parse(
  readFileSync(
    new URL('../../config/model-allowlist.json', import.meta.url),
    'utf8',
  ),
) as {
  readonly models: readonly {
    readonly id: string;
    readonly provider: string;
    readonly region: string;
  }[];
};
const model = allowlist.models[0]!;
const validEnv = {
  OPENROUTER_API_KEY: 'smoke-test-secret-key',
  LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date().toISOString().slice(0, 10),
};

const streamResponse = ({
  promptTokens,
  outputTokens = 2,
  finishReason = 'stop',
  status = 200,
}: {
  readonly promptTokens?: number | undefined;
  readonly outputTokens?: number;
  readonly finishReason?: string;
  readonly status?: number;
}) => {
  if (status !== 200)
    return new Response('private provider error and smoke-test-secret-key', {
      status,
    });
  const usageField =
    promptTokens === undefined
      ? ''
      : `,"usage":${JSON.stringify({
          prompt_tokens: promptTokens,
          completion_tokens: outputTokens,
          total_tokens: promptTokens + outputTokens,
          cost: 0.00004,
        })}`;
  return new Response(
    [
      `data: {"id":"gen-private-id","model":"${model.id}","choices":[{"index":0,"delta":{"content":"PRIVATE_MODEL_OUTPUT_SENTINEL"},"finish_reason":null}]}\n\n`,
      `data: {"id":"gen-private-id","model":"${model.id}","provider":"Azure","choices":[{"index":0,"delta":{},"finish_reason":"${finishReason}"}]${usageField}}\n\n`,
      'data: [DONE]\n\n',
    ].join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};

it('refuses missing key or invalid attestation before fetch and does not echo environment values', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>();

  await expect(runAiSmoke({ env: {}, write, fetch })).resolves.toBe(1);
  await expect(
    runAiSmoke({
      env: {
        ...validEnv,
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: 'invalid-private-attestation',
      },
      write,
      fetch,
    }),
  ).resolves.toBe(1);

  expect(fetch).not.toHaveBeenCalled();
  const output = write.mock.calls.flat().join('');
  expect(output).toMatch(/ZDR-only/i);
  expect(output).toMatch(/Safety Retention/i);
  expect(output).toMatch(/logging off/i);
  expect(output).toMatch(/credit limit/i);
  expect(output).not.toContain('smoke-test-secret-key');
  expect(output).not.toContain('invalid-private-attestation');
});

it('uses one real-shaped mocked gateway response and prints only route, usage, cost, and calibration evidence', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const requests: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return streamResponse({ promptTokens: 10 });
  });

  const smokeResult = await runAiSmoke({ env: validEnv, write, fetch });
  expect(smokeResult).toBe(0);

  expect(fetch).toHaveBeenCalledTimes(1);
  const request = await requests[0]!.clone().json();
  expect(request).toMatchObject({ model: model.id, max_tokens: 128 });
  expect(request.messages).toContainEqual({
    role: 'user',
    content: 'Reply with the single word READY.',
  });
  expect(request.provider).toMatchObject({
    only: [model.provider],
    order: [model.provider],
    allow_fallbacks: false,
    zdr: true,
    data_collection: 'deny',
  });
  const estimate = estimateInputTokens({
    model: model.id,
    provider: model.provider,
    messages: [{ role: 'user', content: 'Reply with the single word READY.' }],
    maxOutputTokens: 128,
    signal: new AbortController().signal,
  });
  const output = write.mock.calls.flat().join('');
  expect(output).toContain(`estimatedInput=${estimate.inputTokens}`);
  expect(output).toContain('reportedInput=10');
  expect(output).toContain(`ratio=${estimate.inputTokens / 10}`);
  expect(output).toContain(`declaredRoute=${model.provider}`);
  expect(output).toContain(`declaredRegion=${model.region}`);
  expect(output).toContain('observedProvider=azure');
  expect(output).toMatch(/observedRegion=unavailable/);
  expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
  expect(output).not.toContain('gen-private-id');
  expect(output).not.toContain('smoke-test-secret-key');
});

it.each([
  { promptTokens: undefined, label: 'missing' },
  { promptTokens: 0, label: 'zero' },
])(
  'reports calibration unavailable for $label reported input usage',
  async ({ promptTokens }) => {
    const write = vi.fn<(chunk: string) => void>();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      streamResponse({ promptTokens }),
    );

    await runAiSmoke({ env: validEnv, write, fetch });

    const output = write.mock.calls.flat().join('');
    expect(output).toContain('estimatedInput=');
    expect(output).toContain('reportedInput=unavailable');
    expect(output).toContain('ratio=unavailable');
    expect(output).not.toContain('NaN');
    expect(output).not.toContain('Infinity');
  },
);

it('fails on reported total usage above the input-plus-output reservation and retains calibration', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    streamResponse({ promptTokens: 100_000 }),
  );

  await expect(runAiSmoke({ env: validEnv, write, fetch })).resolves.toBe(1);

  expect(fetch).toHaveBeenCalledTimes(1);
  const output = write.mock.calls.flat().join('');
  expect(output).toContain('reportedInput=100000');
  expect(output).toContain('reportedOutput=2');
  expect(output).toContain('costUsd=0.00004');
  expect(output).toMatch(/ratio=\d/);
  expect(output).toContain(
    'AI smoke status=failed safeCode=AI_BUDGET_EXCEEDED',
  );
  expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
  expect(output).not.toContain('gen-private-id');
  expect(output).not.toContain('smoke-test-secret-key');
});

it('does not fail merely because input alone exceeds estimate when total remains within reservation', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const estimate = estimateInputTokens({
    model: model.id,
    provider: model.provider,
    messages: [{ role: 'user', content: 'Reply with the single word READY.' }],
    maxOutputTokens: 128,
    signal: new AbortController().signal,
  }).inputTokens;
  const reportedInput = estimate + 10;
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    streamResponse({ promptTokens: reportedInput, outputTokens: 2 }),
  );

  await expect(runAiSmoke({ env: validEnv, write, fetch })).resolves.toBe(0);

  expect(fetch).toHaveBeenCalledTimes(1);
  const output = write.mock.calls.flat().join('');
  expect(output).toContain(`estimatedInput=${estimate}`);
  expect(output).toContain(`reportedInput=${reportedInput}`);
  expect(output).toContain('reportedOutput=2');
  expect(output).not.toContain('AI_BUDGET_EXCEEDED');
});

it('fails if reported output exceeds the enforced output bound even within the total reservation', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    streamResponse({ promptTokens: 10, outputTokens: 129 }),
  );

  await expect(runAiSmoke({ env: validEnv, write, fetch })).resolves.toBe(1);

  expect(fetch).toHaveBeenCalledTimes(1);
  const output = write.mock.calls.flat().join('');
  expect(output).toContain('reportedInput=10');
  expect(output).toContain('reportedOutput=129');
  expect(output).toContain(
    'AI smoke status=failed safeCode=AI_BUDGET_EXCEEDED',
  );
});

it('reports available usage and calibration when the provider outcome fails', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    streamResponse({
      promptTokens: 10,
      outputTokens: 2,
      finishReason: 'content_filter',
    }),
  );

  await expect(runAiSmoke({ env: validEnv, write, fetch })).resolves.toBe(1);

  expect(fetch).toHaveBeenCalledTimes(1);
  const output = write.mock.calls.flat().join('');
  expect(output).toContain('reportedInput=10');
  expect(output).toContain('reportedOutput=2');
  expect(output).toContain('costUsd=0.00004');
  expect(output).toMatch(/ratio=\d/);
  expect(output).toMatch(/AI smoke status=failed safeCode=/);
  expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
  expect(output).not.toContain('smoke-test-secret-key');
});

it('reports failed outcome usage but returns the budget code when its total is over reservation', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    streamResponse({
      promptTokens: 100_000,
      outputTokens: 2,
      finishReason: 'content_filter',
    }),
  );

  await expect(runAiSmoke({ env: validEnv, write, fetch })).resolves.toBe(1);

  expect(fetch).toHaveBeenCalledTimes(1);
  const output = write.mock.calls.flat().join('');
  expect(output).toContain('reportedInput=100000');
  expect(output).toContain('reportedOutput=2');
  expect(output).toContain('costUsd=0.00004');
  expect(output).toContain(
    'AI smoke status=failed safeCode=AI_BUDGET_EXCEEDED',
  );
});

it('prints a safe failure and makes only one request for a provider 503', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    streamResponse({ promptTokens: 10, status: 503 }),
  );

  await expect(runAiSmoke({ env: validEnv, write, fetch })).resolves.toBe(1);

  expect(fetch).toHaveBeenCalledTimes(1);
  const output = write.mock.calls.flat().join('');
  expect(output).not.toContain('private provider error');
  expect(output).not.toContain('smoke-test-secret-key');
  expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
});
