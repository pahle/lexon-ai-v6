import { expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatApi, ChatPage } from '@lexon/contracts';
import { ChatHistory, RecentChats } from '../src/components/chat/chat-history';
import { ChatRenameDialog } from '../src/components/chat/chat-rename-dialog';
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
const renameDialog = () =>
  document.body.querySelector<HTMLElement>('[role="dialog"]');
const renameInput = () =>
  renameDialog()?.querySelector<HTMLInputElement>('input') ?? null;
const renameForm = () =>
  renameDialog()?.querySelector<HTMLFormElement>('form') ?? null;
async function typeTitle(value: string) {
  const input = renameInput()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submitRename() {
  await act(async () =>
    renameForm()!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ),
  );
}
async function pressEscape() {
  await act(async () =>
    renameInput()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  await settle();
}
const dialogButton = (label: string) =>
  [...(renameDialog()?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent === label,
  );
function openChat(title = 'Old title') {
  return { id: chatId, title };
}
function renameDialogNode(
  api: ChatApi,
  props: {
    title?: string;
    onOpenChange?: (open: boolean) => void;
    onSaved?: (title: string) => void;
  } = {},
) {
  return (
    <ChatRenameDialog
      chat={openChat(props.title)}
      client={api}
      scope={scope}
      open
      onOpenChange={props.onOpenChange ?? vi.fn()}
      onSaved={props.onSaved ?? vi.fn()}
    />
  );
}
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
    awaitingUser: false,
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

it('groups chat history into Today, Yesterday, previous 7 and 30 days, then month-year', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const items = [
    ['Today chat', '2026-11-13T09:00:00.000Z'],
    ['Yesterday chat', '2026-11-12T09:00:00.000Z'],
    ['Previous week chat', '2026-11-10T09:00:00.000Z'],
    ['Last month chat', '2026-10-25T09:00:00.000Z'],
    ['Older chat', '2026-10-02T09:00:00.000Z'],
  ].map(([title, updatedAt], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    title: title!,
    updatedAt: updatedAt!,
    lastMessageAt: updatedAt!,
    awaitingUser: false,
  }));
  expect(groupChatsByDate(items, now).map((group) => group.label)).toEqual([
    'Today',
    'Yesterday',
    'Previous 7 days',
    'Previous 30 days',
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

it('gives the Recent chat actions button a 24 px target', async () => {
  const api = {
    list: vi.fn(async () => page([item(1, 'Target size row')])),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(<RecentChats client={api} scope={scope} />);
  const view = await render(wrapped.node);
  try {
    await settle();
    const opener = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Chat actions for Target size row"]',
    )!;
    // WCAG 2.2 target size (minimum): 24 by 24 CSS pixels.
    expect(opener.className).toContain('size-6');
    expect(opener.className).not.toMatch(/(^|\s)w-5(\s|$)/);
  } finally {
    await view.unmount();
  }
});

it('shows the menu button on the open chat row only; the others reveal it on hover or focus', async () => {
  const api = {
    list: vi.fn(async () =>
      page([{ ...item(1, 'Open row'), id: chatId }, item(2, 'Other row')]),
    ),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    <RecentChats client={api} scope={scope} currentChatId={chatId} />,
  );
  const view = await render(wrapped.node);
  try {
    await settle();
    const open = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Chat actions for Open row"]',
    )!;
    const other = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Chat actions for Other row"]',
    )!;
    expect(open.className).toContain('md:opacity-100');
    expect(open.className).not.toContain('max-md:opacity-0');
    expect(other.className).toContain('max-md:opacity-0');
    expect(other.className).toContain('md:opacity-0');
    expect(other.className).toContain(
      'group-focus-within/menu-item:opacity-100',
    );
    expect(other.className).toContain('group-hover/menu-item:opacity-100');
  } finally {
    await view.unmount();
  }
});

it('renames a Recent chat in a dialog and keeps the row title link in place', async () => {
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
  const opener = () =>
    row().querySelector<HTMLButtonElement>(
      '[aria-label="Chat actions for Original recent title"]',
    )!;
  const startRename = async () => {
    await act(async () => opener().click());
    await act(async () =>
      (
        document.body.querySelector(
          '[data-slot="dropdown-menu-item"]',
        ) as HTMLElement
      ).click(),
    );
    await settle();
  };

  expect(titleLink()?.textContent).toBe('Original recent title');
  await startRename();
  expect(titleLink()?.textContent).toBe('Original recent title');
  expect(renameDialog()?.textContent).toContain('Rename chat');
  expect(renameInput()!.labels?.[0]?.textContent).toBe('Chat title');
  expect(renameInput()!.value).toBe('Original recent title');
  expect(row().querySelector('input')).toBeNull();
  await pressEscape();
  expect(renameDialog()).toBeNull();
  expect(api.rename).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(opener());

  await startRename();
  await typeTitle('Saved recent title');
  await submitRename();
  await settle();
  expect(api.rename).toHaveBeenCalledWith(chatId, {
    title: 'Saved recent title',
  });
  expect(renameDialog()).toBeNull();
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
    { limit: 20, scope: 'own', cursor: 'next' },
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

it('trims a renamed title and keeps the dialog open and actionable after a failed save', async () => {
  const saved = vi.fn();
  const onOpenChange = vi.fn();
  const api = {
    rename: vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    renameDialogNode(api, { onOpenChange, onSaved: saved }),
  );
  const view = await render(wrapped.node);
  await settle();
  expect(dialogButton('Save')).toBeDefined();
  expect(dialogButton('Cancel')).toBeDefined();
  await typeTitle('  New title  ');
  await submitRename();
  expect(renameDialog()?.textContent).toContain('The title could not be saved');
  expect(renameInput()!.value).toBe('  New title  ');
  expect(onOpenChange).not.toHaveBeenCalled();
  await submitRename();
  expect(api.rename).toHaveBeenLastCalledWith(chatId, { title: 'New title' });
  expect(saved).toHaveBeenCalledWith('New title');
  expect(onOpenChange).toHaveBeenCalledWith(false);
  await view.unmount();
  wrapped.client.clear();
});

it('opens the rename dialog titled Rename chat with a prefilled, selected Chat title field', async () => {
  const wrapped = withQueryClient(
    renameDialogNode({ rename: vi.fn() } as unknown as ChatApi),
  );
  const view = await render(wrapped.node);
  await settle();
  expect(
    renameDialog()?.querySelector('[data-slot="dialog-title"]')?.textContent,
  ).toBe('Rename chat');
  const input = renameInput()!;
  expect(input.labels?.[0]?.textContent).toBe('Chat title');
  expect(input.value).toBe('Old title');
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 9]);
  await view.unmount();
  wrapped.client.clear();
});

it('saves the rename dialog from the Save button and closes it', async () => {
  const onOpenChange = vi.fn();
  const saved = vi.fn();
  const api = {
    rename: vi.fn(async () => undefined),
  } as unknown as ChatApi;
  const wrapped = withQueryClient(
    renameDialogNode(api, { onOpenChange, onSaved: saved }),
  );
  const view = await render(wrapped.node);
  await settle();
  await typeTitle('Via save');
  expect(dialogButton('Save')!.type).toBe('submit');
  await submitRename();
  expect(api.rename).toHaveBeenCalledWith(chatId, { title: 'Via save' });
  expect(saved).toHaveBeenCalledWith('Via save');
  expect(onOpenChange).toHaveBeenCalledWith(false);
  await view.unmount();
  wrapped.client.clear();
});

it('closes the rename dialog with Escape or Cancel without calling the API', async () => {
  const onOpenChange = vi.fn();
  const api = { rename: vi.fn() } as unknown as ChatApi;
  const wrapped = withQueryClient(renameDialogNode(api, { onOpenChange }));
  const view = await render(wrapped.node);
  await settle();
  await pressEscape();
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  onOpenChange.mockClear();
  await act(async () => dialogButton('Cancel')!.click());
  await settle();
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(api.rename).not.toHaveBeenCalled();
  await view.unmount();
  wrapped.client.clear();
});

it('rejects an empty or whitespace-only title without calling the API', async () => {
  const api = { rename: vi.fn() } as unknown as ChatApi;
  const wrapped = withQueryClient(renameDialogNode(api));
  const view = await render(wrapped.node);
  await settle();
  await typeTitle('   ');
  await submitRename();
  expect(api.rename).not.toHaveBeenCalled();
  expect(renameDialog()?.textContent).toContain('Enter a chat title');
  await view.unmount();
  wrapped.client.clear();
});

it('prevents saving titles longer than 120 Unicode characters', async () => {
  const api = { rename: vi.fn() } as unknown as ChatApi;
  const wrapped = withQueryClient(renameDialogNode(api, { title: 'Old' }));
  const view = await render(wrapped.node);
  await settle();
  await typeTitle('😀'.repeat(121));
  expect(renameDialog()?.textContent).toContain('120 characters or fewer');
  await submitRename();
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
  expect(confirm.classList.contains('bg-(--lexon-destructive-fill)')).toBe(
    true,
  );
  expect(confirm.classList.contains('text-white')).toBe(true);
  expect(confirm.classList.contains('bg-destructive/10')).toBe(false);
  await view.unmount();
  wrapped.client.clear();
});

it('states that the chat and all its messages are permanently deleted', async () => {
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

  expect(
    document.body.querySelector('[data-slot="alert-dialog-description"]')
      ?.textContent,
  ).toBe(
    '“Private chat” and all its messages will be permanently deleted. This cannot be undone.',
  );
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
      [
        ...document.body.querySelectorAll<HTMLElement>(
          '[data-slot="dropdown-menu-item"]',
        ),
      ].find((item) => item.textContent?.trim() === 'Delete') as HTMLElement
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
    renameDialogNode(api, { title: 'Private title', onSaved: saved }),
  );
  const view = await render(wrapped.node);
  await settle();
  await submitRename();
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

it('hides View all chats in Recent when there are no chats and shows it otherwise', async () => {
  const link = <a href="/chats">View all chats</a>;
  const empty = withQueryClient(
    <RecentChats
      client={{ list: vi.fn(async () => page([])) } as unknown as ChatApi}
      scope={scope}
      viewAll={link}
    />,
  );
  const emptyView = await render(empty.node);
  await settle();
  expect(emptyView.container.textContent).toContain('No chats yet.');
  expect(emptyView.container.textContent).not.toContain('View all chats');
  await emptyView.unmount();
  const full = withQueryClient(
    <RecentChats
      client={
        { list: vi.fn(async () => page([item(1)])) } as unknown as ChatApi
      }
      scope={scope}
      viewAll={link}
    />,
  );
  const fullView = await render(full.node);
  await settle();
  expect(fullView.container.textContent).toContain('View all chats');
  await fullView.unmount();
});
