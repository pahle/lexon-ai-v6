import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useChat } from '@ai-sdk/react';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { useAISDKRuntime } from '@assistant-ui/ai-sdk';
import {
  ComposerPrimitive,
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  type ThreadMessage,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  useAui,
} from '@assistant-ui/react';
import type { ChatTree } from '@lexon/contracts';
import {
  ChatComposerCancel,
  ChatRuntime,
} from '../src/components/chat/chat-runtime.js';
import {
  ProofMessage,
  RuntimeProofControls,
} from './fixtures/chat-runtime-proof.js';
import {
  LexonChatTransport,
  type ChatUIMessage,
} from '../src/lib/chat-transport.js';
import { expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const makeMessage = (
  id: string,
  role: 'user' | 'assistant',
  text: string,
): UIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
});

it('seeds the persisted parent-linked tree once and reports an explicit branch switch', async () => {
  const user = makeMessage('user-1', 'user', 'Question');
  const answerA = makeMessage('answer-a', 'assistant', 'Answer A');
  const answerB = makeMessage('answer-b', 'assistant', 'Answer B');
  const onBranchChange = vi.fn();
  let runtime: ReturnType<typeof useAISDKRuntime> | undefined;

  function Probe() {
    const chat = useChat({ id: 'chat-1', resume: false });
    runtime = useAISDKRuntime(chat, {
      messageRepository: {
        headId: answerA.id,
        messages: [
          { parentId: null, message: user },
          { parentId: user.id, message: answerA },
          { parentId: user.id, message: answerB },
        ],
      },
      unstable_onBranchChange: onBranchChange,
    });
    return <AssistantRuntimeProvider runtime={runtime} />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  expect(runtime).toBeDefined();
  expect(
    runtime!.thread.getState().messages.map((message) => message.id),
  ).toEqual(['user-1', 'answer-a']);

  await act(async () =>
    runtime!.thread.getMessageById('answer-a').switchToBranch({
      branchId: 'answer-b',
    }),
  );
  expect(
    runtime!.thread.getState().messages.map((message) => message.id),
  ).toEqual(['user-1', 'answer-b']);
  expect(onBranchChange).toHaveBeenCalledWith({
    headId: 'answer-b',
    visibleMessageIds: ['user-1', 'answer-b'],
  });

  await act(async () => root.unmount());
});

it('routes the visible composer Stop control through server cancellation before stream abort', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const stopOrder: string[] = [];
  let bodyCancelled = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/runs/${runId}/cancel`) {
      expect(init?.method).toBe('POST');
      stopOrder.push('server-cancel');
      return new Response(null, { status: 204 });
    }
    expect(url).toBe(`/api/runs/${runId}/events`);
    return new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          bodyCancelled = true;
          stopOrder.push('stream-abort');
        },
      }),
      {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      },
    );
  });
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', fetch);
  const tree: ChatTree = {
    id: chatId,
    title: 'Runtime proof',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Question',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: assistantId,
        role: 'assistant',
        parentId: userId,
        runId,
        text: 'Partial answer',
        status: 'running',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: assistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:01.000Z',
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={chatId} tree={tree}>
        <ThreadPrimitive.Root>
          <ComposerPrimitive.Root>
            <ChatComposerCancel>Stop</ChatComposerCancel>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </ChatRuntime>,
    );
  });
  await act(async () => Promise.resolve());

  expect(
    fetch.mock.calls.some(([input]) => String(input).endsWith('/events')),
  ).toBe(true);
  const stopButton = container.querySelector<HTMLButtonElement>('button');
  if (!stopButton)
    throw new Error('The visible Composer Stop control is missing.');
  await act(async () => {
    stopButton.click();
    await Promise.resolve();
  });

  expect(fetch.mock.calls.map(([input]) => String(input))).toContain(
    `/api/runs/${runId}/cancel`,
  );
  expect(bodyCancelled).toBe(true);
  expect(stopOrder).toEqual(['server-cancel', 'stream-abort']);
  await act(async () => root.unmount());
  vi.stubGlobal('fetch', originalFetch);
});

it('keeps the full external repository when the visible server branch changes', async () => {
  const onBranchChange = vi.fn();
  const hiddenSibling = makeMessage('answer-b', 'assistant', 'Answer B');
  const repository = ExportedMessageRepository.fromBranchableArray(
    [
      {
        parentId: null,
        message: { id: 'user-1', role: 'user', content: 'Question' },
      },
      {
        parentId: 'user-1',
        message: { id: 'answer-a', role: 'assistant', content: 'Answer A' },
      },
      {
        parentId: 'user-1',
        message: {
          id: hiddenSibling.id,
          role: 'assistant',
          content: 'Answer B',
        },
      },
    ],
    { headId: 'answer-a' },
  );
  let runtime: ReturnType<typeof useExternalStoreRuntime> | undefined;

  function Probe() {
    runtime = useExternalStoreRuntime<ThreadMessage>({
      messageRepository: repository,
      setMessages: () => {},
      onNew: async () => {},
      unstable_onBranchChange: onBranchChange,
    });
    return <AssistantRuntimeProvider runtime={runtime} />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await act(async () =>
    runtime!.thread
      .getMessageById('answer-a')
      .switchToBranch({ branchId: 'answer-b' }),
  );

  expect(onBranchChange).toHaveBeenCalledWith({
    headId: 'answer-b',
    visibleMessageIds: ['user-1', 'answer-b'],
  });
  expect(
    runtime!.thread
      .export()
      .messages.map(({ message }) => message.id)
      .sort(),
  ).toEqual(['answer-a', 'answer-b', 'user-1'].sort());
  expect(repository.messages.map(({ message }) => message.id).sort()).toEqual(
    ['answer-a', 'answer-b', 'user-1'].sort(),
  );
  await act(async () => root.unmount());
});

it('renders the exact persisted chat tree through ChatRuntime after an asynchronous tree load', async () => {
  const tree: ChatTree = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Runtime proof',
    messages: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        role: 'user',
        parentId: null,
        text: 'baseline runtime proof prompt',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        role: 'assistant',
        parentId: '22222222-2222-4222-8222-222222222222',
        runId: '44444444-4444-4444-8444-444444444444',
        text: 'Scripted answer: baseline runtime proof prompt',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:01.000Z',
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages>
            {() => <ProofMessage />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>
      </ChatRuntime>,
    );
  });

  expect(container.textContent).toContain(
    'Scripted answer: baseline runtime proof prompt',
  );
  expect(
    container
      .querySelector('[data-role="assistant"]')
      ?.getAttribute('data-part-state'),
  ).toBe('[{"type":"text","textLength":46}]');
  await act(async () => root.unmount());
});

it('settles the public runtime on terminal finish while the SSE response body remains open', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const snapshotSse = (status: 'running' | 'completed', text: string) => {
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
          status,
          errorCode: null,
          reasoningDurationMs: null,
        },
        partCount: 1,
        operationCount: 0,
      },
      {
        version: 1,
        type: 'snapshot-part',
        partIndex: 0,
        chunkIndex: 0,
        partType: 'text',
        id: 'answer-text',
        text,
        final: true,
      },
      {
        version: 1,
        type: 'snapshot-end',
        partCount: 1,
        operationCount: 0,
      },
    ];
    return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
  };
  let bodyCancelled = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let requestSignal: AbortSignal | undefined;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(`/api/runs/${runId}/events`);
    requestSignal = init?.signal ?? undefined;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(
            new TextEncoder().encode(snapshotSse('running', 'Partial answer.')),
          );
        },
        cancel() {
          bodyCancelled = true;
        },
      }),
      {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      },
    );
  });
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', fetch);
  const tree: ChatTree = {
    id: chatId,
    title: 'Runtime proof',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Question',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: assistantId,
        role: 'assistant',
        parentId: userId,
        runId,
        text: 'Partial answer',
        status: 'running',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: assistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:01.000Z',
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  let finishQueued = false;
  let sawRunning = false;
  let resolveRunning: (() => void) | undefined;
  let resolveSettled: (() => void) | undefined;
  const runtimeRunning = new Promise<void>((resolve) => {
    resolveRunning = resolve;
  });
  const runtimeSettled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  function RuntimeState() {
    const isRunning = useAuiState((state) => state.thread.isRunning);
    useEffect(() => {
      if (isRunning) {
        sawRunning = true;
        resolveRunning?.();
      } else if (finishQueued && sawRunning) {
        resolveSettled?.();
      }
    }, [isRunning]);
    return (
      <output data-testid="runtime-is-running">{String(isRunning)}</output>
    );
  }

  try {
    await act(async () => {
      root.render(
        <ChatRuntime actorScope="tenant-1:user-1" chatId={chatId} tree={tree}>
          <RuntimeProofControls />
          <ThreadPrimitive.Root>
            <ThreadPrimitive.Messages>
              {() => <ProofMessage />}
            </ThreadPrimitive.Messages>
            <ComposerPrimitive.Root>
              <ComposerPrimitive.Input aria-label="Message" />
              <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
            <RuntimeState />
          </ThreadPrimitive.Root>
        </ChatRuntime>,
      );
    });
    await act(async () => runtimeRunning);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Partial answer');
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="proof-edit"]')
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="proof-edit-root"]',
      )?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="proof-regenerate"]',
      )?.disabled,
    ).toBe(true);
    finishQueued = true;
    await act(async () => {
      streamController?.enqueue(
        new TextEncoder().encode(snapshotSse('completed', 'Terminal answer.')),
      );
    });
    await act(async () => runtimeSettled);
    expect(container.textContent).toContain('Terminal answer.');
    expect(
      container.querySelector('[data-testid="runtime-is-running"]')
        ?.textContent,
    ).toBe('false');
    expect(container.querySelector('button')?.disabled).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="proof-edit"]')
        ?.disabled,
    ).toBe(false);
    expect(bodyCancelled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.stubGlobal('fetch', originalFetch);
  }
  expect(bodyCancelled).toBe(true);
  expect(requestSignal?.aborted).toBe(false);
});

it('sends through the external runtime, streams chunks, then replaces its overlay with the canonical server tree', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  let serverTree: ChatTree = {
    id: chatId,
    title: 'Runtime proof',
    messages: [],
    viewedLeafId: null,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
  let sendPrompt: (() => Promise<void>) | undefined;
  const frames = [
    { version: 1, type: 'start', runId, messageId: assistantId },
    { version: 1, type: 'text-start', runId, id: 'attempt-1-text' },
    {
      version: 1,
      type: 'text-delta',
      runId,
      id: 'attempt-1-text',
      delta: 'Scripted external answer',
    },
    { version: 1, type: 'text-end', runId, id: 'attempt-1-text' },
    { version: 1, type: 'status', runId, status: 'completed' },
    { version: 1, type: 'finish', runId },
  ];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/messages') && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as {
        userMessageId: string;
        parentMessageId: string | null;
        text: string;
        effort: 'high' | 'max';
      };
      serverTree = {
        ...serverTree,
        messages: [
          {
            id: request.userMessageId,
            role: 'user',
            parentId: request.parentMessageId,
            text: request.text,
            effort: request.effort,
            createdAt: '2026-11-11T00:00:00.000Z',
          },
          {
            id: assistantId,
            role: 'assistant',
            parentId: request.userMessageId,
            runId,
            text: 'Scripted external answer',
            status: 'completed',
            reasoningSummary: null,
            reasoningDurationMs: null,
            feedback: null,
            createdAt: '2026-11-11T00:00:01.000Z',
          },
        ],
        viewedLeafId: assistantId,
        updatedAt: '2026-11-11T00:00:01.000Z',
      };
      return Response.json(
        {
          chatId,
          userMessageId: request.userMessageId,
          assistantMessageId: assistantId,
          runId,
        },
        { status: 201 },
      );
    }
    if (path.endsWith('/events'))
      return new Response(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        },
      );
    return Response.json(serverTree);
  });
  vi.stubGlobal('fetch', fetch);
  function ComposerProbe() {
    const aui = useAui();
    const composer = aui.thread.composer();
    sendPrompt = async () => {
      composer.setText('external store prompt');
      await composer.send();
    };
    return null;
  }
  const initialTree: ChatTree = { ...serverTree };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ChatRuntime
        actorScope="tenant-1:user-1"
        chatId={chatId}
        tree={initialTree}
      >
        <ComposerProbe />
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages>
            {() => <ProofMessage />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>
      </ChatRuntime>,
    ),
  );
  await act(async () => {
    await sendPrompt!();
  });

  expect(
    fetch.mock.calls.some(([input]) => String(input).endsWith('/events')),
  ).toBe(true);
  expect(container.textContent).toContain('Scripted external answer');
  const mutationCall = fetch.mock.calls.find(
    ([input, init]) =>
      String(input).endsWith('/messages') && init?.method === 'POST',
  );
  const mutation = JSON.parse(String(mutationCall?.[1]?.body)) as Record<
    string,
    unknown
  >;
  expect(mutation).toMatchObject({
    parentMessageId: null,
    text: 'external store prompt',
  });
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('keeps server-created regenerate siblings in the public runtime repository without reloading', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const firstAssistantId = '33333333-3333-4333-8333-333333333333';
  const siblingAssistantId = '55555555-5555-4555-8555-555555555555';
  const firstRunId = '44444444-4444-4444-8444-444444444444';
  const secondRunId = '66666666-6666-4666-8666-666666666666';
  const initialTree: ChatTree = {
    id: chatId,
    title: 'Runtime proof',
    messages: [],
    viewedLeafId: null,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
  let serverTree: ChatTree = initialTree;
  const messagesByRun = new Map<
    string,
    { userMessageId: string; assistantMessageId: string; text: string }
  >();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/messages') && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as {
        userMessageId: string;
        parentMessageId: string | null;
        text: string;
      };
      expect(request).toMatchObject({
        parentMessageId: null,
        text: 'Question',
      });
      serverTree = {
        ...serverTree,
        messages: [
          {
            id: request.userMessageId,
            role: 'user',
            parentId: null,
            text: request.text,
            effort: 'high',
            createdAt: '2026-11-11T00:00:00.000Z',
          },
          {
            id: firstAssistantId,
            role: 'assistant',
            parentId: request.userMessageId,
            runId: firstRunId,
            text: 'First answer',
            status: 'completed',
            reasoningSummary: null,
            reasoningDurationMs: null,
            feedback: null,
            createdAt: '2026-11-11T00:00:01.000Z',
          },
        ],
        viewedLeafId: firstAssistantId,
        updatedAt: '2026-11-11T00:00:01.000Z',
      };
      messagesByRun.set(firstRunId, {
        userMessageId: request.userMessageId,
        assistantMessageId: firstAssistantId,
        text: 'First answer',
      });
      return Response.json(
        {
          chatId,
          userMessageId: request.userMessageId,
          assistantMessageId: firstAssistantId,
          runId: firstRunId,
        },
        { status: 201 },
      );
    }
    if (
      path.endsWith(`/messages/${firstAssistantId}/regenerate`) &&
      init?.method === 'POST'
    ) {
      serverTree = {
        ...serverTree,
        messages: [
          ...serverTree.messages,
          {
            id: siblingAssistantId,
            role: 'assistant',
            parentId: userIdFromTree(serverTree),
            runId: secondRunId,
            text: 'Second answer',
            status: 'completed',
            reasoningSummary: null,
            reasoningDurationMs: null,
            feedback: null,
            createdAt: '2026-11-11T00:00:02.000Z',
          },
        ],
        viewedLeafId: siblingAssistantId,
        updatedAt: '2026-11-11T00:00:02.000Z',
      };
      const parentId = userIdFromTree(serverTree);
      messagesByRun.set(secondRunId, {
        userMessageId: parentId,
        assistantMessageId: siblingAssistantId,
        text: 'Second answer',
      });
      return Response.json(
        {
          chatId,
          userMessageId: parentId,
          assistantMessageId: siblingAssistantId,
          runId: secondRunId,
        },
        { status: 201 },
      );
    }
    if (path.endsWith('/events')) {
      const runId = path.includes(secondRunId) ? secondRunId : firstRunId;
      const current = messagesByRun.get(runId)!;
      const frames = [
        {
          version: 1,
          type: 'start',
          runId,
          messageId: current.assistantMessageId,
        },
        { version: 1, type: 'text-start', runId, id: `attempt-${runId}` },
        {
          version: 1,
          type: 'text-delta',
          runId,
          id: `attempt-${runId}`,
          delta: current.text,
        },
        { version: 1, type: 'text-end', runId, id: `attempt-${runId}` },
        { version: 1, type: 'status', runId, status: 'completed' },
        { version: 1, type: 'finish', runId },
      ];
      return new Response(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        },
      );
    }
    if (path.endsWith('/viewed-leaf') && init?.method === 'PUT')
      return new Response(null, { status: 204 });
    return Response.json(serverTree);
  });
  vi.stubGlobal('fetch', fetch);
  let sendPrompt: (() => Promise<void>) | undefined;
  let reloadAssistant: (() => Promise<void>) | undefined;
  let exportMessages: (() => string[]) | undefined;
  function RuntimeProbe() {
    const aui = useAui();
    const composer = aui.thread.composer();
    sendPrompt = async () => {
      composer.setText('Question');
      await composer.send();
    };
    reloadAssistant = async () => {
      await aui.thread.message({ id: firstAssistantId }).reload();
    };
    exportMessages = () =>
      aui.thread.export().messages.map(({ message }) => message.id);
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ChatRuntime
        actorScope="tenant-1:user-1"
        chatId={chatId}
        tree={initialTree}
      >
        <RuntimeProbe />
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages>
            {() => <ProofMessage />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>
      </ChatRuntime>,
    ),
  );

  await act(async () => {
    await sendPrompt!();
  });
  expect(container.textContent).toContain('First answer');
  await act(async () => {
    await reloadAssistant!();
  });

  expect(
    fetch.mock.calls.some(([input]) =>
      String(input).endsWith(`/messages/${firstAssistantId}/regenerate`),
    ),
  ).toBe(true);
  const createdUserId = serverTree.messages.find(
    (message) => message.role === 'user',
  )?.id;
  expect(createdUserId).toBeTruthy();
  expect(exportMessages!().sort()).toEqual(
    [createdUserId, firstAssistantId, siblingAssistantId].sort(),
  );
  expect(container.textContent).toContain('Second answer');
  const previousBranchButton = container.querySelector<HTMLButtonElement>(
    '[aria-label="Previous answer"]',
  );
  expect(previousBranchButton).not.toBeNull();
  expect(container.querySelector('[aria-label="Next answer"]')).not.toBeNull();
  expect(previousBranchButton?.parentElement?.textContent).toBe(
    'Previous2Next',
  );
  await act(async () => previousBranchButton?.click());
  expect(container.textContent).toContain('First answer');
  expect(
    fetch.mock.calls.some(
      ([input, init]) =>
        String(input).endsWith('/viewed-leaf') && init?.method === 'PUT',
    ),
  ).toBe(true);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function userIdFromTree(tree: ChatTree): string {
  const user = tree.messages.find((message) => message.role === 'user');
  if (!user) throw new Error('Server user message is missing');
  return user.id;
}

it('resumes a nonterminal snapshot prefix with suffix text and measured reasoning in the external runtime', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const attemptId = '55555555-5555-4555-8555-555555555555';
  const frames = [
    { type: 'snapshot-reset', version: 1, reason: 'cursor-gap' },
    {
      type: 'snapshot-start',
      version: 1,
      reset: true,
      snapshot: {
        runId,
        messageId: assistantId,
        attemptId,
        generation: 1,
        revision: 3,
        eventId: '1:1783814400000-0',
        status: 'running',
        errorCode: null,
        reasoningDurationMs: 17,
      },
      partCount: 2,
      operationCount: 0,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 0,
      chunkIndex: 0,
      partType: 'reasoning',
      id: 'attempt-2-reasoning',
      text: 'Measured reasoning summary',
      final: true,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 1,
      chunkIndex: 0,
      partType: 'text',
      id: 'attempt-2-text',
      text: 'Recovered prefix',
      final: true,
    },
    { type: 'snapshot-end', version: 1, partCount: 2, operationCount: 0 },
    {
      version: 1,
      type: 'text-delta',
      runId,
      id: 'attempt-2-text',
      delta: ' with suffix',
    },
    { version: 1, type: 'text-end', runId, id: 'attempt-2-text' },
    { version: 1, type: 'status', runId, status: 'completed' },
    { version: 1, type: 'finish', runId },
  ];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    if (String(input).endsWith('/events'))
      return new Response(
        frames
          .map(
            (frame) =>
              `id: 1:1783814400000-0\ndata: ${JSON.stringify(frame)}\n\n`,
          )
          .join(''),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        },
      );
    return Response.json({
      ...tree,
      messages: tree.messages.map((message) =>
        message.role === 'assistant'
          ? {
              ...message,
              text: 'Recovered prefix with suffix',
              status: 'completed',
              reasoningSummary: 'Measured reasoning summary',
              reasoningDurationMs: 17,
            }
          : message,
      ),
    });
  });
  vi.stubGlobal('fetch', fetch);
  const tree: ChatTree = {
    id: chatId,
    title: 'Runtime proof',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'baseline runtime proof prompt',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: assistantId,
        role: 'assistant',
        parentId: userId,
        runId,
        text: '',
        status: 'running',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: assistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:01.000Z',
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  function FixtureRoute() {
    const [loadedTree, setLoadedTree] = useState<ChatTree>();
    const [, setRunId] = useState<string>();
    const [, setStop] = useState<(() => Promise<void>) | undefined>();
    useEffect(() => {
      void Promise.resolve().then(() => setLoadedTree(tree));
    }, []);
    if (!loadedTree) return <main role="status">Loading chat</main>;
    return (
      <main>
        <ChatRuntime
          actorScope="tenant-1:user-1"
          chatId={chatId}
          tree={loadedTree}
          onRunId={(value) => setRunId(value)}
          onStopReady={(stop) => setStop(() => stop)}
        >
          <ThreadPrimitive.Root>
            <ThreadPrimitive.Messages>
              {() => <ProofMessage />}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Root>
        </ChatRuntime>
      </main>
    );
  }
  await act(async () => {
    root.render(<FixtureRoute />);
    await Promise.resolve();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  expect(fetch).toHaveBeenCalled();
  const request = fetch.mock.calls.find(([input]) =>
    String(input).endsWith('/events'),
  );
  expect(
    fetch.mock.calls.filter(([input]) => String(input).endsWith('/events')),
  ).toHaveLength(1);
  expect(
    new Headers(request?.[1]?.headers).get('x-lexon-stream-recovery'),
  ).toBe('snapshot');
  const answer = container.querySelector(`[data-message-id="${assistantId}"]`);
  expect(answer?.getAttribute('data-text-content')).toBe(
    'Recovered prefix with suffix',
  );
  expect(answer?.getAttribute('data-reasoning-content')).toBe(
    'Measured reasoning summary',
  );
  expect(answer?.getAttribute('data-reasoning-duration-ms')).toBe('17');
  expect(
    answer?.querySelector('[data-testid="reasoning-duration-label"]')
      ?.textContent,
  ).toBe('17 ms');

  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('keeps a live ChatRuntime when its parent recreates callback props', async () => {
  const tree: ChatTree = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Runtime proof',
    messages: [],
    viewedLeafId: null,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
  let renders = 0;
  function Parent() {
    renders += 1;
    const [, setStop] = useState<(() => Promise<void>) | undefined>();
    return (
      <ChatRuntime
        actorScope="tenant-1:user-1"
        chatId={tree.id}
        tree={tree}
        onRunId={(runId) => {
          void runId;
        }}
        onStopReady={(stop) => setStop(() => stop)}
      >
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages>
            {() => <ProofMessage />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>
      </ChatRuntime>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => root.render(<Parent />));

  expect(renders).toBeLessThan(4);
  await act(async () => root.unmount());
});

it('shows a safe alert when persisting a public branch selection fails', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const rootUserId = '22222222-2222-4222-8222-222222222222';
  const firstAssistantId = '33333333-3333-4333-8333-333333333333';
  const selectedAssistantId = '44444444-4444-4444-8444-444444444444';
  let rejectBranchWrite: ((response: Response) => void) | undefined;
  let resolveBranchWriteStarted: (() => void) | undefined;
  const branchWriteStarted = new Promise<void>((resolve) => {
    resolveBranchWriteStarted = resolve;
  });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/viewed-leaf')) {
      resolveBranchWriteStarted?.();
      return new Promise<Response>((resolve) => {
        rejectBranchWrite = resolve;
      });
    }
    throw new Error('Unexpected request during branch selection proof');
  });
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', fetch);
  const tree: ChatTree = {
    id: chatId,
    title: 'Branch persistence proof',
    messages: [
      {
        id: rootUserId,
        role: 'user',
        parentId: null,
        text: 'Question',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      ...[
        [firstAssistantId, 'First answer'],
        [selectedAssistantId, 'Selected answer'],
      ].map(([id, text], index) => ({
        id: id!,
        role: 'assistant' as const,
        parentId: rootUserId,
        runId: `55555555-5555-4555-8555-55555555555${index}`,
        text: text!,
        status: 'completed' as const,
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: `2026-11-11T00:00:0${index + 1}.000Z`,
      })),
    ],
    viewedLeafId: selectedAssistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:01.000Z',
  };
  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={chatId} tree={tree}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages>
            {() => <ProofMessage />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>
      </ChatRuntime>,
    );
  });
  const previous = container.querySelector<HTMLButtonElement>(
    '[aria-label="Previous answer"]',
  );
  if (!previous) throw new Error('The previous branch control is missing.');
  await act(async () => previous.click());
  await branchWriteStarted;
  await act(async () => {
    rejectBranchWrite?.(
      Response.json(
        { error: { code: 'AI_PROVIDER_UNAVAILABLE', message: 'Safe error' } },
        { status: 503 },
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Could not save this branch selection',
  );
  expect(container.textContent).not.toContain('Safe error');
  await act(async () => root.unmount());
  vi.stubGlobal('fetch', originalFetch);
});

it('keeps the public runtime on the canonical selected path after nonroot edit, root edit, and send', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const rootUserId = '22222222-2222-4222-8222-222222222222';
  const rootAssistantId = '33333333-3333-4333-8333-333333333333';
  let branchUserId: string | undefined;
  let branchAssistantId: string | undefined;
  let branchSiblingId: string | undefined;
  const initialTree: ChatTree = {
    id: chatId,
    title: 'Runtime proof',
    messages: [
      {
        id: rootUserId,
        role: 'user',
        parentId: null,
        text: 'Root question',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: rootAssistantId,
        role: 'assistant',
        parentId: rootUserId,
        runId: '77777777-7777-4777-8777-777777777777',
        text: 'Root answer',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: rootAssistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:01.000Z',
  };
  let serverTree = initialTree;
  let mutationNumber = 0;
  const pendingRuns = new Map<string, { assistantId: string; text: string }>();
  const addAssistant = (userId: string, text: string) => {
    mutationNumber += 1;
    const suffix = String(mutationNumber).padStart(12, '0');
    const assistantId = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
    const runId = `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`;
    const timestamp = `2026-11-11T00:00:0${mutationNumber + 4}.000Z`;
    serverTree = {
      ...serverTree,
      messages: [
        ...serverTree.messages,
        {
          id: assistantId,
          role: 'assistant',
          parentId: userId,
          runId,
          text,
          status: 'completed',
          reasoningSummary: null,
          reasoningDurationMs: null,
          feedback: null,
          createdAt: timestamp,
        },
      ],
      viewedLeafId: assistantId,
      updatedAt: timestamp,
    };
    pendingRuns.set(runId, { assistantId, text });
    return { assistantId, runId };
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/viewed-leaf') && init?.method === 'PUT') {
      const { leafId } = JSON.parse(String(init.body)) as { leafId: string };
      serverTree = { ...serverTree, viewedLeafId: leafId };
      return new Response(null, { status: 204 });
    }
    if (path.endsWith('/regenerate') && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as { messageId: string };
      const source = serverTree.messages.find(
        (message) => message.id === request.messageId,
      );
      if (!source || source.role !== 'assistant' || !source.parentId)
        throw new Error('Regeneration source is missing');
      const result = addAssistant(source.parentId, 'Sibling answer');
      branchSiblingId = result.assistantId;
      return Response.json(
        {
          chatId,
          userMessageId: source.parentId,
          assistantMessageId: result.assistantId,
          runId: result.runId,
        },
        { status: 201 },
      );
    }
    if (path.endsWith('/edit') && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as {
        messageId: string;
        newMessageId: string;
        text: string;
      };
      const source = serverTree.messages.find(
        (message) => message.id === request.messageId,
      );
      if (!source || source.role !== 'user')
        throw new Error('Edit source is missing');
      serverTree = {
        ...serverTree,
        messages: [
          ...serverTree.messages,
          {
            id: request.newMessageId,
            role: 'user',
            parentId: source.parentId,
            text: request.text,
            effort: 'high',
            createdAt: '2026-11-11T00:00:10.000Z',
          },
        ],
      };
      const result = addAssistant(
        request.newMessageId,
        request.messageId === rootUserId
          ? 'Edited root answer'
          : 'Edited branch answer',
      );
      return Response.json(
        {
          chatId,
          userMessageId: request.newMessageId,
          assistantMessageId: result.assistantId,
          runId: result.runId,
        },
        { status: 201 },
      );
    }
    if (path.endsWith('/messages') && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as {
        userMessageId: string;
        parentMessageId: string | null;
        text: string;
      };
      serverTree = {
        ...serverTree,
        messages: [
          ...serverTree.messages,
          {
            id: request.userMessageId,
            role: 'user',
            parentId: request.parentMessageId,
            text: request.text,
            effort: 'high',
            createdAt: '2026-11-11T00:00:20.000Z',
          },
        ],
      };
      if (request.text === 'Branch question')
        branchUserId = request.userMessageId;
      const result = addAssistant(
        request.userMessageId,
        request.text === 'Branch question' ? 'Branch answer' : 'Final answer',
      );
      if (request.text === 'Branch question')
        branchAssistantId = result.assistantId;
      return Response.json(
        {
          chatId,
          userMessageId: request.userMessageId,
          assistantMessageId: result.assistantId,
          runId: result.runId,
        },
        { status: 201 },
      );
    }
    if (path.endsWith('/events')) {
      const runId = path.split('/').at(-2)!;
      const current = pendingRuns.get(runId);
      if (!current) throw new Error('Run fixture is missing');
      const frames = [
        { version: 1, type: 'start', runId, messageId: current.assistantId },
        { version: 1, type: 'text-start', runId, id: `text-${runId}` },
        {
          version: 1,
          type: 'text-delta',
          runId,
          id: `text-${runId}`,
          delta: current.text,
        },
        { version: 1, type: 'text-end', runId, id: `text-${runId}` },
        { version: 1, type: 'status', runId, status: 'completed' },
        { version: 1, type: 'finish', runId },
      ];
      return new Response(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        },
      );
    }
    return Response.json(serverTree);
  });
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', fetch);
  const controls: {
    sendBranch?: () => Promise<void>;
    regenerate?: () => Promise<void>;
    editBranch?: () => Promise<void>;
    editRoot?: () => Promise<void>;
    send?: () => Promise<void>;
  } = {};
  function RuntimeControls() {
    const aui = useAui();
    const messages = useAuiState((state) => state.thread.messages);
    controls.sendBranch = async () => {
      const composer = aui.thread.composer();
      composer.setText('Branch question');
      await composer.send();
    };
    controls.regenerate = async () => {
      const lastAssistant = [...messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      if (!lastAssistant) throw new Error('A branch answer is required');
      await aui.thread.message({ id: lastAssistant.id }).reload();
    };
    controls.editBranch = async () => {
      if (!branchUserId) throw new Error('A branch user message is required');
      const composer = aui.thread.message({ id: branchUserId }).composer();
      composer.beginEdit();
      composer.setText('Edited branch prompt');
      await composer.send();
    };
    controls.editRoot = async () => {
      const composer = aui.thread.message({ id: rootUserId }).composer();
      composer.beginEdit();
      composer.setText('Edited root prompt');
      await composer.send();
    };
    controls.send = async () => {
      const composer = aui.thread.composer();
      composer.setText('Final question');
      await composer.send();
    };
    return <output>{messages.length}</output>;
  }
  const container = document.createElement('div');
  let root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <ChatRuntime
          actorScope="tenant-1:user-1"
          chatId={chatId}
          tree={initialTree}
        >
          <RuntimeControls />
          <ThreadPrimitive.Root>
            <ThreadPrimitive.Messages>
              {() => <ProofMessage />}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Root>
        </ChatRuntime>,
      );
    });
    await act(async () => controls.sendBranch?.());
    await act(async () => controls.regenerate?.());
    const previousBranch = container.querySelector<HTMLButtonElement>(
      '[aria-label="Previous answer"]',
    );
    expect(previousBranch?.disabled).toBe(false);
    await act(async () => previousBranch?.click());
    expect(serverTree.viewedLeafId).toBe(branchAssistantId);
    expect(
      serverTree.messages.some((message) => message.id === branchSiblingId),
    ).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ChatRuntime
          actorScope="tenant-1:user-1"
          chatId={chatId}
          tree={serverTree}
        >
          <RuntimeControls />
          <ThreadPrimitive.Root>
            <ThreadPrimitive.Messages>
              {() => <ProofMessage />}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Root>
        </ChatRuntime>,
      );
    });
    await act(async () => controls.editBranch?.());
    await act(async () => controls.editRoot?.());
    await act(async () => controls.send?.());

    const byId = new Map(
      serverTree.messages.map((message) => [message.id, message]),
    );
    const path = [];
    let current = byId.get(serverTree.viewedLeafId!);
    while (current) {
      path.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const expected = path.map(({ id, role, parentId }) => ({
      id,
      role,
      parentId,
    }));
    const visible = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id][data-role]'),
      (article) => ({
        id: article.dataset.messageId,
        role: article.dataset.role,
      }),
    );
    expect(visible).toEqual(expected.map(({ id, role }) => ({ id, role })));
  } finally {
    await act(async () => root.unmount());
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('shows the empty placeholder in both public runtime and SDK state before direct resume', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const response = new Response('', {
    headers: { 'x-lexon-stream-recovery-result': 'snapshot' },
  });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return response.clone();
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    selectedLeafId: assistantId,
    initialRunId: runId,
    fetch,
  });
  const userMessage: ChatUIMessage = {
    id: userId,
    role: 'user',
    parts: [{ type: 'text', text: 'Question' }],
  };
  const assistantMessage: ChatUIMessage = {
    id: assistantId,
    role: 'assistant',
    parts: [],
    metadata: { status: 'running', errorCode: null, reasoningDurationMs: null },
  };
  const repository = {
    headId: assistantId,
    messages: [
      { parentId: null, message: userMessage },
      { parentId: userId, message: assistantMessage },
    ],
  };
  let sdkMessageIds: string[] = [];
  let publicThreadMessageIds: string[] = [];
  let resume: (() => Promise<void>) | undefined;

  function Probe() {
    const chat = useChat<ChatUIMessage>({
      id: chatId,
      resume: false,
      transport,
    });
    const runtime = useAISDKRuntime<ChatUIMessage>(chat, {
      messageRepository: repository,
    });
    sdkMessageIds = chat.messages.map((message) => message.id);
    publicThreadMessageIds = runtime.thread
      .getState()
      .messages.map((message) => message.id);
    resume = chat.resumeStream;
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages>
            {() => <ProofMessage />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));

  expect(publicThreadMessageIds).toContain(assistantId);
  expect(sdkMessageIds).toContain(assistantId);
  expect(
    container
      .querySelector(`[data-message-id="${assistantId}"]`)
      ?.getAttribute('data-part-state'),
  ).toBe('[]');
  await act(async () => resume?.());
  expect(fetch).toHaveBeenCalledTimes(1);
  const options = fetch.mock.calls[0]?.[1];
  expect(new Headers(options?.headers).get('x-lexon-stream-recovery')).toBe(
    'snapshot',
  );

  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('replaces a partial answer when replay starts with the same message ID', async () => {
  let chatMessages: readonly UIMessage[] = [];
  let runtime: ReturnType<typeof useAISDKRuntime> | undefined;
  const transport: ChatTransport<UIMessage> = {
    resumeStreamIsReplay: true,
    sendMessages: async () => new ReadableStream<UIMessageChunk>(),
    reconnectToStream: async () =>
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: 'start', messageId: 'answer-a' });
          controller.enqueue({ type: 'text-start', id: 'attempt-2' });
          controller.enqueue({
            type: 'text-delta',
            id: 'attempt-2',
            delta: 'Complete answer',
          });
          controller.enqueue({ type: 'text-end', id: 'attempt-2' });
          controller.enqueue({ type: 'reasoning-start', id: 'reasoning-2' });
          controller.enqueue({
            type: 'reasoning-delta',
            id: 'reasoning-2',
            delta: 'New reasoning',
          });
          controller.enqueue({ type: 'reasoning-end', id: 'reasoning-2' });
          controller.enqueue({
            type: 'message-metadata',
            messageMetadata: { reasoningDurationMs: 31 },
          });
          controller.enqueue({ type: 'finish', finishReason: 'stop' });
          controller.close();
        },
      }),
  };
  let resume: (() => Promise<void>) | undefined;

  function Probe() {
    const chat = useChat({
      id: 'chat-replay',
      resume: false,
      transport,
      messages: [
        {
          id: 'answer-a',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Stale partial answer' }],
          metadata: { reasoningDurationMs: null },
        },
      ],
    });
    chatMessages = chat.messages;
    resume = chat.resumeStream;
    runtime = useAISDKRuntime(chat);
    return <AssistantRuntimeProvider runtime={runtime} />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await act(async () => resume!());

  expect(chatMessages).toHaveLength(1);
  expect(chatMessages[0]?.id).toBe('answer-a');
  expect(
    chatMessages[0]?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  ).toBe('Complete answer');
  expect(
    chatMessages[0]?.parts
      .filter((part) => part.type === 'reasoning')
      .map((part) => part.text)
      .join(''),
  ).toBe('New reasoning');
  expect(chatMessages[0]?.metadata).toMatchObject({ reasoningDurationMs: 31 });
  expect(runtime!.thread.getState().messages).toHaveLength(1);
  expect(
    runtime!.thread
      .getState()
      .messages[0]?.content.filter(
        (part) => part.type === 'text' || part.type === 'reasoning',
      )
      .map((part) => part.text)
      .join(''),
  ).toBe('Complete answerNew reasoning');

  await act(async () => root.unmount());
});

it('continues a nonterminal snapshot text part with later deltas from the same attempt', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const attemptId = '55555555-5555-4555-8555-555555555555';
  const partId = 'attempt-1-text-1';
  const frames = [
    {
      type: 'snapshot-start',
      version: 1,
      reset: true,
      snapshot: {
        runId,
        messageId: assistantId,
        attemptId,
        generation: 1,
        revision: 3,
        eventId: '1:1783814400000-0',
        status: 'running',
        errorCode: null,
        reasoningDurationMs: 23,
      },
      partCount: 2,
      operationCount: 0,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 0,
      chunkIndex: 0,
      partType: 'reasoning',
      id: 'attempt-1-reasoning',
      text: 'Measured reasoning',
      final: true,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 1,
      chunkIndex: 0,
      partType: 'text',
      id: partId,
      text: 'Partial answer',
      final: true,
    },
    { type: 'snapshot-end', version: 1, partCount: 2, operationCount: 0 },
    {
      version: 1,
      type: 'text-delta',
      runId,
      id: partId,
      delta: ' and continuation',
    },
    { version: 1, type: 'text-end', runId, id: partId },
    { version: 1, type: 'status', runId, status: 'completed' },
    { version: 1, type: 'finish', runId },
  ];
  const fetch = vi.fn(
    async () =>
      new Response(
        frames
          .map(
            (frame, index) =>
              `id: 1:1783814400000-${index}\ndata: ${JSON.stringify(frame)}\n\n`,
          )
          .join(''),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        },
      ),
  );
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    selectedLeafId: assistantId,
    fetch,
  });
  let chatMessages: readonly UIMessage[] = [];
  let runtime: ReturnType<typeof useAISDKRuntime> | undefined;
  let resume: (() => Promise<void>) | undefined;
  let sdkError: Error | undefined;

  function Probe() {
    const chat = useChat<ChatUIMessage>({
      id: chatId,
      resume: false,
      transport,
      messages: [{ id: assistantId, role: 'assistant', parts: [] }],
      onError: (error) => {
        sdkError = error;
      },
    });
    chatMessages = chat.messages;
    resume = chat.resumeStream;
    runtime = useAISDKRuntime(chat);
    return <AssistantRuntimeProvider runtime={runtime} />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await act(async () => resume?.());

  expect(sdkError).toBeUndefined();
  const parts = chatMessages.find(
    (message) => message.id === assistantId,
  )?.parts;
  expect(parts).toContainEqual(
    expect.objectContaining({
      type: 'text',
      text: 'Partial answer and continuation',
      state: 'done',
    }),
  );
  expect(parts).toContainEqual(
    expect.objectContaining({
      type: 'reasoning',
      text: 'Measured reasoning',
      state: 'done',
    }),
  );
  expect(
    chatMessages.find((message) => message.id === assistantId)?.metadata,
  ).toMatchObject({ reasoningDurationMs: 23 });
  await act(async () => root.unmount());
});

it('clears failed attempt text and measured reasoning when a real reset-step starts replacement output', async () => {
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const frames = [
    { version: 1, type: 'start', runId, messageId: assistantId },
    { version: 2, type: 'reasoning-start', runId, id: 'attempt-1-reasoning' },
    {
      version: 2,
      type: 'reasoning-delta',
      runId,
      id: 'attempt-1-reasoning',
      delta: 'Old reasoning',
    },
    {
      version: 2,
      type: 'reasoning-end',
      runId,
      id: 'attempt-1-reasoning',
      durationMs: 41,
    },
    { version: 1, type: 'text-start', runId, id: 'attempt-1-text' },
    {
      version: 1,
      type: 'text-delta',
      runId,
      id: 'attempt-1-text',
      delta: 'Old answer',
    },
    { version: 1, type: 'reset-step', runId },
    { version: 1, type: 'start-step', runId },
    { version: 2, type: 'reasoning-start', runId, id: 'attempt-2-reasoning' },
    {
      version: 2,
      type: 'reasoning-delta',
      runId,
      id: 'attempt-2-reasoning',
      delta: 'New reasoning',
    },
    {
      version: 2,
      type: 'reasoning-end',
      runId,
      id: 'attempt-2-reasoning',
      durationMs: 17,
    },
    { version: 1, type: 'text-start', runId, id: 'attempt-2-text' },
    {
      version: 1,
      type: 'text-delta',
      runId,
      id: 'attempt-2-text',
      delta: 'New answer',
    },
    { version: 1, type: 'text-end', runId, id: 'attempt-2-text' },
    { version: 1, type: 'status', runId, status: 'completed' },
    { version: 1, type: 'finish', runId },
  ];
  let responseController:
    ReadableStreamDefaultController<Uint8Array> | undefined;
  const responseBody = new ReadableStream<Uint8Array>({
    start(controller) {
      responseController = controller;
    },
  });
  const fetch = vi.fn(
    async () =>
      new Response(responseBody, {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'incremental',
        },
      }),
  );
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId: '11111111-1111-4111-8111-111111111111',
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    selectedLeafId: assistantId,
    fetch,
  });
  let chatMessages: readonly UIMessage[] = [];
  let resume: (() => Promise<void>) | undefined;
  let sdkError: Error | undefined;

  function Probe() {
    const chat = useChat<ChatUIMessage>({
      id: 'chat-reset-step',
      resume: false,
      transport,
      messages: [
        {
          id: assistantId,
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Old answer' },
            { type: 'reasoning', text: 'Old reasoning' },
          ],
          metadata: { reasoningDurationMs: 41 },
        },
      ],
      onError: (error) => {
        sdkError = error;
      },
    });
    chatMessages = chat.messages;
    resume = chat.resumeStream;
    return <AssistantRuntimeProvider runtime={useAISDKRuntime(chat)} />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  const sendFrames = (selected: typeof frames) => {
    for (const frame of selected)
      responseController!.enqueue(
        new TextEncoder().encode(
          `id: 1:1783814400000-${frames.indexOf(frame)}\ndata: ${JSON.stringify(frame)}\n\n`,
        ),
      );
  };
  let resumePromise: Promise<void> | undefined;
  await act(async () => {
    resumePromise = resume?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sendFrames(frames.slice(0, 7));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const resetState = chatMessages.find(
    (candidate) => candidate.id === assistantId,
  );
  expect(resetState?.parts.filter((part) => part.type === 'text')).toEqual([]);
  expect(resetState?.parts.filter((part) => part.type === 'reasoning')).toEqual(
    [],
  );
  expect(resetState?.metadata).toMatchObject({ reasoningDurationMs: null });

  await act(async () => {
    sendFrames(frames.slice(7));
    responseController!.close();
    await resumePromise;
  });

  expect(sdkError).toBeUndefined();
  const message = chatMessages.find(
    (candidate) => candidate.id === assistantId,
  );
  expect(
    message?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  ).toBe('New answer');
  expect(
    message?.parts
      .filter((part) => part.type === 'reasoning')
      .map((part) => part.text)
      .join(''),
  ).toBe('New reasoning');
  expect(message?.metadata).toMatchObject({ reasoningDurationMs: 17 });
  await act(async () => root.unmount());
});

it('replaces an earlier PostgreSQL snapshot when a newer snapshot arrives on the same run', async () => {
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const snapshot = (
    attemptId: string,
    revision: number,
    eventId: string,
    status: string,
    duration: number,
    text: string,
    reasoning: string,
  ) => [
    {
      type: 'snapshot-start',
      version: 1,
      reset: true,
      snapshot: {
        runId,
        messageId: assistantId,
        attemptId,
        generation: 1,
        revision,
        eventId,
        status,
        errorCode: null,
        reasoningDurationMs: duration,
      },
      partCount: 2,
      operationCount: 0,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 0,
      chunkIndex: 0,
      partType: 'reasoning',
      id: `${attemptId}-reasoning`,
      text: reasoning,
      final: true,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 1,
      chunkIndex: 0,
      partType: 'text',
      id: `${attemptId}-text`,
      text,
      final: true,
    },
    { type: 'snapshot-end', version: 1, partCount: 2, operationCount: 0 },
  ];
  const frames = [
    ...snapshot(
      '55555555-5555-4555-8555-555555555555',
      3,
      '1783814400000-2',
      'running',
      41,
      'Stale prefix',
      'Old reasoning',
    ),
    ...snapshot(
      '66666666-6666-4666-8666-666666666666',
      4,
      '1783814400000-5',
      'completed',
      17,
      'Current answer',
      'Current reasoning',
    ),
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
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId: '11111111-1111-4111-8111-111111111111',
    actorScope: 'tenant-1:user-1',
    initialRunId: runId,
    selectedLeafId: assistantId,
    fetch,
  });
  let chatMessages: readonly UIMessage[] = [];
  let resume: (() => Promise<void>) | undefined;
  let sdkError: Error | undefined;
  function Probe() {
    const chat = useChat<ChatUIMessage>({
      id: 'chat-two-snapshots',
      resume: false,
      transport,
      messages: [{ id: assistantId, role: 'assistant', parts: [] }],
      onError: (error) => {
        sdkError = error;
      },
    });
    chatMessages = chat.messages;
    resume = chat.resumeStream;
    return <AssistantRuntimeProvider runtime={useAISDKRuntime(chat)} />;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  await act(async () => resume?.());

  expect(sdkError).toBeUndefined();
  const message = chatMessages.find(
    (candidate) => candidate.id === assistantId,
  );
  expect(
    message?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  ).toBe('Current answer');
  expect(
    message?.parts
      .filter((part) => part.type === 'reasoning')
      .map((part) => part.text)
      .join(''),
  ).toBe('Current reasoning');
  expect(message?.metadata).toMatchObject({ reasoningDurationMs: 17 });
  await act(async () => root.unmount());
});
