import { expect, it, vi } from 'vitest';

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const assistantId = '44444444-4444-4444-8444-444444444444';

it('uses the same-origin chat API and validates its persisted tree', async () => {
  const { createChatClient } = await import('../src/lib/chat-client.js');
  const fetch = vi.fn(async () =>
    Response.json({
      id: chatId,
      title: 'Employment contract',
      messages: [
        {
          id: userId,
          role: 'user',
          parentId: null,
          text: 'Review this clause',
          effort: 'high',
          createdAt: '2026-11-11T00:00:00.000Z',
        },
        {
          id: assistantId,
          role: 'assistant',
          parentId: userId,
          runId,
          text: 'A persisted answer.',
          status: 'completed',
          reasoningSummary: null,
          reasoningDurationMs: null,
          feedback: null,
          createdAt: '2026-11-11T00:00:01.000Z',
        },
      ],
      viewedLeafId: assistantId,
      createdAt: '2026-11-11T00:00:00.000Z',
      updatedAt: '2026-11-11T00:00:01.000Z',
    }),
  );
  const client = createChatClient({ baseUrl: '/api', fetch });

  await expect(client.get(chatId)).resolves.toMatchObject({
    id: chatId,
    viewedLeafId: assistantId,
    messages: [{ id: userId }, { id: assistantId, parentId: userId }],
  });
  expect(fetch).toHaveBeenCalledWith(
    `/api/chats/${chatId}`,
    expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
  );
});

it('invokes the browser fetch function with its Window receiver', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const receivers: unknown[] = [];
  const fetchWithWindowReceiver = function (
    this: typeof globalThis,
    input: RequestInfo | URL,
  ) {
    receivers.push(this);
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    if (String(input).endsWith('/events'))
      return Promise.resolve(
        new Response('', {
          headers: { 'x-lexon-stream-recovery-result': 'snapshot' },
        }),
      );
    return Promise.resolve(Response.json({}));
  };
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    fetch: fetchWithWindowReceiver,
  });

  await transport.stopRun();
  await transport.reconnectToStream({ chatId, headers: {} });

  expect(receivers).toEqual([globalThis, globalThis]);
});

it('maps an explicit branch edit to IDs-only backend mutation data', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    if (String(input).endsWith('/events'))
      return new Response('', {
        headers: { 'x-lexon-stream-recovery-result': 'snapshot' },
      });
    return Response.json(
      { chatId, userMessageId: userId, assistantMessageId: assistantId, runId },
      { status: 201 },
    );
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    fetch,
  });

  await transport.sendMessages({
    trigger: 'submit-message',
    chatId,
    messageId: undefined,
    messages: [
      { id: userId, role: 'user', parts: [{ type: 'text', text: 'New text' }] },
    ],
    abortSignal: undefined,
  });

  expect(fetch).toHaveBeenCalledWith(
    `/api/chats/${chatId}/messages`,
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('parentMessageId'),
    }),
  );
  const body = JSON.parse(fetch.mock.calls[0]![1]?.body as string) as Record<
    string,
    unknown
  >;
  expect(Object.keys(body).sort()).toEqual(
    ['effort', 'parentMessageId', 'text', 'userMessageId'].sort(),
  );
  expect(body.text).toBe('New text');
  expect(body.parentMessageId).toBeNull();
});

it('uses the explicitly selected server leaf as the new user parent, never the SDK list predecessor', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const oldBranchAssistantId = '66666666-6666-4666-8666-666666666666';
  const selectedLeafId = '77777777-7777-4777-8777-777777777777';
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    if (String(input).endsWith('/events'))
      return new Response('', {
        headers: { 'x-lexon-stream-recovery-result': 'snapshot' },
      });
    return Response.json(
      {
        chatId,
        userMessageId: assistantId,
        assistantMessageId: assistantId,
        runId,
      },
      { status: 201 },
    );
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    selectedLeafId,
    fetch,
  });

  await transport.sendMessages({
    trigger: 'submit-message',
    chatId,
    messageId: undefined,
    messages: [
      {
        id: userId,
        role: 'user',
        parts: [{ type: 'text', text: 'prompt on chosen branch' }],
      },
      {
        id: oldBranchAssistantId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'stale SDK predecessor' }],
      },
    ],
    abortSignal: undefined,
  });

  const mutation = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<
    string,
    unknown
  >;
  expect(mutation.parentMessageId).toBe(selectedLeafId);
});

it('routes a public runtime edit to the source user and a fresh message ID', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    if (String(input).endsWith('/events'))
      return new Response('', {
        headers: { 'x-lexon-stream-recovery-result': 'snapshot' },
      });
    return Response.json(
      {
        chatId,
        userMessageId: assistantId,
        assistantMessageId: assistantId,
        runId,
      },
      { status: 201 },
    );
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    fetch,
  });
  await transport.sendMessages({
    trigger: 'submit-message',
    chatId,
    messageId: undefined,
    messages: [
      {
        id: assistantId,
        role: 'user',
        metadata: { chatOperation: { type: 'edit', sourceId: userId } },
        parts: [{ type: 'text', text: 'Changed wording' }],
      },
    ],
    abortSignal: undefined,
  });
  const [path, options] = fetch.mock.calls[0]!;
  expect(path).toBe(`/api/chats/${chatId}/messages/${userId}/edit`);
  expect(JSON.parse(String(options?.body))).toEqual({
    messageId: userId,
    newMessageId: assistantId,
    text: 'Changed wording',
    effort: 'high',
  });
});

it('regenerates the explicitly selected server answer when the public adapter omits messageId', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    if (String(input).endsWith('/events'))
      return new Response('', {
        headers: { 'x-lexon-stream-recovery-result': 'snapshot' },
      });
    return Response.json(
      { chatId, userMessageId: userId, assistantMessageId: assistantId, runId },
      { status: 201 },
    );
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    selectedLeafId: assistantId,
    fetch,
  });

  await transport.sendMessages({
    trigger: 'regenerate-message',
    chatId,
    messageId: undefined,
    messages: [],
    abortSignal: undefined,
  });

  expect(fetch.mock.calls[0]?.[0]).toBe(
    `/api/chats/${chatId}/messages/${assistantId}/regenerate`,
  );
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
    messageId: assistantId,
  });
});

it('reconnects with the exact Last-Event-ID and replaces a reset snapshot', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const frames = [
    { type: 'snapshot-reset', version: 1, reason: 'cursor-gap' },
    {
      type: 'snapshot-start',
      version: 1,
      reset: true,
      snapshot: {
        runId,
        messageId: assistantId,
        attemptId: '55555555-5555-4555-8555-555555555555',
        generation: 1,
        revision: 3,
        eventId: '1:1783814400000-0',
        status: 'running',
        errorCode: null,
        reasoningDurationMs: null,
      },
      partCount: 1,
      operationCount: 0,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 0,
      chunkIndex: 0,
      partType: 'text',
      id: 'attempt-1',
      text: 'Current answer',
      final: true,
    },
    { type: 'snapshot-end', version: 1, partCount: 1, operationCount: 0 },
  ];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return new Response(
      frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
      {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      },
    );
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    fetch,
  });

  const stream = await transport.reconnectToStream({
    chatId,
    headers: { 'last-event-id': '1:1783814399000-1' },
  });

  expect(fetch.mock.calls[0]?.[0]).toBe(`/api/runs/${runId}/events`);
  const reconnectHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
  expect(reconnectHeaders.get('last-event-id')).toBe('1:1783814399000-1');
  expect(reconnectHeaders.get('x-lexon-stream-recovery')).toBe('snapshot');
  expect(stream).not.toBeNull();
});

it('proves a replay prefix and stores its checkpoint only after snapshot-end', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const cursor = '1:1783814400000-2';
  const snapshot = [
    {
      type: 'snapshot-start',
      version: 1,
      reset: true,
      snapshot: {
        runId,
        messageId: assistantId,
        attemptId: '55555555-5555-4555-8555-555555555555',
        generation: 1,
        revision: 3,
        eventId: '1783814400000-2',
        status: 'running',
        errorCode: null,
        reasoningDurationMs: null,
      },
      partCount: 1,
      operationCount: 0,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 0,
      chunkIndex: 0,
      partType: 'text',
      id: 'attempt-1',
      text: 'Checkpoint prefix',
      final: true,
    },
  ];
  const sse = (frames: readonly unknown[], endId?: string) =>
    [
      ...frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`),
      ...(endId
        ? [
            `id: ${endId}\ndata: ${JSON.stringify({ type: 'snapshot-end', version: 1, partCount: 1, operationCount: 0 })}\n\n`,
          ]
        : []),
    ].join('');
  const interruptedFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(sse(snapshot), {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    },
  );
  const interrupted = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    fetch: interruptedFetch,
  });
  const interruptedStream = await interrupted.reconnectToStream({
    chatId,
    headers: {},
  });
  if (!interruptedStream)
    throw new Error('The active run stream was unavailable');
  const interruptedReader = interruptedStream.getReader();
  while (!(await interruptedReader.read()).done) {
    /* Drain the partial attempt. */
  }
  expect(
    sessionStorage.getItem(`lexon-chat-recovery:tenant-1:user-1:${chatId}`),
  ).toBeNull();
  await interrupted.reconnectToStream({ chatId, headers: {} });
  expect(
    new Headers(interruptedFetch.mock.calls[1]?.[1]?.headers).get(
      'x-lexon-stream-recovery',
    ),
  ).toBe('snapshot');

  const completeFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(sse(snapshot, cursor), {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    },
  );
  const complete = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-2',
    initialRunId: runId,
    fetch: completeFetch,
  });
  const completeStream = await complete.reconnectToStream({
    chatId,
    headers: {},
  });
  if (!completeStream) throw new Error('The active run stream was unavailable');
  const completeReader = completeStream.getReader();
  while (!(await completeReader.read()).done) {
    /* Drain the complete snapshot. */
  }
  expect(
    JSON.parse(
      sessionStorage.getItem(`lexon-chat-recovery:tenant-1:user-2:${chatId}`) ??
        '{}',
    ),
  ).toMatchObject({ runId, cursor });
  await complete.reconnectToStream({ chatId, headers: {} });
  expect(
    new Headers(completeFetch.mock.calls[1]?.[1]?.headers).get(
      'x-lexon-stream-recovery',
    ),
  ).toBe('incremental');
});

it('cancels an open response reader when the chat transport is disposed', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true;
    },
  });
  const fetch = vi.fn(
    async () =>
      new Response(body, {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'incremental',
        },
      }),
  );
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    fetch,
  });
  const stream = await transport.reconnectToStream({ chatId, headers: {} });
  if (!stream) throw new Error('The active run stream was unavailable');
  const responseReader = stream.getReader();
  void responseReader.read();

  transport.close();

  await vi.waitFor(() => expect(canceled).toBe(true));
  await responseReader.cancel().catch(() => {});
});

it('aborts an events request that is still waiting for response headers on disposal', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  let requestSignal: AbortSignal | undefined;
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    void _input;
    requestSignal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-3',
    initialRunId: runId,
    fetch,
  });
  const opening = transport.reconnectToStream({ chatId, headers: {} });

  await vi.waitFor(() => expect(requestSignal).toBeDefined());
  transport.close();

  await expect(opening).rejects.toMatchObject({
    code: 'AI_PROVIDER_UNAVAILABLE',
  });
  expect(requestSignal?.aborted).toBe(true);
});

it('does not persist a cursor from an id-bearing malformed event', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  sessionStorage.removeItem(`lexon-chat-recovery:tenant-1:user-2:${chatId}`);
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return new Response(
      'id: 1:1783814400000-2\ndata: {"type":"text-delta","version":1}\n\n',
      {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'incremental',
        },
      },
    );
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-2',
    initialRunId: runId,
    fetch,
  });
  const stream = await transport.reconnectToStream({ chatId, headers: {} });
  if (!stream) throw new Error('The active run stream was unavailable');
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    /* Drain the malformed event. */
  }

  expect(
    sessionStorage.getItem(`lexon-chat-recovery:tenant-1:user-2:${chatId}`),
  ).toBeNull();
  await transport.reconnectToStream({ chatId, headers: {} });
  expect(
    new Headers(fetch.mock.calls[1]?.[1]?.headers).get(
      'x-lexon-stream-recovery',
    ),
  ).toBe('snapshot');
});
