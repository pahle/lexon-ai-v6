import { expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatApi, ChatPage } from '@lexon/contracts';
import { ChatHistory, RecentChats } from '../src/components/chat/chat-history';
import { ChatRename } from '../src/components/chat/chat-rename';
import { ChatDeleteDialog } from '../src/components/chat/chat-delete-dialog';
import { SidebarProvider } from '../src/components/ui/sidebar';
import {
  chatListQueryKey,
  chatSearchQueryKey,
  groupChatsByDate,
} from '../src/lib/chat-queries';
import { render, settle } from './render';
import { transitionTenant } from '../src/lib/tenant-queries';

const { replaceRoute, pathState } = vi.hoisted(() => ({
  replaceRoute: vi.fn(),
  pathState: { current: '/workspace' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceRoute, push: vi.fn() }),
  usePathname: () => pathState.current,
}));
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

const chatId = '00000000-0000-4000-8000-000000000003';
const scope = {
  orgId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
};
function item(index: number, title = `Chat ${index}`) {
  const id = `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`;
  return {
    id,
    title,
    updatedAt: '2026-11-13T09:00:00.000Z',
    lastMessageAt: '2026-11-13T09:00:00.000Z',
  };
}
function page(
  items: ChatPage['items'],
  nextCursor: string | null = null,
): ChatPage {
  return { items, pageInfo: { nextCursor } };
}
function withQueryClient(
  node: React.ReactNode,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  }),
) {
  client.setQueryData(['identity'], {
    user: { id: scope.userId },
    organization: { id: scope.orgId },
  });
  client.setQueryData(['active-organization'], { id: scope.orgId });
  return {
    client,
    node: (
      <QueryClientProvider client={client}>
        <SidebarProvider>{node}</SidebarProvider>
      </QueryClientProvider>
    ),
  };
}

it('keeps each chat query under the approved tenant-org-chat-owner key family', () => {
  expect(chatListQueryKey(scope, 6)).toEqual([
    'tenant',
    scope.orgId,
    'chat',
    scope.userId,
    'list',
    6,
  ]);
});

it('groups chat history into Today, Yesterday, previous seven days and month-year', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const items = [
    ['Today chat', '2026-11-13T09:00:00.000Z'],
    ['Yesterday chat', '2026-11-12T09:00:00.000Z'],
    ['Previous week chat', '2026-11-10T09:00:00.000Z'],
    ['Older chat', '2026-10-02T09:00:00.000Z'],
  ].map(([title, updatedAt], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    title: title!,
    updatedAt: updatedAt!,
    lastMessageAt: updatedAt!,
  }));
  expect(groupChatsByDate(items, now).map((group) => group.label)).toEqual([
    'Today',
    'Yesterday',
    'Previous 7 days',
    'October 2026',
  ]);
});

it('loads exactly six owner-scoped Recent chats', async () => {
  const all = Array.from({ length: 8 }, (_, index) => item(index));
  const api = {
    list: vi.fn(async (input?: { limit?: number }) =>
      page(all.slice(0, input?.limit ?? 20)),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<RecentChats client={api} scope={scope} />);
  const view = await render(wrapped.node);
  await settle();
  expect(api.list).toHaveBeenCalledWith({ limit: 6 }, expect.any(AbortSignal));
  expect(
    view.container.querySelectorAll('[data-slot="sidebar-menu-item"]'),
  ).toHaveLength(6);
  expect(view.container.textContent).not.toContain('Chat 6');
  await view.unmount();
  wrapped.client.clear();
});

it('replaces the Recent title link with its inline editor and restores or saves it', async () => {
  let serverTitle = 'Original recent title';
  const api = {
    list: vi.fn(async () =>
      page([{ ...item(1, serverTitle), id: chatId, title: serverTitle }]),
    ),
    rename: vi.fn(async (_id: string, input: { title: string }) => {
      serverTitle = input.title;
    }),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<RecentChats client={api} scope={scope} />);
  const view = await render(wrapped.node);
  await settle();
  const row = () =>
    view.container.querySelector('[data-slot="sidebar-menu-item"]')!;
  const titleLink = () =>
    row().querySelector('a[href="/chats/' + chatId + '"]');
  const startRename = async () => {
    await act(async () =>
      row()
        .querySelector<HTMLButtonElement>(
          '[aria-label="Chat actions for Original recent title"]',
        )!
        .click(),
    );
    await act(async () =>
      (
        document.body.querySelector(
          '[data-slot="dropdown-menu-item"]',
        ) as HTMLElement
      ).click(),
    );
  };

  expect(titleLink()?.textContent).toBe('Original recent title');
  await startRename();
  expect(titleLink()).toBeNull();
  const cancelInput = row().querySelector<HTMLInputElement>(
    'input[aria-label="Chat title"]',
  )!;
  await act(async () =>
    cancelInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(titleLink()?.textContent).toBe('Original recent title');
  expect(row().querySelector('input[aria-label="Chat title"]')).toBeNull();

  await startRename();
  const input = row().querySelector<HTMLInputElement>(
    'input[aria-label="Chat title"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'Saved recent title');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    input.form!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  await settle();
  expect(api.rename).toHaveBeenCalledWith(chatId, {
    title: 'Saved recent title',
  });
  expect(titleLink()?.textContent).toBe('Saved recent title');
  await view.unmount();
  wrapped.client.clear();
});

it('loads cursor pages and groups Chats history by activity date', async () => {
  const today = item(1, 'Today chat');
  const older = {
    ...item(2, 'Older chat'),
    updatedAt: '2026-10-02T09:00:00.000Z',
  };
  const api = {
    list: vi.fn(async (input?: { cursor?: string }) =>
      input?.cursor ? page([older]) : page([today], 'next'),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<ChatHistory client={api} scope={scope} />);
  const view = await render(wrapped.node);
  await settle();
  expect(view.container.textContent).toContain('Today');
  expect(view.container.textContent).toContain('Today chat');
  const loadMore = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('Load more chats'),
  );
  await act(async () => loadMore?.click());
  await settle();
  expect(api.list).toHaveBeenCalledWith(
    { limit: 20, cursor: 'next' },
    expect.any(AbortSignal),
  );
  expect(view.container.textContent).toContain('October 2026');
  await view.unmount();
  wrapped.client.clear();
});

it('shows the approved guidance in empty Chats history', async () => {
  const api = {
    list: vi.fn(async () => page([])),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<ChatHistory client={api} scope={scope} />);
  const view = await render(wrapped.node);
  await settle();

  expect(view.container.textContent).toContain(
    'Start a new chat to ask Lexon about a contract, a regulation, or a case.',
  );

  await view.unmount();
  wrapped.client.clear();
});

it('renders empty Chats New chat as a link without a native-button warning', async () => {
  const consoleError = vi.spyOn(console, 'error');
  const api = {
    list: vi.fn(async () => page([])),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<ChatHistory client={api} scope={scope} />);
  let view: Awaited<ReturnType<typeof render>> | undefined;

  try {
    view = await render(wrapped.node);
    await settle();

    const newChatLink = view.container.querySelector('a[href="/workspace"]');
    expect(newChatLink?.tagName).toBe('A');
    expect(newChatLink?.textContent).toBe('New chat');
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining(
        'A component that acts as a button expected a native <button>',
      ),
    );
  } finally {
    if (view) await view.unmount();
    wrapped.client.clear();
    consoleError.mockRestore();
  }
});

it('offers rename and delete from the chat actions menu', async () => {
  const api = {
    list: vi.fn(async () => page([item(1, 'Employment dispute')])),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<ChatHistory client={api} scope={scope} />);
  const view = await render(wrapped.node);
  await settle();
  const actions = view.container.querySelector(
    '[aria-label="Chat actions for Employment dispute"]',
  ) as HTMLButtonElement;
  await act(async () => actions.click());
  await settle();
  expect(document.body.textContent).toContain('Rename');
  expect(document.body.textContent).toContain('Delete');
  await view.unmount();
  wrapped.client.clear();
});

it('trims a renamed title and keeps the form actionable after a failed save', async () => {
  const saved = vi.fn();
  const api = {
    rename: vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <ChatRename
      chatId={chatId}
      title="Old title"
      client={api}
      scope={scope}
      onCancel={vi.fn()}
      onSaved={saved}
    />,
  );
  const view = await render(wrapped.node);
  expect(
    view.container.querySelector('button[type="submit"]')?.textContent,
  ).not.toBe('Save');
  expect(view.container.querySelector('button[type="button"]')).toBeNull();
  const input = view.container.querySelector('input')!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!;
  setter.call(input, '  New title  ');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const form = view.container.querySelector('form')!;
  await act(async () =>
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ),
  );
  expect(view.container.textContent).toContain('The title could not be saved');
  expect(input.value).toBe('  New title  ');
  await act(async () =>
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ),
  );
  expect(api.rename).toHaveBeenLastCalledWith(chatId, { title: 'New title' });
  expect(saved).toHaveBeenCalledWith('New title');
  await view.unmount();
  wrapped.client.clear();
});

it('cancels inline rename with Escape', async () => {
  const onCancel = vi.fn();
  const wrapped = withQueryClient(
    <ChatRename
      chatId={chatId}
      title="Old title"
      client={{ rename: vi.fn() } as unknown as ChatApi}
      scope={scope}
      onCancel={onCancel}
      onSaved={vi.fn()}
    />,
  );
  const view = await render(wrapped.node);
  const input = view.container.querySelector('input')!;
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  expect(onCancel).toHaveBeenCalledOnce();
  await view.unmount();
  wrapped.client.clear();
});

it('prevents saving titles longer than 120 Unicode characters', async () => {
  const api = { rename: vi.fn() } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <ChatRename
      chatId={chatId}
      title="Old"
      client={api}
      scope={scope}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  const view = await render(wrapped.node);
  const input = view.container.querySelector('input')!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!.call(input, '😀'.repeat(121));
  await act(async () =>
    input.dispatchEvent(new Event('input', { bubbles: true })),
  );
  expect(view.container.textContent).toContain('120 characters or fewer');
  await act(async () =>
    view.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(api.rename).not.toHaveBeenCalled();
  await view.unmount();
  wrapped.client.clear();
});

it('keeps delete confirmation open and retryable when the server refuses deletion', async () => {
  let reject!: (error: Error) => void;
  const api = {
    delete: vi.fn(
      () =>
        new Promise<void>((_resolve, no) => {
          reject = no;
        }),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <ChatDeleteDialog
      chatId={chatId}
      title="Private chat"
      client={api}
      scope={scope}
    />,
  );
  const cacheKey = chatListQueryKey(scope, 6);
  wrapped.client.setQueryData(
    cacheKey,
    page([{ ...item(1, 'Private chat'), id: chatId }]),
  );
  const view = await render(wrapped.node);
  await act(async () => view.container.querySelector('button')?.click());
  const confirm = document.body.querySelector(
    'button[data-slot="alert-dialog-action"]',
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  await settle();
  expect((wrapped.client.getQueryData(cacheKey) as ChatPage).items).toEqual([]);
  await act(async () => reject(new Error('offline')));
  await settle();
  expect(document.body.textContent).toContain('The chat could not be deleted');
  expect(
    document.body.querySelector('button[data-slot="alert-dialog-action"]'),
  ).toBeTruthy();
  expect(
    (wrapped.client.getQueryData(cacheKey) as ChatPage).items,
  ).toHaveLength(1);
  await view.unmount();
  wrapped.client.clear();
});

it('renders delete chat confirmation with a solid destructive button', async () => {
  const api = { delete: vi.fn() } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <ChatDeleteDialog
      chatId={chatId}
      title="Private chat"
      client={api}
      scope={scope}
    />,
  );
  const view = await render(wrapped.node);
  await act(async () => view.container.querySelector('button')?.click());

  const confirm = document.body.querySelector(
    'button[data-slot="alert-dialog-action"]',
  ) as HTMLButtonElement;
  expect(confirm.classList.contains('bg-destructive')).toBe(true);
  expect(confirm.classList.contains('text-destructive-foreground')).toBe(true);
  expect(confirm.classList.contains('bg-destructive/10')).toBe(false);
  await view.unmount();
  wrapped.client.clear();
});

it('keeps row-owned refusal feedback and retry controls after optimistic unmount', async () => {
  let reject!: (error: Error) => void;
  const api = {
    list: vi
      .fn()
      .mockResolvedValue(page([{ ...item(1, 'Refused row'), id: chatId }])),
    delete: vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((_resolve, no) => (reject = no)),
      )
      .mockResolvedValueOnce(undefined),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<RecentChats client={api} scope={scope} />);
  const key = chatListQueryKey(scope, 6);
  wrapped.client.setQueryData(
    key,
    page([{ ...item(1, 'Refused row'), id: chatId }]),
  );
  const view = await render(wrapped.node);
  await settle();
  const rowAction = view.container.querySelector(
    '[aria-label="Chat actions for Refused row"]',
  ) as HTMLButtonElement;
  await act(async () => rowAction.click());
  await act(async () =>
    (
      document.body.querySelector(
        '[data-slot="dropdown-menu-item"]:last-child',
      ) as HTMLElement
    ).click(),
  );
  await act(async () =>
    (
      document.body.querySelector(
        'button[data-slot="alert-dialog-action"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await vi.waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
  await settle();
  expect((wrapped.client.getQueryData(key) as ChatPage).items).toEqual([]);
  expect(
    view.container.querySelector('[aria-label="Chat actions for Refused row"]'),
  ).toBeNull();
  await act(async () => reject(new Error('offline')));
  await settle();
  await act(
    async () => await new Promise((resolve) => setTimeout(resolve, 150)),
  );
  const refusalDialog = document.body.querySelector('[role="alertdialog"]');
  const refusalText = refusalDialog?.textContent ?? '';
  const refusalOpen = refusalDialog?.hasAttribute('data-open') === true;
  const retry = refusalDialog?.querySelector(
    'button[data-slot="alert-dialog-action"]',
  ) as HTMLButtonElement | null;
  const cancel = refusalDialog?.querySelector(
    'button[data-slot="alert-dialog-cancel"]',
  );
  if (retry) {
    await act(async () => retry.click());
    await vi.waitFor(() => expect(api.delete).toHaveBeenCalledTimes(2));
  }
  await view.unmount();
  wrapped.client.clear();
  expect(refusalText).toContain('The chat could not be deleted');
  expect(refusalOpen).toBe(true);
  expect(retry).toBeTruthy();
  expect(cancel).toBeTruthy();
});

it('keeps the last history row refusal dialog mounted through the empty state', async () => {
  let reject!: (error: Error) => void;
  const historyItem = { ...item(1, 'Last history row'), id: chatId };
  const api = {
    list: vi.fn().mockResolvedValue(page([historyItem])),
    delete: vi.fn(
      () =>
        new Promise<void>((_resolve, no) => {
          reject = no;
        }),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<ChatHistory client={api} scope={scope} />);
  const key = chatListQueryKey(scope, 20);
  wrapped.client.setQueryData(key, {
    pages: [page([historyItem])],
    pageParams: [undefined],
  });
  const view = await render(wrapped.node);
  await settle();
  await act(async () =>
    view.container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Chat actions for Last history row"]',
      )!
      .click(),
  );
  await act(async () =>
    (
      document.body.querySelector(
        '[data-slot="dropdown-menu-item"][data-variant="destructive"]',
      ) as HTMLElement
    ).click(),
  );
  await act(async () =>
    (
      document.body.querySelector(
        'button[data-slot="alert-dialog-action"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await vi.waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
  await settle();
  expect(view.container.textContent).toContain('No chats yet');
  expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
  await act(async () => reject(new Error('offline')));
  await settle();
  await act(
    async () => await new Promise((resolve) => setTimeout(resolve, 150)),
  );
  const dialog = document.body.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain('The chat could not be deleted');
  expect(
    dialog?.querySelector('button[data-slot="alert-dialog-action"]'),
  ).toBeTruthy();
  expect(
    dialog?.querySelector('button[data-slot="alert-dialog-cancel"]'),
  ).toBeTruthy();
  await view.unmount();
  wrapped.client.clear();
});

it('restores only failed chat A after concurrent chat B deletion succeeds', async () => {
  let rejectA!: (error: Error) => void;
  const chatB = '00000000-0000-4000-8000-000000000012';
  const api = {
    delete: vi.fn((id: string) =>
      id === chatId
        ? new Promise<void>((_resolve, no) => (rejectA = no))
        : Promise.resolve(),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <>
      <ChatDeleteDialog
        chatId={chatId}
        title="Chat A"
        client={api}
        scope={scope}
      />
      <ChatDeleteDialog
        chatId={chatB}
        title="Chat B"
        client={api}
        scope={scope}
      />
    </>,
  );
  const key = chatListQueryKey(scope, 6);
  const searchKey = chatSearchQueryKey(scope, 'chat');
  const a = { ...item(1, 'Chat A'), id: chatId };
  const b = { ...item(2, 'Chat B'), id: chatB };
  wrapped.client.setQueryData(key, page([a, b]));
  wrapped.client.setQueryData(searchKey, {
    items: [a, b].map((record) => ({
      chatId: record.id,
      title: record.title,
      messageId: null,
      excerpt: record.title,
      matchStart: 0,
      matchEnd: 4,
      updatedAt: record.updatedAt,
    })),
    pageInfo: { nextCursor: null },
  });
  const view = await render(wrapped.node);
  const triggers = Array.from(view.container.querySelectorAll('button')).filter(
    (button) => button.textContent?.trim() === 'Delete',
  );
  await act(async () => triggers[0]!.click());
  await act(async () =>
    (
      document.body.querySelectorAll(
        'button[data-slot="alert-dialog-action"]',
      )[0] as HTMLButtonElement
    ).click(),
  );
  await vi.waitFor(() => expect(api.delete).toHaveBeenCalledWith(chatId));
  await act(async () => triggers[1]!.click());
  await act(async () =>
    document.body
      .querySelectorAll<HTMLButtonElement>(
        'button[data-slot="alert-dialog-action"]',
      )
      [
        document.body.querySelectorAll(
          'button[data-slot="alert-dialog-action"]',
        ).length - 1
      ]!.click(),
  );
  await vi.waitFor(() => expect(api.delete).toHaveBeenCalledWith(chatB));
  await settle();
  await act(async () => rejectA(new Error('Chat A refused')));
  await settle();
  const listIds = (wrapped.client.getQueryData(key) as ChatPage).items.map(
    (entry) => entry.id,
  );
  const searchIds = (
    wrapped.client.getQueryData(searchKey) as {
      items: Array<{ chatId: string }>;
    }
  ).items.map((entry) => entry.chatId);
  await view.unmount();
  wrapped.client.clear();
  expect(listIds).toEqual([chatId]);
  expect(searchIds).toEqual([chatId]);
});

it('preserves concurrent rename and refreshed search data when restoring a refused delete', async () => {
  let reject!: (error: Error) => void;
  const chatB = '00000000-0000-4000-8000-000000000012';
  const api = {
    delete: vi.fn(() => new Promise<void>((_resolve, no) => (reject = no))),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <ChatDeleteDialog
      chatId={chatId}
      title="Chat A"
      client={api}
      scope={scope}
    />,
  );
  const key = chatListQueryKey(scope, 6);
  const searchKey = chatSearchQueryKey(scope, 'chat');
  const a = { ...item(1, 'Chat A'), id: chatId };
  const b = { ...item(2, 'Chat B'), id: chatB };
  wrapped.client.setQueryData(key, page([a, b]));
  const searchPage = (title: string, excerpt: string) => ({
    items: [
      {
        chatId: chatB,
        title,
        messageId: null,
        excerpt,
        matchStart: 0,
        matchEnd: 4,
        updatedAt: b.updatedAt,
      },
    ],
    pageInfo: { nextCursor: null },
  });
  wrapped.client.setQueryData(searchKey, {
    items: [a, b].map((record) => ({
      chatId: record.id,
      title: record.title,
      messageId: null,
      excerpt: record.title,
      matchStart: 0,
      matchEnd: 4,
      updatedAt: record.updatedAt,
    })),
    pageInfo: { nextCursor: null },
  });
  const view = await render(wrapped.node);
  const deleteTrigger = Array.from(
    view.container.querySelectorAll('button'),
  ).find((button) => button.textContent?.trim() === 'Delete');
  await act(async () => deleteTrigger?.click());
  await act(async () =>
    (
      document.body.querySelector(
        'button[data-slot="alert-dialog-action"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await vi.waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
  wrapped.client.setQueryData(key, page([{ ...b, title: 'Renamed Chat B' }]));
  wrapped.client.setQueryData(
    searchKey,
    searchPage('Renamed Chat B', 'new search excerpt'),
  );
  await act(async () => reject(new Error('Chat A refused')));
  await settle();
  const current = wrapped.client.getQueryData(key) as ChatPage;
  const currentSearch = wrapped.client.getQueryData(searchKey) as {
    items: Array<{ chatId: string; title: string; excerpt: string }>;
  };
  const currentItems = current.items;
  const searchItems = currentSearch.items;
  await view.unmount();
  wrapped.client.clear();
  expect(currentItems.find((entry) => entry.id === chatId)).toBeDefined();
  expect(currentItems.find((entry) => entry.id === chatB)?.title).toBe(
    'Renamed Chat B',
  );
  expect(searchItems).toEqual([
    expect.objectContaining({
      chatId: chatB,
      title: 'Renamed Chat B',
      excerpt: 'new search excerpt',
    }),
    expect.objectContaining({ chatId: chatId, title: 'Chat A' }),
  ]);
});

it('sends the user to New chat after the server accepts current-chat deletion', async () => {
  pathState.current = `/chats/${chatId}`;
  window.history.replaceState({}, '', `/chats/${chatId}`);
  const api = {
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <ChatDeleteDialog
      chatId={chatId}
      title="Current chat"
      client={api}
      scope={scope}
    />,
  );
  const view = await render(wrapped.node);
  await act(async () => view.container.querySelector('button')?.click());
  const confirm = document.body.querySelector(
    'button[data-slot="alert-dialog-action"]',
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  await settle();
  expect(replaceRoute).toHaveBeenCalledWith('/workspace');
  pathState.current = '/workspace';
  await view.unmount();
  wrapped.client.clear();
});

it('redirects after accepted deletion even when optimistic removal unmounts the sidebar row', async () => {
  let resolve!: () => void;
  window.history.replaceState({}, '', `/chats/${chatId}`);
  const api = {
    list: vi
      .fn()
      .mockResolvedValue(page([{ ...item(1, 'Current chat'), id: chatId }])),
    delete: vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <SidebarProvider>
      <RecentChats client={api} scope={scope} currentChatId={chatId} />
    </SidebarProvider>,
  );
  wrapped.client.setQueryData(
    chatListQueryKey(scope, 6),
    page([{ ...item(1, 'Current chat'), id: chatId }]),
  );
  const view = await render(wrapped.node);
  const actions = view.container.querySelector(
    '[aria-label="Chat actions for Current chat"]',
  ) as HTMLButtonElement;
  await act(async () => actions.click());
  const deleteItem = document.body.querySelector(
    '[data-slot="dropdown-menu-item"]:last-child',
  ) as HTMLElement;
  await act(async () => deleteItem.click());
  const confirm = document.body.querySelector(
    'button[data-slot="alert-dialog-action"]',
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  await vi.waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
  await act(async () => resolve());
  await settle();
  expect(replaceRoute).toHaveBeenCalledWith('/workspace');
  await view.unmount();
  wrapped.client.clear();
});

it('does not redirect if the user leaves the deleted chat while deletion is pending', async () => {
  let resolve!: () => void;
  window.history.replaceState({}, '', `/chats/${chatId}`);
  const api = {
    delete: vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <ChatDeleteDialog
      chatId={chatId}
      title="Current chat"
      client={api}
      scope={scope}
    />,
  );
  const view = await render(wrapped.node);
  await act(async () => view.container.querySelector('button')?.click());
  const confirm = document.body.querySelector(
    'button[data-slot="alert-dialog-action"]',
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  await vi.waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
  window.history.replaceState(
    {},
    '',
    '/chats/00000000-0000-4000-8000-000000000099',
  );
  await act(async () => resolve());
  await settle();
  expect(replaceRoute).not.toHaveBeenCalledWith('/workspace');
  await view.unmount();
  wrapped.client.clear();
});

it('does not restore deleted old-owner cache after a tenant transition races a delete refusal', async () => {
  let reject!: (error: Error) => void;
  const api = {
    delete: vi.fn(
      () =>
        new Promise<void>((_resolve, no) => {
          reject = no;
        }),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <ChatDeleteDialog
      chatId={chatId}
      title="Private chat"
      client={api}
      scope={scope}
    />,
  );
  wrapped.client.setQueryData(['identity'], {
    user: { id: scope.userId },
    organization: { id: scope.orgId },
  });
  const key = chatListQueryKey(scope, 6);
  wrapped.client.setQueryData(
    key,
    page([{ ...item(1, 'Private chat'), id: chatId }]),
  );
  const searchKey = chatSearchQueryKey(scope, 'private');
  wrapped.client.setQueryData(searchKey, {
    items: [
      {
        chatId,
        title: 'Private chat',
        messageId: null,
        excerpt: 'private search result',
        matchStart: 0,
        matchEnd: 7,
        updatedAt: '2026-11-13T09:00:00Z',
      },
    ],
    pageInfo: { nextCursor: null },
  });
  const view = await render(wrapped.node);
  await act(async () => view.container.querySelector('button')?.click());
  const confirm = document.body.querySelector(
    'button[data-slot="alert-dialog-action"]',
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  await vi.waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
  await transitionTenant(wrapped.client, {
    version: 1,
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Next organization',
    slug: 'next-org',
    kind: 'team',
    state: 'active',
    role: 'member',
    require2fa: false,
    createdAt: '2026-11-13T00:00:00Z',
  });
  await act(async () => reject(new Error('stale refusal')));
  await settle();
  expect(
    wrapped.client.getQueriesData({
      queryKey: ['tenant', scope.orgId, 'chat', scope.userId],
    }),
  ).toEqual([]);
  expect(wrapped.client.getQueryData(searchKey)).toBeUndefined();
  await view.unmount();
  wrapped.client.clear();
});

it('ignores a late rename success after the tenant scope changes', async () => {
  let resolve!: () => void;
  const api = {
    rename: vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    ),
  } as unknown as ChatApi;
  const saved = vi.fn();
  const wrapped = withQueryClient(
    <ChatRename
      chatId={chatId}
      title="Private title"
      client={api}
      scope={scope}
      onCancel={vi.fn()}
      onSaved={saved}
    />,
  );
  const view = await render(wrapped.node);
  const form = view.container.querySelector('form')!;
  await act(async () =>
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ),
  );
  await vi.waitFor(() => expect(api.rename).toHaveBeenCalledOnce());
  await transitionTenant(wrapped.client, {
    version: 1,
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Next organization',
    slug: 'next-org',
    kind: 'team',
    state: 'active',
    role: 'member',
    require2fa: false,
    createdAt: '2026-11-13T00:00:00Z',
  });
  await act(async () => resolve());
  expect(saved).not.toHaveBeenCalled();
  await view.unmount();
  wrapped.client.clear();
});

it('ignores a late delete success after the tenant scope changes', async () => {
  const originalUrl =
    window.location.pathname + window.location.search + window.location.hash;
  const originalPathState = pathState.current;
  pathState.current = `/chats/${chatId}`;
  window.history.replaceState({}, '', `/chats/${chatId}`);
  replaceRoute.mockClear();
  let resolve!: () => void;
  const api = {
    delete: vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    ),
  } as unknown as ChatApi;
  const onDeleted = vi.fn();
  const wrapped = withQueryClient(
    <ChatDeleteDialog
      chatId={chatId}
      title="Private chat"
      client={api}
      scope={scope}
      onDeleted={onDeleted}
    />,
  );
  const invalidateQueries = vi.spyOn(wrapped.client, 'invalidateQueries');
  const removeQueries = vi.spyOn(wrapped.client, 'removeQueries');
  const view = await render(wrapped.node);
  try {
    await act(async () => view.container.querySelector('button')?.click());
    const confirm = document.body.querySelector(
      'button[data-slot="alert-dialog-action"]',
    ) as HTMLButtonElement;
    await act(async () => confirm.click());
    await vi.waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
    await transitionTenant(wrapped.client, {
      version: 1,
      id: '00000000-0000-4000-8000-000000000004',
      name: 'Next organization',
      slug: 'next-org',
      kind: 'team',
      state: 'active',
      role: 'member',
      require2fa: false,
      createdAt: '2026-11-13T00:00:00Z',
    });
    invalidateQueries.mockClear();
    removeQueries.mockClear();
    await act(async () => resolve());
    await settle();

    expect(replaceRoute).not.toHaveBeenCalledWith('/workspace');
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(removeQueries).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    wrapped.client.clear();
    invalidateQueries.mockRestore();
    removeQueries.mockRestore();
    pathState.current = originalPathState;
    window.history.replaceState({}, '', originalUrl);
    replaceRoute.mockClear();
  }
});
