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

it('searches with POST and exposes owner chat rename and permanent-delete routes', async () => {
  const { createChatClient } = await import('../src/lib/chat-client.js');
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    return String(input).endsWith('/search')
      ? Response.json({ items: [], pageInfo: { nextCursor: null } })
      : new Response(null, { status: 204 });
  });
  const client = createChatClient({ baseUrl: '/api', fetch });
  await client.search({ query: 'private term' });
  await client.rename(chatId, { title: 'Renamed chat' });
  await client.delete(chatId);
  expect(
    fetch.mock.calls.map(([url, init]) => [String(url), init?.method]),
  ).toEqual([
    ['/api/chats/search', 'POST'],
    [`/api/chats/${chatId}`, 'PATCH'],
    [`/api/chats/${chatId}`, 'DELETE'],
  ]);
  expect(fetch.mock.calls[0]?.[1]?.body).toContain('private term');
  expect(fetch.mock.calls[0]?.[0]).not.toContain('private term');
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

it('serializes rapid viewed-leaf writes and reload retains the last selected branch', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const firstBranchId = '66666666-6666-4666-8666-666666666666';
  const lastBranchId = '77777777-7777-4777-8777-777777777777';
  let serverViewedLeaf = assistantId;
  const writes: Array<{ leafId: string; commit: () => void }> = [];
  let resolveSecondWriteStarted: (() => void) | undefined;
  const secondWriteStarted = new Promise<void>((resolve) => {
    resolveSecondWriteStarted = resolve;
  });
  let resolveFirstWriteStarted: (() => void) | undefined;
  const firstWriteStarted = new Promise<void>((resolve) => {
    resolveFirstWriteStarted = resolve;
  });
  const persistViewedLeaf = (leafId: string) =>
    new Promise<void>((resolve) => {
      writes.push({
        leafId,
        commit: () => {
          serverViewedLeaf = leafId;
          resolve();
        },
      });
      if (leafId === firstBranchId) resolveFirstWriteStarted?.();
      if (leafId === lastBranchId) resolveSecondWriteStarted?.();
    });
  const requests: Array<{ path: string; parentMessageId?: string | null }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/events'))
      return new Response('', {
        headers: { 'x-lexon-stream-recovery-result': 'snapshot' },
      });
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {};
    requests.push({
      path,
      ...(typeof body.parentMessageId === 'string' ||
      body.parentMessageId === null
        ? { parentMessageId: body.parentMessageId }
        : {}),
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

  const firstSelection = transport.selectLeaf(firstBranchId, () =>
    persistViewedLeaf(firstBranchId),
  );
  const lastSelection = transport.selectLeaf(lastBranchId, () =>
    persistViewedLeaf(lastBranchId),
  );
  await firstWriteStarted;
  expect(writes.map(({ leafId }) => leafId)).toEqual([firstBranchId]);
  writes[0]!.commit();
  await secondWriteStarted;
  expect(writes.map(({ leafId }) => leafId)).toEqual([
    firstBranchId,
    lastBranchId,
  ]);
  writes[1]!.commit();
  await Promise.all([firstSelection, lastSelection]);
  await transport.sendMessages({
    trigger: 'submit-message',
    chatId,
    messageId: undefined,
    messages: [
      {
        id: userId,
        role: 'user',
        parts: [{ type: 'text', text: 'After branch switch' }],
      },
    ],
    abortSignal: undefined,
  });

  expect(serverViewedLeaf).toBe(lastBranchId);
  expect(requests.at(-1)?.parentMessageId).toBe(lastBranchId);
  const reloaded = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    selectedLeafId: serverViewedLeaf,
    fetch,
  });
  await reloaded.sendMessages({
    trigger: 'submit-message',
    chatId,
    messageId: undefined,
    messages: [
      {
        id: userId,
        role: 'user',
        parts: [{ type: 'text', text: 'After reload' }],
      },
    ],
    abortSignal: undefined,
  });
  expect(requests.at(-1)?.parentMessageId).toBe(lastBranchId);
});

it('blocks a send after the selected branch write fails and restores the persisted leaf', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const selectedLeafId = '66666666-6666-4666-8666-666666666666';
  const failedLeafId = '77777777-7777-4777-8777-777777777777';
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
    selectedLeafId,
    fetch,
  });

  await expect(
    transport.selectLeaf(failedLeafId, async () => {
      throw new Error('safe failure');
    }),
  ).rejects.toThrow('safe failure');
  await expect(
    transport.sendMessages({
      trigger: 'submit-message',
      chatId,
      messageId: undefined,
      messages: [
        {
          id: userId,
          role: 'user',
          parts: [{ type: 'text', text: 'Blocked' }],
        },
      ],
      abortSignal: undefined,
    }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();

  const recovered = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    selectedLeafId,
    fetch,
  });
  await recovered.sendMessages({
    trigger: 'submit-message',
    chatId,
    messageId: undefined,
    messages: [
      { id: userId, role: 'user', parts: [{ type: 'text', text: 'Reload' }] },
    ],
    abortSignal: undefined,
  });
  const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
    parentMessageId: string;
  };
  expect(request.parentMessageId).toBe(selectedLeafId);
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

it('propagates terminal cancellation status into message metadata', async () => {
  const { createChatUIMessageStream } =
    await import('../src/lib/chat-stream.js');
  const frames = [
    { version: 1, type: 'start', runId, messageId: assistantId },
    { version: 1, type: 'status', runId, status: 'cancelled' },
    { version: 1, type: 'finish', runId },
  ];
  const response = new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const reader = createChatUIMessageStream(response).getReader();
  const chunks: unknown[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  expect(chunks).toContainEqual({
    type: 'message-metadata',
    messageMetadata: { status: 'cancelled' },
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
  const streamStates: string[] = [];
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    fetch,
    onStreamState: (state: string) => streamStates.push(state),
  } as never);

  const stream = await transport.reconnectToStream({
    chatId,
    headers: { 'last-event-id': '1:1783814399000-1' },
  });

  expect(fetch.mock.calls[0]?.[0]).toBe(`/api/runs/${runId}/events`);
  const reconnectHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
  expect(reconnectHeaders.get('last-event-id')).toBe('1:1783814399000-1');
  expect(reconnectHeaders.get('x-lexon-stream-recovery')).toBe('snapshot');
  expect(stream).not.toBeNull();
  expect(streamStates).toEqual(['reconnecting', 'connected']);
});

it('does not prove or store cursors from out-of-order or inconsistent snapshots', async () => {
  const { createChatUIMessageStream } =
    await import('../src/lib/chat-stream.js');
  const checkpointId = '1783814400000-0';
  const metadata = {
    runId,
    messageId: assistantId,
    attemptId: '55555555-5555-4555-8555-555555555555',
    generation: 1,
    revision: 3,
    eventId: checkpointId,
    status: 'completed',
    errorCode: null,
    reasoningDurationMs: null,
  };
  const start = (partCount: number, operationCount = 0) => ({
    version: 1,
    type: 'snapshot-start',
    reset: true,
    snapshot: metadata,
    partCount,
    operationCount,
  });
  const part = (
    partIndex: number,
    chunkIndex: number,
    id: string,
    final: boolean,
    text = 'part',
    partType: 'text' | 'reasoning' = 'text',
  ) => ({
    version: 1,
    type: 'snapshot-part',
    partIndex,
    chunkIndex,
    partType,
    id,
    text,
    final,
  });
  const operation = (index: number) => ({
    version: 1,
    type: 'snapshot-operation',
    index,
    operation: {
      operationId: index === 0 ? userId : assistantId,
      status: 'completed',
      approvalRequired: false,
    },
  });
  const end = (partCount: number, operationCount = 0) => ({
    version: 1,
    type: 'snapshot-end',
    partCount,
    operationCount,
  });
  const malformedSnapshots = [
    [start(2), part(1, 0, 'part-1', true), part(0, 0, 'part-0', true), end(2)],
    [
      start(1),
      part(0, 0, 'text-part-a', false),
      part(0, 1, 'text-part-b', true),
      end(1),
    ],
    [
      start(1),
      part(0, 0, 'text-part', false, 'answer', 'text'),
      part(0, 1, 'text-part', true, 'reasoning', 'reasoning'),
      end(1),
    ],
    [
      start(1, 2),
      part(0, 0, 'part-0', true),
      operation(1),
      operation(0),
      end(1, 2),
    ],
    [
      start(2, 2),
      part(0, 0, 'part-0', true),
      operation(0),
      part(1, 0, 'part-1', true),
      operation(1),
      end(2, 2),
    ],
  ];

  for (const frames of malformedSnapshots) {
    const onCursor = vi.fn();
    const onPrefix = vi.fn();
    const data = frames
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join('');
    const ending = JSON.stringify(frames.at(-1));
    const body = data.replace(
      `data: ${ending}`,
      `id: 1:${checkpointId}\ndata: ${ending}`,
    );
    const stream = createChatUIMessageStream(
      new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
      }),
      { onCursor, onPrefix },
    );
    const reader = stream.getReader();
    let sawFinish = false;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value.type === 'finish') sawFinish = true;
    }
    expect(onCursor).not.toHaveBeenCalled();
    expect(onPrefix).not.toHaveBeenCalled();
    expect(sawFinish).toBe(false);
  }
});

it('finishes a successful terminal snapshot when browser storage removal throws', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const frames = [
    {
      version: 1,
      type: 'snapshot-start',
      reset: true,
      snapshot: {
        runId,
        messageId: assistantId,
        attemptId: null,
        generation: null,
        revision: 0,
        eventId: null,
        status: 'completed',
        errorCode: null,
        reasoningDurationMs: null,
      },
      partCount: 0,
      operationCount: 0,
    },
    { version: 1, type: 'snapshot-end', partCount: 0, operationCount: 0 },
  ];
  const fetch = vi.fn(
    async () =>
      new Response(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        },
      ),
  );
  const removeItem = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(() => {
      throw new Error('Storage denied');
    });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    fetch,
  });

  const stream = await transport.reconnectToStream({ chatId, headers: {} });
  if (!stream) throw new Error('Expected terminal recovery stream');
  const reader = stream.getReader();
  let finishReason: string | undefined;
  const chunkTypes: string[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunkTypes.push(result.value.type);
    if (result.value.type === 'finish')
      finishReason = result.value.finishReason;
  }

  expect(chunkTypes).toContain('finish');
  expect(finishReason).toBe('stop');
  expect(removeItem).toHaveBeenCalled();
  removeItem.mockRestore();
});

it('finishes recovery when the sessionStorage property getter is denied', async () => {
  const { LexonChatTransport } = await import('../src/lib/chat-transport.js');
  const cursor = '1:1783814400000-2';
  const frames = [
    {
      version: 1,
      type: 'snapshot-start',
      reset: true,
      snapshot: {
        runId,
        messageId: assistantId,
        attemptId: '55555555-5555-4555-8555-555555555555',
        generation: 1,
        revision: 1,
        eventId: '1783814400000-2',
        status: 'completed',
        errorCode: null,
        reasoningDurationMs: null,
      },
      partCount: 0,
      operationCount: 0,
    },
  ];
  const fetch = vi.fn(
    async () =>
      new Response(
        [
          `data: ${JSON.stringify(frames[0])}\n\n`,
          `id: ${cursor}\ndata: ${JSON.stringify({ version: 1, type: 'snapshot-end', partCount: 0, operationCount: 0 })}\n\n`,
        ].join(''),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        },
      ),
  );
  const getter = vi
    .spyOn(globalThis, 'sessionStorage', 'get')
    .mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });

  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    fetch,
  });
  const stream = await transport.reconnectToStream({ chatId, headers: {} });
  if (!stream) throw new Error('Expected terminal recovery stream');
  const reader = stream.getReader();
  let finishReason: string | undefined;
  const chunkTypes: string[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunkTypes.push(result.value.type);
    if (result.value.type === 'finish')
      finishReason = result.value.finishReason;
  }

  expect(chunkTypes).toContain('finish');
  expect(finishReason).toBe('stop');
  expect(getter).toHaveBeenCalledTimes(3);
  getter.mockRestore();
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
