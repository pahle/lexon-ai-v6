import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuiState } from '@assistant-ui/react';
import type {
  ChatMutationResult,
  ChatTree,
  CreateChatInput,
} from '@lexon/contracts';
import { ChatView } from '../src/components/chat/chat-view.js';
import {
  ChatRuntimeProvider,
  inertChatModelAdapter,
} from '../src/components/shell/chat-runtime-provider';
import { Workspace } from '../src/components/organizations/workspace';
import { ThreadList } from '../src/components/assistant-ui/elements/thread-list.aui';
import { render, settle } from './render.js';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: () => () => undefined,
}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    setChatTitle: workspaceState.setChatTitle,
    chatTitleRefreshVersion: 0,
    identity: {
      user: { id: 'user-1', name: 'Ada Lovelace', onboardingCompleted: true },
      organization: { id: 'tenant-1' },
    },
  }),
}));

const workspaceState = vi.hoisted(() => ({ setChatTitle: vi.fn() }));

const queryClient = new QueryClient();
function page(tenantId: string) {
  return (
    <QueryClientProvider client={queryClient}>
      <ChatRuntimeProvider tenantId={tenantId}>
        <RuntimeStateProbe />
        <ThreadList />
        <Workspace />
      </ChatRuntimeProvider>
    </QueryClientProvider>
  );
}

it('renders an enabled new-chat composer without inventing attachment or model controls', async () => {
  const run = vi.spyOn(inertChatModelAdapter, 'run');
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'));
  const view = await render(page('tenant-1'));
  try {
    await settle();
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('h1')?.parentElement?.className).toBe(
      'sr-only',
    );
    expect(view.container.querySelector('h1')?.textContent).toBe('New chat');
    expect(view.container.textContent).toContain('Welcome, Ada Lovelace');
    expect(view.container.textContent).toContain('No conversations yet.');
    const input = view.container.querySelector('textarea');
    expect(input?.placeholder).toBe(
      'Ask Lexon about a contract, a regulation, or a case...',
    );
    expect(input?.disabled).toBe(false);
    expect(
      view.container.querySelector('button[type="submit"]')?.textContent,
    ).toContain('Send');
    expect(
      view.container.querySelector('[aria-label*="Attachment"]'),
    ).toBeNull();
    expect(view.container.querySelector('[aria-label*="Model"]')).toBeNull();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(
      view.container.querySelector('audio, video, [contenteditable="true"]'),
    ).toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'Draft text');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((input as HTMLTextAreaElement).value).toBe('Draft text');
    expect(network).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    await view.rerender(page('tenant-2'));
    expect(
      (view.container.querySelector('textarea') as HTMLTextAreaElement | null)
        ?.value,
    ).toBe('');
  } finally {
    await view.unmount();
    run.mockRestore();
    network.mockRestore();
  }
});

function RuntimeStateProbe() {
  const messages = useAuiState((state) => state.thread.messages.length);
  const threads = useAuiState((state) => state.threads.threadIds.length);
  const attachments = useAuiState((state) => state.composer.attachments.length);
  return (
    <output data-testid="runtime-state">
      {messages} messages / {threads} threads / {attachments} attachments
    </output>
  );
}

it('unmounts the tenant runtime when its key changes or identity is signed out', async () => {
  const run = vi.spyOn(inertChatModelAdapter, 'run');
  const view = await render(page('tenant-1'));
  try {
    await view.rerender(page('tenant-2'));
    expect(view.container.textContent).toContain('Welcome, Ada Lovelace');
    await view.rerender(<></>);
    expect(view.container.querySelector('textarea')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    run.mockRestore();
  }
});

function makeCanonicalBranchTree(active: boolean): ChatTree {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const selectedAnswerId = '33333333-3333-4333-8333-333333333333';
  const activeAnswerId = '66666666-6666-4666-8666-666666666666';
  return {
    id: chatId,
    title: 'Canonical branch fixture',
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
        id: selectedAnswerId,
        role: 'assistant',
        parentId: userId,
        runId: '44444444-4444-4444-8444-444444444444',
        text: 'Selected branch answer',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
      {
        id: activeAnswerId,
        role: 'assistant',
        parentId: userId,
        runId: '77777777-7777-4777-8777-777777777777',
        text: active ? '' : 'Terminal off-branch answer',
        status: active ? 'running' : 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:02.000Z',
      },
    ],
    viewedLeafId: selectedAnswerId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:02.000Z',
  };
}

it('refreshes the canonical off-branch tree after cancellation reaches terminal status', async () => {
  const activeTree = makeCanonicalBranchTree(true);
  const terminalTree = makeCanonicalBranchTree(false);
  let terminalAvailable = false;
  const client = {
    get: vi.fn(async () => (terminalAvailable ? terminalTree : activeTree)),
  };
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/viewed-leaf') && init?.method === 'PUT')
      return new Response(null, { status: 204 });
    if (url.endsWith('/events'))
      return new Response(new ReadableStream<Uint8Array>(), {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    if (url.endsWith('/cancel')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatView
        chatId={activeTree.id}
        client={client as never}
        actorScope="tenant-1:user-1"
        displayName="Ada"
        orgId="tenant-1"
        userId="user-1"
      />
    </QueryClientProvider>,
  );

  try {
    await settle();
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('Selected branch answer');
    expect(view.container.textContent).not.toContain(
      'Terminal off-branch answer',
    );
    const input = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    );
    if (!input) throw new Error('The public message composer did not render.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'A follow-up question');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const stop = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Stop generating"]',
    );
    expect.soft(stop).not.toBeNull();
    await act(async () => stop?.click());
    expect
      .soft(fetch.mock.calls.map(([request]) => String(request)))
      .toContain('/api/runs/77777777-7777-4777-8777-777777777777/cancel');
    expect
      .soft(
        view.container.querySelector('[aria-label="Send message"]') === null ||
          view.container.querySelector<HTMLButtonElement>(
            '[aria-label="Send message"]',
          )?.disabled,
      )
      .toBe(true);
    expect(view.container.textContent).toContain('Selected branch answer');
    expect(view.container.textContent).not.toContain(
      'Terminal off-branch answer',
    );

    await vi.waitFor(
      () => expect(client.get.mock.calls.length).toBeGreaterThan(1),
      { timeout: 2000 },
    );
    expect
      .soft(
        view.container.querySelector('[aria-label="Send message"]') === null ||
          view.container.querySelector<HTMLButtonElement>(
            '[aria-label="Send message"]',
          )?.disabled,
      )
      .toBe(true);
    terminalAvailable = true;
    const previousFetchCount = client.get.mock.calls.length;
    await vi.waitFor(
      () =>
        expect(client.get.mock.calls.length).toBeGreaterThan(
          previousFetchCount,
        ),
      { timeout: 2000 },
    );
    await vi.waitFor(() => {
      expect(
        view.container.querySelector('[aria-label="Stop generating"]'),
      ).toBeNull();
      const send = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Send message"]',
      );
      expect(send).not.toBeNull();
      expect(send?.disabled).toBe(false);
    });
    expect(view.container.textContent).toContain('Selected branch answer');
    expect(view.container.textContent).not.toContain(
      'Terminal off-branch answer',
    );

    const nextBranch = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Next branch"]',
    );
    if (!nextBranch)
      throw new Error('The public next-branch control is missing.');
    await act(async () => nextBranch.click());
    await vi.waitFor(() => {
      expect(view.container.textContent).toContain(
        'Terminal off-branch answer',
      );
    });
    const branchSelection = fetch.mock.calls.find(
      ([request, init]) =>
        String(request).endsWith('/viewed-leaf') && init?.method === 'PUT',
    );
    expect(branchSelection).toBeDefined();
    expect(JSON.parse(String(branchSelection?.[1]?.body))).toEqual({
      leafId: '66666666-6666-4666-8666-666666666666',
    });
    expect(view.container.textContent).not.toContain(
      'Could not save this branch selection',
    );
    expect(
      view.container.querySelector('[aria-label="Stop generating"]'),
    ).toBeNull();
  } finally {
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('preserves the regenerated assistant sibling across canonical active and terminal refreshes on an edited branch', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const rootUserId = '22222222-2222-4222-8222-222222222222';
  const originalAnswerId = '33333333-3333-4333-8333-333333333333';
  const editedUserId = '44444444-4444-4444-8444-444444444444';
  const editedAnswerId = '55555555-5555-4555-8555-555555555555';
  const regeneratedAnswerId = '66666666-6666-4666-8666-666666666666';
  const regeneratedRunId = '77777777-7777-4777-8777-777777777777';
  const makeTree = (state: 'edited' | 'active' | 'terminal'): ChatTree => ({
    id: chatId,
    title: 'Edited branch fixture',
    messages: [
      {
        id: rootUserId,
        role: 'user',
        parentId: null,
        text: 'Original question',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: originalAnswerId,
        role: 'assistant',
        parentId: rootUserId,
        runId: '88888888-8888-4888-8888-888888888888',
        text: 'Original answer',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
      {
        id: editedUserId,
        role: 'user',
        parentId: null,
        text: 'Edited question',
        effort: 'high',
        createdAt: '2026-11-11T00:00:02.000Z',
      },
      {
        id: editedAnswerId,
        role: 'assistant',
        parentId: editedUserId,
        runId: '99999999-9999-4999-8999-999999999999',
        text: 'Edited answer',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:03.000Z',
      },
      ...(state === 'edited'
        ? []
        : [
            {
              id: regeneratedAnswerId,
              role: 'assistant' as const,
              parentId: editedUserId,
              runId: regeneratedRunId,
              text: state === 'terminal' ? 'Regenerated answer' : '',
              status:
                state === 'terminal'
                  ? ('completed' as const)
                  : ('running' as const),
              reasoningSummary: null,
              reasoningDurationMs: null,
              feedback: null,
              createdAt: '2026-11-11T00:00:04.000Z',
            },
          ]),
    ],
    viewedLeafId: state === 'terminal' ? regeneratedAnswerId : editedAnswerId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:04.000Z',
  });
  const serverTree = makeTree('edited');
  let regenerationStarted = false;
  let terminalAvailable = false;
  let activeRefreshes = 0;
  let terminalRefreshes = 0;
  const client = {
    get: vi.fn(async () => {
      if (!regenerationStarted) return serverTree;
      if (!terminalAvailable) {
        activeRefreshes += 1;
        return makeTree('active');
      }
      terminalRefreshes += 1;
      return makeTree('terminal');
    }),
  };
  const encoder = new TextEncoder();
  const streamBody = new ReadableStream<Uint8Array>({
    start(controller) {
      const frames = [
        {
          version: 1,
          type: 'start',
          runId: regeneratedRunId,
          messageId: regeneratedAnswerId,
        },
        {
          version: 1,
          type: 'text-start',
          runId: regeneratedRunId,
          id: 'regenerated-answer-text',
        },
        {
          version: 1,
          type: 'text-delta',
          runId: regeneratedRunId,
          id: 'regenerated-answer-text',
          delta: 'Regenerated answer',
        },
      ];
      for (const [index, frame] of frames.entries())
        controller.enqueue(
          encoder.encode(
            `id: 1:1783814400000-${index}\ndata: ${JSON.stringify(frame)}\n\n`,
          ),
        );
    },
  });
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (
      url.endsWith(`/messages/${editedAnswerId}/regenerate`) &&
      init?.method === 'POST'
    ) {
      regenerationStarted = true;
      return Response.json(
        {
          chatId,
          userMessageId: editedUserId,
          assistantMessageId: regeneratedAnswerId,
          runId: regeneratedRunId,
        },
        { status: 201 },
      );
    }
    if (url.endsWith(`/runs/${regeneratedRunId}/events`))
      return new Response(streamBody, {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    if (url.endsWith('/viewed-leaf') && init?.method === 'PUT')
      return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatView
        chatId={chatId}
        client={client as never}
        actorScope="tenant-1:user-1"
        displayName="Ada"
        orgId="tenant-1"
        userId="user-1"
      />
    </QueryClientProvider>,
  );

  try {
    expect(view.container.textContent).toContain('Edited answer');

    const regenerate = view.container
      .querySelector(`[data-message-id="${editedAnswerId}"]`)
      ?.querySelector<HTMLButtonElement>('[aria-label="Regenerate answer"]');
    if (!regenerate)
      throw new Error('The edited branch regenerate control is missing.');
    await act(async () => regenerate.click());
    expect(
      fetch.mock.calls.some(
        ([request, init]) =>
          String(request).endsWith(`/messages/${editedAnswerId}/regenerate`) &&
          init?.method === 'POST',
      ),
    ).toBe(true);
    await vi.waitFor(
      () => expect(view.container.textContent).toContain('Regenerated answer'),
      { timeout: 2000 },
    );
    await vi.waitFor(() => expect(activeRefreshes).toBeGreaterThan(0), {
      timeout: 2500,
    });

    terminalAvailable = true;
    await vi.waitFor(() => expect(terminalRefreshes).toBeGreaterThan(0), {
      timeout: 2500,
    });
    await vi.waitFor(() => {
      const regeneratedMessage = view.container.querySelector(
        `[data-message-id="${regeneratedAnswerId}"]`,
      );
      expect(regeneratedMessage).not.toBeNull();
      expect(
        regeneratedMessage?.querySelector('[aria-label="Previous branch"]'),
      ).not.toBeNull();
      expect(regeneratedMessage?.textContent).toContain('2 / 2');
    });

    const previousBranch = view.container.querySelector<HTMLButtonElement>(
      `[data-message-id="${regeneratedAnswerId}"] [aria-label="Previous branch"]`,
    );
    if (!previousBranch)
      throw new Error('The regenerated assistant branch picker is missing.');
    await act(async () => previousBranch.click());
    await vi.waitFor(() => {
      expect(view.container.textContent).toContain('Edited answer');
      expect(view.container.textContent).not.toContain('Regenerated answer');
    });

    const nextBranch = view.container.querySelector<HTMLButtonElement>(
      `[data-message-id="${editedAnswerId}"] [aria-label="Next branch"]`,
    );
    if (!nextBranch)
      throw new Error('The edited assistant branch picker is missing.');
    await act(async () => nextBranch.click());
    await vi.waitFor(() => {
      expect(view.container.textContent).toContain('Regenerated answer');
      expect(view.container.textContent).not.toContain('Edited answer');
    });
    const selectedLeafWrites = fetch.mock.calls
      .filter(
        ([request, init]) =>
          String(request).endsWith('/viewed-leaf') && init?.method === 'PUT',
      )
      .map(([, init]) => JSON.parse(String(init?.body)) as { leafId: string });
    expect(selectedLeafWrites.map(({ leafId }) => leafId)).toContain(
      regeneratedAnswerId,
    );
  } finally {
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('keeps off-branch run B active when run A finishes after canonical refresh', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const answerAId = '33333333-3333-4333-8333-333333333333';
  const answerBId = '66666666-6666-4666-8666-666666666666';
  const runA = '44444444-4444-4444-8444-444444444444';
  const runB = '77777777-7777-4777-8777-777777777777';
  const makeTree = (state: 'run-a' | 'run-b' | 'terminal-b'): ChatTree => {
    const runBTerminal = state === 'terminal-b';
    const messages: ChatTree['messages'][number][] = [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Question with two answer branches',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: answerAId,
        role: 'assistant',
        parentId: userId,
        runId: runA,
        text: state === 'run-a' ? '' : 'Completed answer A',
        status: state === 'run-a' ? 'running' : 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ];
    if (state !== 'run-a')
      messages.push({
        id: answerBId,
        role: 'assistant',
        parentId: userId,
        runId: runB,
        text: runBTerminal ? 'Completed answer B' : '',
        status: runBTerminal ? 'completed' : 'running',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:02.000Z',
      });
    return {
      id: chatId,
      title: 'Delayed terminal identity fixture',
      messages,
      viewedLeafId: answerAId,
      createdAt: '2026-11-11T00:00:00.000Z',
      updatedAt: '2026-11-11T00:00:02.000Z',
    };
  };
  const initialTree = makeTree('run-a');
  const switchedTree = makeTree('run-b');
  const terminalTree = makeTree('terminal-b');
  let canonicalBAvailable = false;
  let terminalBAvailable = false;
  let bRefreshes = 0;
  let activeBRefreshes = 0;
  let canonicalBTreeReady = false;
  let holdActiveBRefreshes = true;
  let releaseCanonicalBTree: (() => void) | undefined;
  const pendingActiveBRefreshes: Array<(tree: ChatTree) => void> = [];
  const client = {
    get: vi.fn(async () => {
      if (terminalBAvailable) {
        bRefreshes += 1;
        return terminalTree;
      }
      if (!canonicalBAvailable) return initialTree;
      activeBRefreshes += 1;
      if (!canonicalBTreeReady)
        return new Promise<ChatTree>((resolve) => {
          releaseCanonicalBTree = () => {
            canonicalBTreeReady = true;
            resolve(switchedTree);
          };
        });
      if (holdActiveBRefreshes)
        return new Promise<ChatTree>((resolve) => {
          pendingActiveBRefreshes.push(resolve);
        });
      return switchedTree;
    }),
  };
  const encoder = new TextEncoder();
  let streamAController:
    ReadableStreamDefaultController<Uint8Array> | undefined;
  const streamA = new ReadableStream<Uint8Array>({
    start(controller) {
      streamAController = controller;
      controller.enqueue(
        encoder.encode(
          [
            { version: 1, type: 'start', runId: runA, messageId: answerAId },
            { version: 1, type: 'text-start', runId: runA, id: 'answer-a' },
            {
              version: 1,
              type: 'text-delta',
              runId: runA,
              id: 'answer-a',
              delta: 'Streaming answer A',
            },
          ]
            .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
            .join(''),
        ),
      );
    },
  });
  let cancelCalls = 0;
  let releaseFirstCancel: ((response: Response) => void) | undefined;
  const firstCancelResponse = new Promise<Response>((resolve) => {
    releaseFirstCancel = resolve;
  });
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === `/api/runs/${runA}/events`)
      return new Response(streamA, {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    if (path === `/api/runs/${runB}/cancel`) {
      cancelCalls += 1;
      if (cancelCalls === 1) return firstCancelResponse;
      return new Response(null, { status: 204 });
    }
    if (path.endsWith('/viewed-leaf'))
      return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatView
        chatId={chatId}
        client={client as never}
        actorScope="tenant-1:user-1"
        displayName="Ada"
        orgId="tenant-1"
        userId="user-1"
      />
    </QueryClientProvider>,
  );

  try {
    await vi.waitFor(
      () => expect(view.container.textContent).toContain('Streaming answer A'),
      { timeout: 2000 },
    );
    const input = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    );
    if (!input) throw new Error('The public message composer did not render.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'A nonempty follow-up');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    canonicalBAvailable = true;
    await vi.waitFor(
      () => expect(releaseCanonicalBTree).toBeTypeOf('function'),
      {
        timeout: 2000,
      },
    );
    await act(async () => {
      releaseCanonicalBTree?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(activeBRefreshes).toBe(1);
    expect(
      view.container.querySelector('[aria-label="Stop generating"]'),
    ).not.toBeNull();
    expect(view.container.textContent).toContain('Streaming answer A');
    expect(view.container.textContent).not.toContain('Completed answer A');
    expect(view.container.textContent).not.toContain('Completed answer B');
    expect(
      fetch.mock.calls.some(([request]) =>
        String(request).endsWith('/viewed-leaf'),
      ),
    ).toBe(false);

    const stopBeforeLateA = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Stop generating"]',
    );
    if (!stopBeforeLateA)
      throw new Error('Stop was not available for active run B.');
    await act(async () => stopBeforeLateA.click());
    await vi.waitFor(() => expect(cancelCalls).toBe(1), { timeout: 2000 });
    expect(fetch.mock.calls.map(([request]) => String(request))).toContain(
      `/api/runs/${runB}/cancel`,
    );
    await vi.waitFor(
      () => expect(pendingActiveBRefreshes.length).toBeGreaterThan(0),
      { timeout: 2500 },
    );

    await act(async () => {
      streamAController?.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ version: 1, type: 'status', runId: runA, status: 'completed' })}\n\ndata: ${JSON.stringify({ version: 1, type: 'finish', runId: runA })}\n\n`,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      view.container.querySelector('[aria-label="Stop generating"]'),
    ).not.toBeNull();
    expect(view.container.textContent).toContain('Streaming answer A');
    expect(view.container.textContent).not.toContain('Completed answer A');
    expect(view.container.textContent).not.toContain('Completed answer B');
    expect(
      fetch.mock.calls.some(([request]) =>
        String(request).endsWith('/viewed-leaf'),
      ),
    ).toBe(false);
    expect(
      view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Send message"]',
      ),
    ).toBeNull();
    for (const label of ['Edit message', 'Regenerate answer']) {
      const control = view.container.querySelector<HTMLButtonElement>(
        `[aria-label="${label}"]`,
      );
      expect(control === null || control.disabled).toBe(true);
    }
    const composerForm = input.closest('form');
    if (!composerForm) throw new Error('The public composer form is missing.');
    const submitted = new Event('submit', { bubbles: true, cancelable: true });
    await act(async () => composerForm.dispatchEvent(submitted));
    expect(submitted.defaultPrevented).toBe(true);
    expect(
      fetch.mock.calls.some(([request]) =>
        String(request).endsWith('/messages'),
      ),
    ).toBe(false);
    expect(bRefreshes).toBe(0);

    const stopAfterLateA = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Stop generating"]',
    );
    if (!stopAfterLateA)
      throw new Error('Stop was not available after run A finished.');
    await act(async () => stopAfterLateA.click());
    await vi.waitFor(() => expect(cancelCalls).toBe(2), { timeout: 2000 });
    expect(fetch.mock.calls.map(([request]) => String(request))).toContain(
      `/api/runs/${runB}/cancel`,
    );
    expect(
      view.container.querySelector('[aria-label="Stop generating"]'),
    ).not.toBeNull();

    holdActiveBRefreshes = false;
    await act(async () => {
      for (const resolve of pendingActiveBRefreshes.splice(0))
        resolve(switchedTree);
      releaseFirstCancel?.(new Response(null, { status: 204 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    terminalBAvailable = true;
    await vi.waitFor(() => expect(bRefreshes).toBeGreaterThan(0), {
      timeout: 2000,
    });
    await vi.waitFor(() => {
      expect(
        view.container.querySelector('[aria-label="Stop generating"]'),
      ).toBeNull();
      const send = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Send message"]',
      );
      expect(send).not.toBeNull();
      expect(send?.disabled).toBe(false);
    });
    expect(view.container.textContent).toContain('Completed answer A');
    expect(view.container.textContent).not.toContain('Completed answer B');
    expect(
      fetch.mock.calls.some(([request]) =>
        String(request).endsWith('/viewed-leaf'),
      ),
    ).toBe(false);
  } finally {
    holdActiveBRefreshes = false;
    for (const resolve of pendingActiveBRefreshes.splice(0))
      resolve(switchedTree);
    releaseCanonicalBTree?.();
    releaseFirstCancel?.(new Response(null, { status: 204 }));
    try {
      streamAController?.close();
    } catch {
      // The transport may have already cancelled A after its valid finish.
    }
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('reconciles a viewed active answer from canonical terminal state while SSE stays open', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const makeTree = (terminal: boolean): ChatTree => ({
    id: chatId,
    title: 'Viewed active answer fixture',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Question before live stream',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: assistantId,
        role: 'assistant',
        parentId: userId,
        runId,
        text: terminal ? 'Canonical final answer' : '',
        status: terminal ? 'completed' : 'running',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: assistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: terminal
      ? '2026-11-11T00:00:03.000Z'
      : '2026-11-11T00:00:01.000Z',
  });
  const activeTree = makeTree(false);
  const terminalTree = makeTree(true);
  let terminalRefreshes = 0;
  let terminalAvailable = false;
  const client = {
    get: vi.fn(async () => {
      if (!terminalAvailable) return activeTree;
      terminalRefreshes += 1;
      return terminalTree;
    }),
  };
  const frames = [
    { version: 1, type: 'start', runId, messageId: assistantId },
    { version: 1, type: 'text-start', runId, id: 'open-stream-text' },
    {
      version: 1,
      type: 'text-delta',
      runId,
      id: 'open-stream-text',
      delta: 'Live partial answer',
    },
  ];
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let streamClosed = false;
  const responseBody = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      for (const [index, frame] of frames.entries())
        controller.enqueue(
          encoder.encode(
            `id: 1:1783814400000-${index}\ndata: ${JSON.stringify(frame)}\n\n`,
          ),
        );
    },
    cancel() {
      streamClosed = true;
    },
  });
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(`/runs/${runId}/events`))
      return new Response(responseBody, {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    if (url.endsWith('/viewed-leaf'))
      return new Response(null, { status: 204 });
    if (url.endsWith('/cancel'))
      throw new Error('A canonical terminal refresh must not issue Stop.');
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatView
        chatId={chatId}
        client={client as never}
        actorScope="tenant-1:user-1"
        displayName="Ada"
        orgId="tenant-1"
        userId="user-1"
      />
    </QueryClientProvider>,
  );

  try {
    const input = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    );
    if (!input) throw new Error('The public message composer did not render.');
    await vi.waitFor(
      () => expect(view.container.textContent).toContain('Live partial answer'),
      { timeout: 2000 },
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'A follow-up after the answer completed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(streamClosed).toBe(false);
    expect(
      view.container.querySelector('[aria-label="Stop generating"]'),
    ).not.toBeNull();

    terminalAvailable = true;
    await vi.waitFor(() => expect(terminalRefreshes).toBeGreaterThan(0), {
      timeout: 2500,
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect.soft(view.container.textContent).toContain('Canonical final answer');
    expect
      .soft(view.container.textContent)
      .not.toContain('Live partial answer');
    expect
      .soft(view.container.querySelector('[aria-label="Stop generating"]'))
      .toBeNull();
    expect
      .soft(
        view.container.querySelector<HTMLButtonElement>(
          '[aria-label="Send message"]',
        )?.disabled,
      )
      .toBe(false);
    expect.soft(streamClosed).toBe(true);
    expect(
      fetch.mock.calls.some(([request]) => String(request).endsWith('/cancel')),
    ).toBe(false);

    try {
      streamController?.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            version: 1,
            type: 'text-delta',
            runId,
            id: 'open-stream-text',
            delta: ' Late stale SSE text',
          })}\n\n`,
        ),
      );
    } catch {
      // A closed stream cannot deliver a late frame.
    }
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect.soft(view.container.textContent).toContain('Canonical final answer');
    expect
      .soft(view.container.textContent)
      .not.toContain('Late stale SSE text');
  } finally {
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('reconciles terminal state while the initial active-run request awaits headers', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const assistantId = '33333333-3333-4333-8333-333333333333';
  const runId = '44444444-4444-4444-8444-444444444444';
  const makeTree = (terminal: boolean): ChatTree => ({
    id: chatId,
    title: 'Pending initial stream fixture',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Question before initial stream headers',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: assistantId,
        role: 'assistant',
        parentId: userId,
        runId,
        text: terminal ? 'Canonical terminal answer' : '',
        status: terminal ? 'completed' : 'running',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: assistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: terminal
      ? '2026-11-11T00:00:03.000Z'
      : '2026-11-11T00:00:01.000Z',
  });
  const activeTree = makeTree(false);
  const terminalTree = makeTree(true);
  let terminalAvailable = false;
  let terminalRefreshes = 0;
  const client = {
    get: vi.fn(async () => {
      if (!terminalAvailable) return activeTree;
      terminalRefreshes += 1;
      return terminalTree;
    }),
  };
  const frames = [
    { version: 1, type: 'start', runId, messageId: assistantId },
    { version: 1, type: 'text-start', runId, id: 'late-header-text' },
    {
      version: 1,
      type: 'text-delta',
      runId,
      id: 'late-header-text',
      delta: 'Stale late-header answer',
    },
  ];
  const encoder = new TextEncoder();
  let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let staleFramesDelivered = 0;
  let bodyCancelled = false;
  let requestSignal: AbortSignal | null | undefined;
  let requestAborted = false;
  let headersReleased = false;
  let eventFetchSettled = false;
  const staleBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      bodyController = controller;
      const index = staleFramesDelivered;
      const frame = frames[index];
      if (!frame) return;
      staleFramesDelivered += 1;
      controller.enqueue(
        encoder.encode(
          `id: 1:1783814400000-${index}\ndata: ${JSON.stringify(frame)}\n\n`,
        ),
      );
    },
    cancel() {
      bodyCancelled = true;
    },
  });
  let resolveHeaders!: (response: Response) => void;
  const pendingHeaders = new Promise<Response>((resolve) => {
    resolveHeaders = resolve;
  });
  const releaseHeaders = () => {
    if (headersReleased) return;
    headersReleased = true;
    resolveHeaders(
      new Response(staleBody, {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      }),
    );
  };
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(`/runs/${runId}/events`)) {
      requestSignal = init?.signal;
      if (requestSignal?.aborted) requestAborted = true;
      else
        requestSignal?.addEventListener(
          'abort',
          () => {
            requestAborted = true;
          },
          { once: true },
        );
      return pendingHeaders.finally(() => {
        eventFetchSettled = true;
      });
    }
    if (url.endsWith('/viewed-leaf'))
      return Promise.resolve(new Response(null, { status: 204 }));
    if (url.endsWith('/cancel'))
      return Promise.reject(
        new Error(
          'Terminal reconciliation must not issue server cancellation.',
        ),
      );
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    unhandledRejections.push(event.reason);
    event.preventDefault();
  };
  let bodyCloseFailed = false;
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  vi.stubGlobal('fetch', fetch);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatView
        chatId={chatId}
        client={client as never}
        actorScope="tenant-1:user-1"
        displayName="Ada"
        orgId="tenant-1"
        userId="user-1"
      />
    </QueryClientProvider>,
  );

  try {
    await vi.waitFor(() => expect(requestSignal).toBeDefined(), {
      timeout: 2000,
    });
    const input = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    );
    if (!input) throw new Error('The public message composer did not render.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'A follow-up after terminal completion');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.container.textContent).not.toContain(
      'Canonical terminal answer',
    );
    expect(
      view.container.querySelector('[aria-label="Stop generating"]'),
    ).not.toBeNull();
    const sendWhileActive = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Send message"]',
    );
    expect(sendWhileActive === null || sendWhileActive.disabled).toBe(true);
    expect(headersReleased).toBe(false);

    terminalAvailable = true;
    await vi.waitFor(() => expect(terminalRefreshes).toBeGreaterThan(0), {
      timeout: 2500,
    });
    await vi.waitFor(() => {
      expect(
        view.container.querySelector('[aria-label="Stop generating"]'),
      ).toBeNull();
      const send = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Send message"]',
      );
      expect(send).not.toBeNull();
      expect(send?.disabled).toBe(false);
      expect(view.container.textContent).toContain('Canonical terminal answer');
    });
    expect.soft(requestAborted).toBe(true);
    expect(headersReleased).toBe(false);

    releaseHeaders();
    await vi.waitFor(() => expect(eventFetchSettled).toBe(true), {
      timeout: 2000,
    });
    if (!requestAborted)
      await vi.waitFor(() => expect(staleFramesDelivered).toBe(frames.length), {
        timeout: 1000,
      });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(view.container.textContent).toContain('Canonical terminal answer');
    expect(view.container.textContent).not.toContain(
      'Stale late-header answer',
    );
    expect(
      view.container.querySelector('[aria-label="Stop generating"]'),
    ).toBeNull();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
      false,
    );
    expect(
      fetch.mock.calls.filter(([request]) =>
        String(request).endsWith(`/runs/${runId}/events`),
      ),
    ).toHaveLength(1);
  } finally {
    releaseHeaders();
    try {
      bodyController?.close();
    } catch {
      bodyCloseFailed = !bodyCancelled;
    }
    await view.unmount();
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    vi.stubGlobal('fetch', originalFetch);
  }
  expect(bodyCloseFailed).toBe(false);
  expect(unhandledRejections).toEqual([]);
});

it('reuses first-send identities after an accepted response is lost and manual retry', async () => {
  const createCalls: CreateChatInput[] = [];
  const acceptedByRequest = new Map<
    string,
    { input: CreateChatInput; result: ChatMutationResult }
  >();
  const startedRunIds: string[] = [];
  const create = vi.fn(async (input: CreateChatInput) => {
    createCalls.push({ ...input });
    const accepted = acceptedByRequest.get(input.requestId);
    if (accepted) {
      if (
        accepted.input.chatId !== input.chatId ||
        accepted.input.userMessageId !== input.userMessageId ||
        accepted.input.text !== input.text ||
        accepted.input.effort !== input.effort
      )
        throw new Error(
          'The accepted request identity was reused with new input.',
        );
      return accepted.result;
    }

    const result: ChatMutationResult = {
      chatId: input.chatId,
      userMessageId: input.userMessageId,
      assistantMessageId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
    };
    acceptedByRequest.set(input.requestId, { input: { ...input }, result });
    startedRunIds.push(result.runId);
    if (createCalls.length === 1)
      throw new Error(
        'The server accepted creation but its response was lost.',
      );
    return result;
  });
  const navigate = vi.fn();
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatView
        client={{ create } as never}
        actorScope="tenant-1:user-1"
        displayName="Ada"
        orgId="tenant-1"
        userId="user-1"
        onNavigate={navigate}
      />
    </QueryClientProvider>,
  );

  try {
    await settle();
    const input = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    );
    const send = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Send message"]',
    );
    const effort = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Deep thinking"]',
    );
    if (!input || !send || !effort)
      throw new Error('The public new-chat composer did not render.');

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'Explain this indemnity clause.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      effort.click();
    });
    expect(effort.getAttribute('aria-pressed')).toBe('true');

    await act(async () => send.click());
    await settle();
    expect(view.container.textContent).toContain(
      'Your message could not be sent. Please try again.',
    );
    expect(input.value).toBe('Explain this indemnity clause.');
    expect(effort.getAttribute('aria-pressed')).toBe('true');
    expect(create).toHaveBeenCalledTimes(1);
    expect(createCalls).toHaveLength(1);
    expect(acceptedByRequest.size).toBe(1);
    expect(startedRunIds).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => send.click());
    await settle();
    expect(create).toHaveBeenCalledTimes(2);
    expect(createCalls[1]).toEqual(createCalls[0]);
    expect(acceptedByRequest.size).toBe(1);
    expect(startedRunIds).toHaveLength(1);
    const firstAccepted = acceptedByRequest.get(createCalls[0]!.requestId);
    if (!firstAccepted) throw new Error('The first request was not accepted.');
    expect(navigate).toHaveBeenLastCalledWith(
      `/chats/${firstAccepted.result.chatId}`,
    );
    expect(input.value).toBe('');
    expect(effort.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'Explain this indemnity clause.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      effort.click();
    });
    expect(effort.getAttribute('aria-pressed')).toBe('true');
    await act(async () => send.click());
    await settle();
    expect(create).toHaveBeenCalledTimes(3);
    expect(createCalls[2]).toMatchObject({
      text: createCalls[0]?.text,
      effort: createCalls[0]?.effort,
    });
    expect(createCalls[2]?.text).toBe(createCalls[0]?.text);
    expect(createCalls[2]?.effort).toBe(createCalls[0]?.effort);
    expect(effort.getAttribute('aria-pressed')).toBe('false');
    expect(createCalls[2]?.chatId).not.toBe(createCalls[0]?.chatId);
    expect(createCalls[2]?.userMessageId).not.toBe(
      createCalls[0]?.userMessageId,
    );
    expect(createCalls[2]?.requestId).not.toBe(createCalls[0]?.requestId);
    expect(acceptedByRequest.size).toBe(2);
    expect(startedRunIds).toHaveLength(2);
    expect(navigate).toHaveBeenLastCalledWith(
      `/chats/${createCalls[2]?.chatId}`,
    );
  } finally {
    await view.unmount();
  }
});

it.each([
  ['text', 'Compare the limitation of liability.'],
  ['effort', 'Explain this indemnity clause.'],
] as const)(
  'starts fresh identities after an ambiguous failure when only %s changes',
  async (changedField, changedText) => {
    const createCalls: CreateChatInput[] = [];
    const acceptedByRequest = new Map<
      string,
      { input: CreateChatInput; result: ChatMutationResult }
    >();
    const startedRunIds: string[] = [];
    const create = vi.fn(async (input: CreateChatInput) => {
      createCalls.push({ ...input });
      const accepted = acceptedByRequest.get(input.requestId);
      if (accepted) return accepted.result;
      const result: ChatMutationResult = {
        chatId: input.chatId,
        userMessageId: input.userMessageId,
        assistantMessageId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
      };
      acceptedByRequest.set(input.requestId, { input: { ...input }, result });
      startedRunIds.push(result.runId);
      if (createCalls.length === 1)
        throw new Error(
          'The server accepted creation but its response was lost.',
        );
      return result;
    });
    const navigate = vi.fn();
    const view = await render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatView
          client={{ create } as never}
          actorScope="tenant-1:user-1"
          displayName="Ada"
          orgId="tenant-1"
          userId="user-1"
          onNavigate={navigate}
        />
      </QueryClientProvider>,
    );

    try {
      await settle();
      const input = view.container.querySelector<HTMLTextAreaElement>(
        '[aria-label="Message input"]',
      );
      const send = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Send message"]',
      );
      const effort = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Deep thinking"]',
      );
      if (!input || !send || !effort)
        throw new Error('The public new-chat composer did not render.');

      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )!.set!.call(input, 'Explain this indemnity clause.');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => send.click());
      await settle();
      expect(create).toHaveBeenCalledTimes(1);
      expect(acceptedByRequest.size).toBe(1);
      expect(startedRunIds).toHaveLength(1);

      if (changedField === 'text') {
        await act(async () => {
          Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
          )!.set!.call(input, changedText);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      } else {
        await act(async () => effort.click());
      }
      await act(async () => send.click());
      await settle();

      expect(create).toHaveBeenCalledTimes(2);
      expect(createCalls[1]?.text).toBe(changedText);
      expect(createCalls[1]?.effort).toBe(
        changedField === 'effort' ? 'max' : 'high',
      );
      expect(createCalls[1]?.chatId).not.toBe(createCalls[0]?.chatId);
      expect(createCalls[1]?.userMessageId).not.toBe(
        createCalls[0]?.userMessageId,
      );
      expect(createCalls[1]?.requestId).not.toBe(createCalls[0]?.requestId);
      expect(acceptedByRequest.size).toBe(2);
      expect(startedRunIds).toHaveLength(2);
      expect(navigate).toHaveBeenLastCalledWith(
        `/chats/${createCalls[1]?.chatId}`,
      );
    } finally {
      await view.unmount();
    }
  },
);
