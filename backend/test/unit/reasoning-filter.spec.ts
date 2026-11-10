import { expect, it, vi } from 'vitest';
import {
  createProviderSseObserver,
  createRealModelGateway,
  ModelAllowlistSchema,
  type ModelEvent,
  type ModelInput,
} from '../../src/infrastructure/ai/index.js';

const allowlist = ModelAllowlistSchema.parse({
  version: 1,
  models: [
    {
      id: 'openai/gpt-6-luna',
      provider: 'azure/us',
      region: 'us',
      zeroDataRetention: true,
      reviewedAt: '2026-11-05T00:00:00.000Z',
    },
  ],
});

const input = (
  attemptId = '00000000-0000-4000-8000-000000000001',
): ModelInput => ({
  attemptId,
  model: 'openai/gpt-6-luna',
  provider: 'azure/us',
  messages: [{ role: 'user', content: 'synthetic prompt' }],
  maxOutputTokens: 100,
  signal: new AbortController().signal,
});

const frame = (delta: Record<string, unknown>) => ({
  id: 'gen-safe-id',
  model: 'openai/gpt-6-luna',
  choices: [{ index: 0, delta, finish_reason: null }],
});

const response = (...frames: unknown[]) =>
  new Response(
    [
      ...frames.map((data) => `data: ${JSON.stringify(data)}\n\n`),
      'data: [DONE]\n\n',
    ].join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );

async function collect(
  fetch: typeof globalThis.fetch,
  current = input(),
  reasoningClock?: () => number,
) {
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only',
    attestation: '2026-11-05',
    fetch,
    ...(reasoningClock ? { reasoningClock } : {}),
  });
  const events: ModelEvent[] = [];
  for await (const event of gateway.generate(current)) events.push(event);
  return events;
}

it('retains explicit summary and drops raw and encrypted reasoning before SDK accumulation', async () => {
  const summary = 'summary-safe-canary';
  const raw = 'raw-forbidden-canary';
  const encrypted = 'encrypted-forbidden-canary';
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    response(
      frame({ reasoning_details: [{ type: 'reasoning.summary', summary }] }),
      frame({ reasoning_details: [{ type: 'reasoning.text', text: raw }] }),
      frame({
        reasoning_details: [{ type: 'reasoning.encrypted', data: encrypted }],
      }),
      frame({ content: 'answer-safe-canary' }),
      {
        ...frame({}),
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ),
  );
  const events = await collect(
    fetch,
    input(),
    (() => {
      let now = 0;
      return () => (now += 1);
    })(),
  );
  expect(events).toContainEqual({
    type: 'reasoning-summary-delta',
    attemptId: '00000000-0000-4000-8000-000000000001',
    text: summary,
  });
  expect(JSON.stringify(events)).toContain('answer-safe-canary');
  expect(JSON.stringify(events)).not.toContain(raw);
  expect(JSON.stringify(events)).not.toContain(encrypted);
  expect(events).toContainEqual({
    type: 'reasoning-end',
    attemptId: '00000000-0000-4000-8000-000000000001',
    durationMs: 1,
  });
});

it('drops untyped and unknown reasoning without creating a timing signal', async () => {
  const canaries = ['generic-forbidden-canary', 'unknown-forbidden-canary'];
  const events = await collect(async () =>
    response(
      frame({ reasoning: canaries[0] }),
      frame({
        reasoning_details: [{ type: 'unknown.private', payload: canaries[1] }],
      }),
      frame({ content: 'answer-without-signal' }),
      {
        ...frame({}),
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ),
  );
  for (const canary of canaries)
    expect(JSON.stringify(events)).not.toContain(canary);
  expect(events).toContainEqual({
    type: 'text',
    text: 'answer-without-signal',
  });
  expect(events.some((event) => event.type === 'reasoning-start')).toBe(false);
});

it('keeps a signaled cancellation unmeasured until answer text arrives', async () => {
  const abort = new AbortController();
  const events: ModelEvent[] = [];
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only',
    attestation: '2026-11-05',
    reasoningClock: (() => {
      let time = 2_000;
      return () => (time += 1);
    })(),
    fetch: async (_request, init) => {
      const requestSignal = init?.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify(frame({ reasoning_details: [{ type: 'reasoning.encrypted', data: 'encrypted' }] }))}\n\n`,
            ),
          );
          requestSignal.addEventListener('abort', () => controller.close(), {
            once: true,
          });
        },
      });
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  for await (const event of gateway.generate({
    ...input(),
    signal: abort.signal,
  })) {
    events.push(event);
    if (event.type === 'reasoning-start') abort.abort();
  }
  expect(events.some((event) => event.type === 'reasoning-start')).toBe(true);
  expect(events).toContainEqual({
    type: 'reasoning-end',
    attemptId: '00000000-0000-4000-8000-000000000001',
    durationMs: null,
  });
});

it('preserves answer timing while truncating summary overflow', async () => {
  const summary = 'é'.repeat(9_000);
  const events = await collect(async () =>
    response(
      frame({ reasoning_details: [{ type: 'reasoning.summary', summary }] }),
      frame({ content: 'answer-after-summary-cap' }),
      {
        ...frame({}),
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ),
  );
  const deltas = events.filter(
    (event) => event.type === 'reasoning-summary-delta',
  );
  expect(
    deltas.reduce(
      (sum, event) => sum + Buffer.byteLength(event.text, 'utf8'),
      0,
    ),
  ).toBeLessThanOrEqual(16_384);
  expect(JSON.stringify(events)).toContain('answer-after-summary-cap');
});

it('classifies a sanitized streaming transport failure after a reasoning frame', async () => {
  const events = await collect(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify(frame({ reasoning_details: [{ type: 'reasoning.summary', summary: 'safe summary' }] }))}\n\n`,
              ),
            );
            setTimeout(
              () =>
                controller.error(
                  new TypeError('fetch failed', {
                    cause: Object.assign(new Error('private'), {
                      code: 'ECONNRESET',
                    }),
                  }),
                ),
              0,
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  expect(events.at(-1), JSON.stringify(events)).toMatchObject({
    type: 'outcome',
    outcome: {
      attemptOutcome: 'unknown',
      retryable: true,
      safeCode: 'AI_PROVIDER_UNAVAILABLE',
    },
  });
});

it('sanitizes HTTP 200 provider error frames and malformed answer deltas before SDK parsing', async () => {
  const canary = 'provider-error-raw-canary';
  const events = await collect(async () =>
    response({
      error: { code: 429, message: canary, metadata: { raw: canary } },
    }),
  );
  expect(JSON.stringify(events)).not.toContain(canary);
  expect(events.at(-1)).toMatchObject({
    type: 'outcome',
    outcome: { finishReason: 'error' },
  });

  const malformed = await collect(async () =>
    response(frame({ content: { invalid: canary } })),
  );
  expect(JSON.stringify(malformed)).not.toContain(canary);
});

it('sanitizes fetch rejection messages before SDK errors and console output', async () => {
  const canary = 'private-fetch-error-canary';
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    const events = await collect(async () => {
      throw new Error(canary);
    });
    expect(JSON.stringify(events)).not.toContain(canary);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(canary);
  } finally {
    consoleError.mockRestore();
  }
});

it('captures same-frame signal and answer timing before awaited observers', async () => {
  let clock = 0;
  const events: unknown[] = [];
  const observer = createProviderSseObserver({
    attemptId: input().attemptId!,
    now: () => clock,
    onEvent: async (event) => {
      events.push(event);
      clock += 1_000;
    },
  });
  await observer.observe(
    frame({
      reasoning_details: [
        { type: 'reasoning.summary', summary: 'same-frame summary' },
      ],
      content: 'answer begins in same frame',
    }),
  );
  expect(events.at(-1)).toMatchObject({ type: 'reasoning-end', durationMs: 0 });
});

it('projects the provider chunk and usage to approved fields before SDK parsing', async () => {
  const extraCanary = 'usage-extra-reasoning-canary';
  const malformedCanary = 'usage-malformed-canary';
  const observer = createProviderSseObserver({
    attemptId: input().attemptId!,
    onEvent: () => undefined,
  });
  const projected = await observer.observe({
    id: 'generation-safe-id',
    model: 'openai/gpt-6-luna',
    provider: 'azure/us',
    private_top_level: extraCanary,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content: 'safe answer',
          private_delta: extraCanary,
          reasoning_details: [
            { type: 'reasoning.summary', summary: 'safe summary' },
            { type: 'reasoning.text', text: extraCanary },
          ],
        },
        finish_reason: null,
        private_choice: extraCanary,
      },
      {
        index: 1,
        delta: {
          reasoning_details: [
            { type: 'reasoning.summary', summary: extraCanary },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: 5,
      completion_tokens: 3,
      total_tokens: 8,
      prompt_tokens_details: { cached_tokens: 1, private: extraCanary },
      completion_tokens_details: {
        reasoning_tokens: 2,
        private: extraCanary,
      },
      cost: 0.002,
      cost_details: {
        upstream_inference_cost: 0.001,
        private: extraCanary,
      },
      reasoning_details: extraCanary,
    },
  });
  expect(JSON.stringify(projected)).not.toContain(extraCanary);
  expect(projected).toMatchObject({
    id: 'generation-safe-id',
    model: 'openai/gpt-6-luna',
    provider: 'azure/us',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content: 'safe answer',
          reasoning_details: [
            { type: 'reasoning.summary', summary: 'safe summary' },
          ],
        },
        finish_reason: null,
      },
    ],
    usage: {
      prompt_tokens: 5,
      completion_tokens: 3,
      total_tokens: 8,
      prompt_tokens_details: { cached_tokens: 1 },
      completion_tokens_details: { reasoning_tokens: 2 },
      cost: 0.002,
      cost_details: { upstream_inference_cost: 0.001 },
    },
  });

  const malformed = await observer.observe({
    ...frame({}),
    usage: {
      prompt_tokens: 'not-a-number',
      completion_tokens: 1,
      total_tokens: 1,
      private_reasoning: malformedCanary,
    },
  });
  expect(JSON.stringify(malformed)).not.toContain(malformedCanary);
  expect(malformed).toEqual({
    error: { message: 'Provider stream frame was invalid' },
  });
});

it('ignores reasoning that arrives after answer-first timing has closed', async () => {
  let clock = 0;
  const events: unknown[] = [];
  const observer = createProviderSseObserver({
    attemptId: input().attemptId!,
    now: () => clock,
    onEvent: (event) => {
      events.push(event);
    },
  });
  const answerFirst = await observer.observe(
    frame({ content: 'answer first' }),
  );
  clock = 25;
  const lateReasoning = await observer.observe(
    frame({
      reasoning_details: [
        { type: 'reasoning.summary', summary: 'late summary must not stream' },
      ],
    }),
  );
  await observer.finish();
  expect(answerFirst).toMatchObject({
    choices: [{ delta: { content: 'answer first' } }],
  });
  expect(lateReasoning).toMatchObject({
    choices: [{ delta: {} }],
  });
  expect(events).toEqual([]);
});

it('keeps valid usage accounting at the real SDK boundary while stripping usage canaries', async () => {
  const canary = 'usage-raw-reasoning-private-canary';
  const events = await collect(async () =>
    response(frame({ content: 'answer with usage' }), {
      ...frame({}),
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 7,
        completion_tokens: 4,
        total_tokens: 11,
        cost: 0.003,
        prompt_tokens_details: { cached_tokens: 2, private: canary },
        completion_tokens_details: {
          reasoning_tokens: 1,
          private: canary,
        },
        private_reasoning: canary,
      },
    }),
  );
  expect(events.find((event) => event.type === 'usage')).toMatchObject({
    type: 'usage',
    costUsd: '0.003',
    usage: {
      inputTokens: 7,
      outputTokens: 4,
      cachedInputTokens: 2,
      reasoningOutputTokens: 1,
    },
  });
  expect(JSON.stringify(events)).not.toContain(canary);

  const malformed = await collect(async () =>
    response({
      ...frame({}),
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
        private_reasoning: canary,
        completion_tokens_details: { reasoning_tokens: malformedNumber() },
      },
    }),
  );
  expect(JSON.stringify(malformed)).not.toContain(canary);
  expect(malformed.at(-1)).toMatchObject({
    type: 'outcome',
    outcome: { finishReason: 'error' },
  });
});

function malformedNumber() {
  return 'not-a-number';
}

it.each([
  {
    name: 'raw-only',
    delta: {
      reasoning_details: [
        { type: 'reasoning.text', text: 'raw-only-forbidden' },
      ],
    },
    wantSignal: true,
    wantSummary: false,
  },
  {
    name: 'encrypted-only',
    delta: {
      reasoning_details: [
        { type: 'reasoning.encrypted', data: 'encrypted-only-forbidden' },
      ],
    },
    wantSignal: true,
    wantSummary: false,
  },
  { name: 'none', delta: {}, wantSignal: false, wantSummary: false },
  {
    name: 'redacted-only',
    delta: {
      reasoning_details: [
        { type: 'reasoning.redacted', data: 'redacted-forbidden' },
      ],
    },
    wantSignal: true,
    wantSummary: false,
  },
])(
  'classifies $name at the raw provider boundary',
  async ({ delta, wantSignal, wantSummary }) => {
    const events = await collect(async () =>
      response(frame(delta), frame({ content: 'case answer' }), {
        ...frame({}),
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
    );
    expect(events.some((event) => event.type === 'reasoning-start')).toBe(
      wantSignal,
    );
    expect(
      events.some((event) => event.type === 'reasoning-summary-delta'),
    ).toBe(wantSummary);
    expect(JSON.stringify(events)).toContain('case answer');
    expect(JSON.stringify(events)).not.toMatch(/forbidden/);
  },
);

it('classifies mixed summary and raw detail in a single frame while retaining only summary', async () => {
  const events = await collect(async () =>
    response(
      frame({
        reasoning_details: [
          { type: 'reasoning.text', text: 'same-frame-raw-forbidden' },
          { type: 'reasoning.summary', summary: 'same-frame-summary-safe' },
        ],
      }),
      frame({ content: 'same-frame answer survives' }),
      {
        ...frame({}),
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ),
  );
  expect(JSON.stringify(events)).toContain('same-frame-summary-safe');
  expect(JSON.stringify(events)).not.toContain('same-frame-raw-forbidden');
  expect(JSON.stringify(events)).toContain('same-frame answer survives');
});

it('preserves split UTF-8 summary bytes and rejects malformed oversized frames without echoing data', async () => {
  const payload =
    `data: ${JSON.stringify(frame({ reasoning_details: [{ type: 'reasoning.summary', summary: 'fragmented café ⚖' }] }))}\n\n` +
    `data: ${JSON.stringify(frame({ content: 'fragmented answer' }))}\n\n` +
    'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(payload);
  const split = bytes.indexOf(0xc3) + 1;
  const events = await collect(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, split));
            controller.enqueue(bytes.slice(split));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  expect(JSON.stringify(events)).toContain('fragmented café ⚖');

  const hugeCanary = 'oversized-frame-forbidden'.repeat(45_000);
  const huge = await collect(
    async () =>
      new Response(`data: ${hugeCanary}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  expect(JSON.stringify(huge)).not.toContain(hugeCanary);
  expect(huge.at(-1)).toMatchObject({
    type: 'outcome',
    outcome: { attemptOutcome: 'unknown' },
  });
});

it('sanitizes non-success provider response bodies before SDK error construction', async () => {
  const events = await collect(
    async () =>
      new Response('private-provider-error-canary K1', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
  );
  expect(JSON.stringify(events)).not.toContain('private-provider-error-canary');
  expect(JSON.stringify(events)).not.toContain('K1');
  expect(events.at(-1)).toMatchObject({
    type: 'outcome',
    outcome: { safeCode: 'AI_PROVIDER_AUTH' },
  });
});
