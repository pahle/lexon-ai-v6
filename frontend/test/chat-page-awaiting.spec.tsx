import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatApi, ChatPage, ChatTree } from '@lexon/contracts';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatHistory, RecentChats } from '../src/components/chat/chat-history';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import { Thread } from '../src/components/assistant-ui/elements/thread.aui.js';
import { SidebarProvider } from '../src/components/ui/sidebar';
import { render, settleUntil } from './render.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const assistantId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';
const snapshotHash = 'b'.repeat(64);

const questionOp = {
  operationId,
  kind: 'question',
  status: 'awaiting_approval',
  approvalRequired: true,
  snapshotHash,
  expiresAt: '2026-11-25T10:42:00.000Z',
  decidedAt: null,
  toolName: 'ask_user',
  input: {
    questions: [
      {
        questionId: 'q1',
        text: 'Which filing deadline applies?',
        kind: 'single',
        options: [{ label: '30 days' }, { label: '60 days' }],
      },
    ],
  },
};

const pausedTree: ChatTree = {
  id: chatId,
  title: 'Draf somasi wanprestasi',
  messages: [
    {
      id: userId,
      role: 'user',
      parentId: null,
      text: 'Hitung tenggatnya.',
      effort: 'high',
      createdAt: '2026-11-11T00:00:00.000Z',
    },
    {
      id: assistantId,
      role: 'assistant',
      parentId: userId,
      runId,
      text: 'Sebentar, saya butuh satu detail.',
      status: 'awaiting_approval',
      reasoningSummary: null,
      reasoningDurationMs: null,
      feedback: null,
      operations: [questionOp],
      createdAt: '2026-11-11T00:00:01.000Z',
    },
  ],
  viewedLeafId: assistantId,
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:01.000Z',
} as ChatTree;

const invalidationSubscribe = vi.hoisted(() => vi.fn(() => vi.fn()));
const toastSpy = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const workspaceState = vi.hoisted(() => ({ chatTitleRefreshVersion: 0 }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: invalidationSubscribe,
}));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => ({
    setChatTitle: vi.fn(),
    chatTitleRefreshVersion: workspaceState.chatTitleRefreshVersion,
  }),
}));
vi.mock('sonner', () => ({ toast: toastSpy }));

const scope = {
  orgId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
};

function item(index: number, title: string, awaitingUser: boolean) {
  const id = `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`;
  return {
    id,
    title,
    updatedAt: '2026-11-13T09:00:00.000Z',
    lastMessageAt: '2026-11-13T09:00:00.000Z',
    awaitingUser,
  };
}
function page(items: ChatPage['items']): ChatPage {
  return { items, pageInfo: { nextCursor: null } };
}
function withQueryClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(['identity'], {
    user: { id: scope.userId },
    organization: { id: scope.orgId },
  });
  client.setQueryData(['active-organization'], { id: scope.orgId });
  return (
    <QueryClientProvider client={client}>
      <SidebarProvider>{node}</SidebarProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  workspaceState.chatTitleRefreshVersion = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('marks a waiting chat in the Chats list before its timestamp', async () => {
  const api = {
    list: vi.fn(async () =>
      page([item(1, 'Waiting chat', true), item(2, 'Done chat', false)]),
    ),
  } as unknown as ChatApi;
  const view = await render(
    withQueryClient(<ChatHistory client={api} scope={scope} />),
  );
  try {
    await settleUntil(() =>
      view.container.textContent!.includes('Waiting chat'),
    );
    const row = [...view.container.querySelectorAll('a')]
      .find((link) => link.textContent?.includes('Waiting chat'))
      ?.closest('.group\\/row');
    expect(row?.textContent).toContain('Waiting for you');
    const doneRow = [...view.container.querySelectorAll('a')]
      .find((link) => link.textContent?.includes('Done chat'))
      ?.closest('.group\\/row');
    expect(doneRow?.textContent).not.toContain('Waiting for you');
  } finally {
    await view.unmount();
  }
});

it('shows a waiting dot on a Recent item', async () => {
  const api = {
    list: vi.fn(async () => page([item(1, 'Waiting chat', true)])),
  } as unknown as ChatApi;
  const view = await render(
    withQueryClient(<RecentChats client={api} scope={scope} />),
  );
  try {
    await settleUntil(() =>
      view.container.textContent!.includes('Waiting chat'),
    );
    expect(
      view.container.querySelector('[data-slot="chat-waiting-dot"]'),
    ).not.toBeNull();
  } finally {
    await view.unmount();
  }
});

it('keeps polling and the stream alive for a paused run past the calm window', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
  const onTreeRefresh = vi.fn(async () => ({
    notModified: false as const,
    tree: pausedTree,
    etag: 'W/"v1.etag-paused"',
  }));
  const view = await render(
    <ChatRuntime
      actorScope="tenant-1:user-1"
      chatId={chatId}
      tree={pausedTree}
      onTreeRefresh={onTreeRefresh}
    >
      <Thread displayName="Ada" />
    </ChatRuntime>,
  );
  try {
    // Past the 5 s calm window a paused run still counts as active: the
    // poll keeps going and the composer is not torn down.
    await vi.advanceTimersByTimeAsync(5_500);
    expect(onTreeRefresh).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    const calls = onTreeRefresh.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
    const input = view.container.querySelector<HTMLElement>(
      '[data-slot="aui_composer-shell"] textarea',
    );
    expect(input?.getAttribute('disabled')).toBeNull();
    expect(view.container.textContent).toContain('Waiting for you');
  } finally {
    await view.unmount();
  }
});

it('shows the send button and hides Stop while the run waits', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
  const view = await render(
    <ChatRuntime actorScope="tenant-1:user-1" chatId={chatId} tree={pausedTree}>
      <Thread displayName="Ada" />
    </ChatRuntime>,
  );
  try {
    await vi.advanceTimersByTimeAsync(50);
    const stop = view.container.querySelector('[aria-label="Stop generating"]');
    expect(stop).toBeNull();
    const send = view.container.querySelector(
      '[data-slot="aui_composer-shell"] button:last-child',
    );
    expect(send).not.toBeNull();
    expect(
      view.container.querySelector('[aria-label*="Send"]') ??
        view.container.querySelectorAll(
          '[data-slot="aui_composer-shell"] button',
        ),
    ).not.toBeNull();
  } finally {
    await view.unmount();
  }
});

it('sends a typed reply while paused (the server supersedes the waiting run)', async () => {
  vi.useFakeTimers();
  const posts: { url: unknown; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown, init?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.endsWith(`/chats/${chatId}/messages`) &&
        init?.method === 'POST'
      ) {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              chatId,
              runId,
              userMessageId: userId,
              assistantMessageId: assistantId,
              parentMessageId: userId,
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return new Promise<Response>(() => undefined);
    }),
  );
  const view = await render(
    <ChatRuntime actorScope="tenant-1:user-1" chatId={chatId} tree={pausedTree}>
      <Thread displayName="Ada" />
    </ChatRuntime>,
  );
  try {
    await vi.advanceTimersByTimeAsync(50);
    const textarea = view.container.querySelector<HTMLTextAreaElement>(
      '[data-slot="aui_composer-shell"] textarea',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(textarea, 'Use the 30 day deadline.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = textarea.closest('form')!;
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    await vi.advanceTimersByTimeAsync(50);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posts.length).toBe(1);
    expect(posts[0]?.url).toBe(`/api/chats/${chatId}/messages`);
    expect((posts[0]?.body as { text: string }).text).toBe(
      'Use the 30 day deadline.',
    );
  } finally {
    await view.unmount();
  }
});

it('does not mark a completed chat as waiting', async () => {
  const api = {
    list: vi.fn(async () => page([item(1, 'Done chat', false)])),
  } as unknown as ChatApi;
  const view = await render(
    withQueryClient(<ChatHistory client={api} scope={scope} />),
  );
  try {
    await settleUntil(() => view.container.textContent!.includes('Done chat'));
    expect(view.container.textContent).not.toContain('Waiting for you');
    expect(
      view.container.querySelector('[data-slot="chat-waiting-dot"]'),
    ).toBeNull();
  } finally {
    await view.unmount();
  }
});
