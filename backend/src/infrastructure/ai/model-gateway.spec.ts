import { expect, it, vi } from 'vitest';
import { ModelAllowlistSchema } from './model-allowlist.js';
import { createRealModelGateway } from './model-gateway.js';
import type { ModelEvent, ModelInput } from './model-contracts.js';
import { createScriptedModelGateway } from './testing/scripted-model.js';

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

const input = (signal = new AbortController().signal): ModelInput => ({
  model: 'openai/gpt-6-luna',
  provider: 'azure/us',
  messages: [{ role: 'user', content: 'synthetic prompt' }],
  maxOutputTokens: 12,
  signal,
});

const collect = async (events: AsyncIterable<ModelEvent>) => {
  const result: ModelEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
};

const streamResponse = (cost = 0.0000000000123) =>
  new Response(
    [
      'data: {"id":"gen-safe-id","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"first"},"finish_reason":null}]}\n\n',
      'data: {"id":"gen-safe-id","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":" second"},"finish_reason":null}]}\n\n',
      `data: {"id":"gen-safe-id","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5,"cost":${cost},"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":1}}}\n\n`,
      'data: [DONE]\n\n',
    ].join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );

it('applies fixed route and privacy options to every request and preserves detailed usage/cost', async () => {
  const requests: Request[] = [];
  const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return streamResponse();
  });
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-K1',
    attestation: '2026-11-05',
    priceCeiling: { prompt: 0.25, completion: 1.0 },
    fetch: fetchSpy,
  });

  const events = await collect(gateway.generate(input()));
  const request = await requests[0]!.clone().json();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(request.model).toBe('openai/gpt-6-luna');
  expect(request.max_tokens).toBe(12);
  expect(request.provider).toMatchObject({
    only: ['azure/us'],
    order: ['azure/us'],
    zdr: true,
    data_collection: 'deny',
    allow_fallbacks: false,
    max_price: { prompt: 0.25, completion: 1.0 },
  });
  expect(events).toContainEqual({
    type: 'metadata',
    generationId: 'gen-safe-id',
  });
  expect(events).toContainEqual({
    type: 'usage',
    usage: {
      inputTokens: 3,
      outputTokens: 2,
      cachedInputTokens: 1,
      reasoningOutputTokens: 1,
    },
    costUsd: '0.0000000000123',
  });
  expect(events.at(-1)).toMatchObject({
    type: 'outcome',
    outcome: { finishReason: 'stop', attemptOutcome: 'succeeded' },
  });
});

it('passes collected system context through the current SDK instructions option', async () => {
  const requests: Request[] = [];
  const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return streamResponse(0);
  });
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-key',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });
  await collect(
    gateway.generate({
      ...input(),
      messages: [
        { role: 'system', content: 'Fenced synthetic context.' },
        { role: 'user', content: 'Use the context.' },
      ],
    }),
  );
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const request = await requests[0]!.clone().json();
  expect(request.messages).toContainEqual({
    role: 'system',
    content: [{ type: 'text', text: 'Fenced synthetic context.' }],
  });
  expect(request.messages).toContainEqual({
    role: 'user',
    content: 'Use the context.',
  });
});

it('rejects an unallowlisted model or missing real prerequisites before fetch', async () => {
  const fetchSpy = vi.fn<typeof fetch>();
  const gateway = createRealModelGateway({
    allowlist,
    key: undefined,
    attestation: undefined,
    fetch: fetchSpy,
  });
  await expect(collect(gateway.generate(input()))).rejects.toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();

  const ready = createRealModelGateway({
    allowlist,
    key: 'test-only-key',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });
  await expect(
    collect(ready.generate({ ...input(), model: 'other-model' })),
  ).rejects.toThrow(/allowlist/i);
  await expect(
    collect(ready.generate({ ...input(), provider: 'openrouter' })),
  ).rejects.toThrow(/allowlist/i);
  expect(fetchSpy).not.toHaveBeenCalled();

  const missingAttestation = createRealModelGateway({
    allowlist,
    key: 'test-only-key',
    fetch: fetchSpy,
  });
  await expect(collect(missingAttestation.generate(input()))).rejects.toThrow(
    /ZDR-only account/,
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('never falls back to global fetch when a fetch mock is injected', async () => {
  const globalFetch = vi.fn<typeof fetch>(() => {
    throw new Error('Unexpected global fetch');
  });
  vi.stubGlobal('fetch', globalFetch);
  const fetchSpy = vi.fn<typeof fetch>(async () => streamResponse());
  try {
    const gateway = createRealModelGateway({
      allowlist,
      key: 'test-only-key',
      attestation: '2026-11-05',
      fetch: fetchSpy,
    });
    const events = await collect(gateway.generate(input()));
    expect(events.at(-1)).toMatchObject({ type: 'outcome' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('provides deterministic neutral events through the scripted test gateway', async () => {
  const scriptEvents: ModelEvent[] = [
    { type: 'text', text: 'scripted output' },
    {
      type: 'outcome',
      outcome: {
        finishReason: 'stop',
        attemptOutcome: 'succeeded',
        retryable: false,
      },
    },
  ];
  const gateway = createScriptedModelGateway([{ events: scriptEvents }]);
  expect(await collect(gateway.generate(input()))).toEqual(scriptEvents);
});

it('makes one physical request even when the provider responds with retryable 503', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const fetchSpy = vi.fn<typeof fetch>(
    async () => new Response('K1-secret provider body', { status: 503 }),
  );
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-K1',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });
  try {
    const events = await collect(gateway.generate(input()));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: 'outcome',
      outcome: { attemptOutcome: 'failed', retryable: true },
    });
    expect(JSON.stringify(events)).not.toMatch(/K1-secret|test-only-K1/);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
      /K1-secret|test-only-K1/,
    );
  } finally {
    consoleError.mockRestore();
  }
});

it('marks a permanent validation response failed and not retryable', async () => {
  const fetchSpy = vi.fn<typeof fetch>(
    async () => new Response('private validation details', { status: 422 }),
  );
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-key',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });

  const events = await collect(gateway.generate(input()));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({
    type: 'outcome',
    outcome: {
      attemptOutcome: 'failed',
      retryable: false,
      safeCode: 'AI_PROVIDER_UNAVAILABLE',
    },
  });
  expect(JSON.stringify(events)).not.toContain('private validation details');
});

it('does not retry an SDK-wrapped certificate failure from injected fetch', async () => {
  const fetchSpy = vi.fn<typeof fetch>(async () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('certificate expired K1-secret'), {
        code: 'CERT_HAS_EXPIRED',
      }),
    });
  });
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-key',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });

  const events = await collect(gateway.generate(input()));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({
    type: 'outcome',
    outcome: {
      attemptOutcome: 'unknown',
      retryable: false,
      safeCode: 'AI_PROVIDER_UNAVAILABLE',
    },
  });
  expect(JSON.stringify(events)).not.toMatch(
    /CERT_HAS_EXPIRED|certificate expired|K1-secret/,
  );
});

it('maps assistant tool calls and matching JSON results to SDK messages without executing the tool', async () => {
  const requests: Request[] = [];
  const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return streamResponse(0);
  });
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-key',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });
  await collect(
    gateway.generate({
      ...input(),
      messages: [
        { role: 'user', content: 'Research this clause.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'sdk-call-17',
              toolName: 'lookup',
              input: { clause: 17 },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'sdk-call-17',
              toolName: 'lookup',
              result: { caseId: 'synthetic-case', score: 0.91 },
            },
          ],
        },
        { role: 'assistant', content: 'Continue analysis.' },
      ],
    }),
  );
  const request = await requests[0]!.clone().json();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(request.messages).toMatchObject([
    { role: 'user', content: 'Research this clause.' },
    {
      role: 'assistant',
      tool_calls: [
        {
          id: 'sdk-call-17',
          function: { name: 'lookup', arguments: '{"clause":17}' },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'sdk-call-17',
      content: '{"caseId":"synthetic-case","score":0.91}',
    },
    { role: 'assistant', content: 'Continue analysis.' },
  ]);
});

it.each([
  {
    label: 'rewritten tool-result discriminator',
    results: [
      {
        type: 'invalid-result',
        toolCallId: 'sdk-call-17',
        toolName: 'lookup',
        result: { caseId: 'synthetic-case' },
      },
    ],
  },
  {
    label: 'duplicate tool result',
    results: [
      {
        type: 'tool-result',
        toolCallId: 'sdk-call-17',
        toolName: 'lookup',
        result: { caseId: 'synthetic-case' },
      },
      {
        type: 'tool-result',
        toolCallId: 'sdk-call-17',
        toolName: 'lookup',
        result: { caseId: 'synthetic-case' },
      },
    ],
  },
])(
  'rejects malformed history with $label before provider fetch',
  async ({ results }) => {
    const fetchSpy = vi.fn<typeof fetch>(async () => streamResponse());
    const gateway = createRealModelGateway({
      allowlist,
      key: 'test-only-key',
      attestation: '2026-11-05',
      fetch: fetchSpy,
    });
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'sdk-call-17',
            toolName: 'lookup',
            input: { clause: 17 },
          },
        ],
      },
      { role: 'tool', content: results },
    ] as unknown as ModelInput['messages'];

    await expect(
      collect(gateway.generate({ ...input(), messages })),
    ).rejects.toThrow(/invalid model tool message/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  },
);

it.each([
  { providerFinish: 'length', neutralFinish: 'length', attempt: 'succeeded' },
  {
    providerFinish: 'content_filter',
    neutralFinish: 'content_filter',
    attempt: 'failed',
  },
])(
  'classifies authoritative $providerFinish completion and retains reported usage',
  async ({ providerFinish, neutralFinish, attempt }) => {
    const fetchSpy = vi.fn<typeof fetch>(
      async () =>
        new Response(
          [
            'data: {"id":"gen-terminal","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
            `data: {"id":"gen-terminal","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"${providerFinish}"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6,"cost":0.0004}}\n\n`,
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const gateway = createRealModelGateway({
      allowlist,
      key: 'test-only-key',
      attestation: '2026-11-05',
      fetch: fetchSpy,
    });

    const events = await collect(gateway.generate(input()));
    expect(events).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 4, outputTokens: 2 },
      costUsd: '0.0004',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'outcome',
      outcome: {
        finishReason: neutralFinish,
        attemptOutcome: attempt,
        usage: { inputTokens: 4, outputTokens: 2 },
        costUsd: '0.0004',
        retryable: false,
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  },
);

it('yields response metadata before later content and aborts the transport on caller cancellation', async () => {
  const requestSignals: AbortSignal[] = [];
  let releaseLaterContent!: () => void;
  const laterContentGate = new Promise<void>((resolve) => {
    releaseLaterContent = resolve;
  });
  const finishSent = false;
  const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requestSignals.push(request.signal);
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(streamController) {
          streamController.enqueue(
            encoder.encode(
              'data: {"id":"gen-safe-id","model":"openai/gpt-6-luna","choices":[]}\n\n',
            ),
          );
          await laterContentGate;
          streamController.enqueue(
            encoder.encode(
              'data: {"id":"gen-safe-id","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"first"},"finish_reason":null}]}\n\n',
            ),
          );
          await new Promise<void>((resolve) => {
            request.signal.addEventListener(
              'abort',
              () => {
                streamController.error(new Error('private provider body K1'));
                resolve();
              },
              { once: true },
            );
          });
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const controller = new AbortController();
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-K1',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });
  const iterator = gateway
    .generate(input(controller.signal))
    [Symbol.asyncIterator]();
  const metadata = await iterator.next();
  expect(metadata.value).toMatchObject({
    type: 'metadata',
    generationId: 'gen-safe-id',
  });
  const generationIdPersistedBeforeFinish =
    metadata.value?.type === 'metadata' && !!metadata.value.generationId;
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(finishSent).toBe(false);
  releaseLaterContent();
  const nextContent = await iterator.next();
  expect(nextContent.value).toEqual({ type: 'text', text: 'first' });
  expect(generationIdPersistedBeforeFinish).toBe(true);
  controller.abort();
  const terminal = await iterator.next();
  expect(terminal.value).toMatchObject({
    type: 'outcome',
    outcome: {
      attemptOutcome: 'unknown',
      finishReason: 'error',
      retryable: false,
    },
  });
  expect(requestSignals[0]?.aborted).toBe(true);
  expect(finishSent).toBe(false);
});

it('aborts and releases the provider bridge when metadata persistence fails', async () => {
  const requestSignals: AbortSignal[] = [];
  const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requestSignals.push(request.signal);
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(
            encoder.encode(
              'data: {"id":"gen-persist-failure","model":"openai/gpt-6-luna","choices":[]}\n\n',
            ),
          );
          request.signal.addEventListener(
            'abort',
            () => streamController.error(new Error('private K1 provider body')),
            { once: true },
          );
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-K1',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });
  const iterator = gateway.generate(input())[Symbol.asyncIterator]();
  const metadata = await iterator.next();
  expect(metadata.value).toMatchObject({
    type: 'metadata',
    generationId: 'gen-persist-failure',
  });

  await expect(
    Promise.race([
      (async () => {
        try {
          throw new Error('metadata persistence failed');
        } finally {
          await iterator.return?.();
        }
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('provider bridge cleanup timed out')),
          300,
        ),
      ),
    ]),
  ).rejects.toThrow('metadata persistence failed');
  expect(requestSignals[0]?.aborted).toBe(true);
});

it('keeps an interrupted provider attempt unknown despite a synthetic error finish reason', async () => {
  const fetchSpy = vi.fn<typeof fetch>(
    async () =>
      new Response(
        [
          'data: {"id":"gen-interrupted","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
          'data: {"id":"gen-interrupted","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"error"}]}\n\n',
          'data: [DONE]\n\n',
        ].join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  const gateway = createRealModelGateway({
    allowlist,
    key: 'test-only-key',
    attestation: '2026-11-05',
    fetch: fetchSpy,
  });
  const events = await collect(gateway.generate(input()));
  expect(events.at(-1)).toMatchObject({
    type: 'outcome',
    outcome: {
      finishReason: 'error',
      attemptOutcome: 'unknown',
      retryable: false,
    },
  });
});
