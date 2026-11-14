import { act } from 'react';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatApi, ChatPage, ChatSearchPage } from '@lexon/contracts';
import { ChatSearch } from '../src/components/chat/chat-search';
import { ChatHistory } from '../src/components/chat/chat-history';
import { render, settle } from './render';
import { navigateToSearchMatch } from '../src/lib/chat-search-navigation';
import type { ChatQueryScope } from '../src/lib/chat-queries';

const scope: ChatQueryScope = {
  orgId: 'org-id',
  userId: 'user-id',
};
const replaceRoute = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceRoute, push: vi.fn() }),
  usePathname: () => '/workspace',
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function page(title: string): ChatSearchPage {
  return {
    items: [
      {
        chatId: '00000000-0000-4000-8000-000000000003',
        title,
        messageId: null,
        excerpt: '',
        matchStart: null,
        matchEnd: null,
        updatedAt: '2026-11-13T10:00:00Z',
      },
    ],
    pageInfo: { nextCursor: null },
  };
}

async function renderSearch(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(['identity'], {
    user: { id: scope.userId },
    organization: { id: scope.orgId },
  });
  queryClient.setQueryData(['active-organization'], { id: scope.orgId });
  const wrap = (child: ReactNode) => (
    <QueryClientProvider client={queryClient}>{child}</QueryClientProvider>
  );
  const view = await render(wrap(node));
  return {
    ...view,
    queryClient,
    async rerender(next: ReactNode) {
      await view.rerender(wrap(next));
    },
    async unmount() {
      await view.unmount();
      queryClient.clear();
    },
  };
}

async function setSearchTerm(container: HTMLElement, term: string) {
  const input = container.querySelector('input[aria-label="Search chats"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, term);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submitSearch(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

it('runs search only on submit and shows loading until the submitted search resolves', async () => {
  const request = deferred<ChatSearchPage>();
  const client = { search: vi.fn(() => request.promise) } as unknown as ChatApi;
  const view = await renderSearch(
    <ChatSearch client={client} scope={scope} scopeKey="org:user" />,
  );
  await setSearchTerm(view.container, 'wanprestasi');
  expect(client.search).not.toHaveBeenCalled();
  await submitSearch(view.container);
  expect(client.search).toHaveBeenCalledWith(
    { query: 'wanprestasi' },
    expect.any(AbortSignal),
  );
  expect(view.container.textContent).toContain('Searching chats');
  await act(async () => request.resolve(page('Breach of contract')));
  expect(view.container.textContent).toContain('Breach of contract');
  expect(view.container.textContent).not.toContain('Searching chats');
  await view.unmount();
});

it('ignores older search results and errors after a newer submitted query', async () => {
  const first = deferred<ChatSearchPage>();
  const second = deferred<ChatSearchPage>();
  const client = {
    search: vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  } as unknown as ChatApi;
  const view = await renderSearch(
    <ChatSearch client={client} scope={scope} scopeKey="org:user" />,
  );
  await setSearchTerm(view.container, 'old');
  await submitSearch(view.container);
  await setSearchTerm(view.container, 'new');
  await submitSearch(view.container);
  await act(async () => second.resolve(page('New result')));
  expect(view.container.textContent).toContain('New result');
  await act(async () => first.reject(new Error('stale failure')));
  expect(view.container.textContent).toContain('New result');
  expect(view.container.textContent).not.toContain('stale failure');
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  await view.unmount();
});

it('does not let an older same-query submission replace the latest result', async () => {
  const first = deferred<ChatSearchPage>();
  const second = deferred<ChatSearchPage>();
  const client = {
    search: vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  } as unknown as ChatApi;
  const view = await renderSearch(
    <ChatSearch client={client} scope={scope} scopeKey="org:user" />,
  );
  await setSearchTerm(view.container, 'same query');
  await submitSearch(view.container);
  await submitSearch(view.container);
  await act(async () => second.resolve(page('Latest same-query result')));
  expect(view.container.textContent).toContain('Latest same-query result');

  await act(async () => first.resolve(page('Older same-query result')));

  expect(view.container.textContent).toContain('Latest same-query result');
  expect(view.container.textContent).not.toContain('Older same-query result');
  await view.unmount();
});

it('drops completed search results as soon as the owner scope changes', async () => {
  const client = {
    search: vi.fn().mockResolvedValue(page('Private prior owner result')),
  } as unknown as ChatApi;
  const view = await renderSearch(
    <ChatSearch
      client={client}
      scope={{ orgId: 'org-a', userId: 'user-a' }}
      scopeKey="org-a:user-a"
    />,
  );
  await setSearchTerm(view.container, 'private query');
  await submitSearch(view.container);
  await act(async () => Promise.resolve());
  expect(view.container.textContent).toContain('Private prior owner result');
  await view.rerender(
    <ChatSearch
      client={client}
      scope={{ orgId: 'org-b', userId: 'user-a' }}
      scopeKey="org-b:user-a"
    />,
  );
  expect(view.container.textContent).not.toContain(
    'Private prior owner result',
  );
  expect(view.container.textContent).not.toContain('private query');
  expect(
    view.container.querySelector('input[aria-label="Search chats"]'),
  ).toHaveProperty('value', '');
  await view.unmount();
});

it('does not open or highlight a search match when its owner scope expires during resolve', async () => {
  let finish!: (value: { messageId: string }) => void;
  let scopeCurrent = true;
  const resolve = vi.fn(
    () =>
      new Promise<{ messageId: string }>((done) => {
        finish = done;
      }),
  );
  const remember = vi.fn();
  const navigate = vi.fn();
  const opening = navigateToSearchMatch({
    chatId: '00000000-0000-4000-8000-000000000003',
    messageId: '00000000-0000-4000-8000-000000000004',
    resolve,
    remember,
    isCurrent: () => scopeCurrent,
    navigate,
  });
  expect(resolve).toHaveBeenCalledOnce();
  scopeCurrent = false;
  finish({ messageId: '00000000-0000-4000-8000-000000000004' });
  await opening;
  expect(remember).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

it('shows an Empty no-results state and Clear removes the search without another request', async () => {
  const client = {
    search: vi
      .fn()
      .mockResolvedValue({ items: [], pageInfo: { nextCursor: null } }),
  } as unknown as ChatApi;
  const active = vi.fn();
  const view = await renderSearch(
    <ChatSearch
      client={client}
      scope={scope}
      scopeKey="org:user"
      onActiveSearchChange={active}
    />,
  );
  await setSearchTerm(view.container, 'no matching chats');
  await submitSearch(view.container);
  expect(
    view.container.querySelector('[data-slot="empty-title"]')?.textContent,
  ).toBe('No chats match “no matching chats”');
  expect(view.container.textContent).toContain(
    'Search looks in chat titles and messages. Try other words.',
  );
  await act(async () =>
    [...view.container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Clear search')
      ?.click(),
  );
  expect(client.search).toHaveBeenCalledOnce();
  expect(view.container.textContent).not.toContain('No chats match');
  expect(view.container.querySelector('input')?.value).toBe('');
  expect(active).toHaveBeenLastCalledWith(false);
  await view.unmount();
});

it('keeps the search empty after an in-flight result and rejection arrive after an empty submission', async () => {
  const resultRequest = deferred<ChatSearchPage>();
  const errorRequest = deferred<ChatSearchPage>();
  const client = {
    search: vi
      .fn()
      .mockReturnValueOnce(resultRequest.promise)
      .mockReturnValueOnce(errorRequest.promise),
  } as unknown as ChatApi;
  const view = await renderSearch(
    <ChatSearch client={client} scope={scope} scopeKey="org:user" />,
  );
  const submitEmptySearch = async () => {
    await setSearchTerm(view.container, '');
    await submitSearch(view.container);
  };

  await setSearchTerm(view.container, 'clear before result');
  await submitSearch(view.container);
  await submitEmptySearch();
  expect(
    view.container.querySelector('input[aria-label="Search chats"]'),
  ).toHaveProperty('value', '');
  await act(async () => resultRequest.resolve(page('Late result after clear')));
  expect(view.container.textContent).not.toContain('Late result after clear');
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  expect(
    view.container.querySelector('input[aria-label="Search chats"]'),
  ).toHaveProperty('value', '');

  await setSearchTerm(view.container, 'clear before rejection');
  await submitSearch(view.container);
  await submitEmptySearch();
  await act(async () =>
    errorRequest.reject(new Error('Late error after clear')),
  );

  expect(view.container.textContent).not.toContain('Late error after clear');
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  expect(
    view.container.querySelector('input[aria-label="Search chats"]'),
  ).toHaveProperty('value', '');
  expect(view.container.textContent).not.toContain('Searching chats');
  await view.unmount();
});

it('styles matched text with theme tokens', async () => {
  const result = page('Contract review');
  result.items[0]!.excerpt =
    'Remedies for wanprestasi may include termination.';
  result.items[0]!.matchStart = 13;
  result.items[0]!.matchEnd = 24;
  const client = {
    search: vi.fn().mockResolvedValue(result),
  } as unknown as ChatApi;
  const view = await renderSearch(
    <ChatSearch client={client} scope={scope} scopeKey="org:user" />,
  );
  await setSearchTerm(view.container, 'wanprestasi');
  await submitSearch(view.container);
  const mark = view.container.querySelector('mark');
  expect(mark?.textContent).toBe('wanprestasi');
  expect(mark?.className).toContain('bg-primary/20');
  expect(mark?.className).toContain('text-foreground');
  await view.unmount();
});

it('loads ranked search pages with the cursor, deduplicates matches, and ignores an expired page', async () => {
  const firstPage = page('First result');
  firstPage.pageInfo.nextCursor = 'cursor-one';
  const latePage = page('Duplicate first result');
  latePage.items[0]!.excerpt = 'Duplicate result for a different message';
  const nextChatPage = {
    items: [
      ...latePage.items,
      {
        ...latePage.items[0]!,
        chatId: '00000000-0000-4000-8000-000000000004',
        messageId: '00000000-0000-4000-8000-000000000005',
        title: 'Second result',
      },
    ],
    pageInfo: { nextCursor: 'cursor-two' },
  };
  let finishExpiredPage!: (value: ChatSearchPage) => void;
  const client = {
    search: vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(nextChatPage)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            finishExpiredPage = done;
          }),
      )
      .mockResolvedValueOnce(page('New query result')),
  } as unknown as ChatApi;
  const view = await renderSearch(
    <ChatSearch client={client} scope={scope} scopeKey="org:user" />,
  );
  await setSearchTerm(view.container, 'first query');
  await submitSearch(view.container);
  await act(async () => Promise.resolve());
  await act(async () => {
    [...view.container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Load more results')
      ?.click();
  });
  expect(client.search).toHaveBeenNthCalledWith(
    2,
    { query: 'first query', cursor: 'cursor-one' },
    expect.any(AbortSignal),
  );
  await act(async () => Promise.resolve());
  expect(view.container.textContent).toContain('Second result');
  expect(view.container.textContent).not.toContain('Duplicate first result');
  expect(view.container.querySelectorAll('ul button')).toHaveLength(2);
  await act(async () => {
    [...view.container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Load more results')
      ?.click();
  });
  expect(client.search).toHaveBeenNthCalledWith(
    3,
    { query: 'first query', cursor: 'cursor-two' },
    expect.any(AbortSignal),
  );
  await setSearchTerm(view.container, 'new query');
  await submitSearch(view.container);
  await act(async () => Promise.resolve());
  await act(async () => finishExpiredPage(nextChatPage));
  expect(view.container.textContent).toContain('New query result');
  expect(view.container.textContent).not.toContain('Second result');
  expect(view.container.textContent).not.toContain('Duplicate first result');
  await view.unmount();
});

it('keeps submitted search results in sync with sidebar rename, delete rollback, and accepted delete', async () => {
  const chatId = '00000000-0000-4000-8000-000000000003';
  let title = 'Searchable chat';
  let rejectFirstDelete!: (error: Error) => void;
  let deleteCalls = 0;
  let deleted = false;
  const listPage: ChatPage = {
    items: [
      {
        id: chatId,
        title,
        updatedAt: '2026-11-13T10:00:00Z',
        lastMessageAt: '2026-11-13T10:00:00Z',
      },
    ],
    pageInfo: { nextCursor: null },
  };
  const client = {
    search: vi.fn().mockResolvedValue(page(title)),
    list: vi.fn(async () => ({
      ...listPage,
      items: deleted ? [] : [{ ...listPage.items[0]!, title }],
    })),
    rename: vi.fn(async (_id: string, input: { title: string }) => {
      title = input.title;
    }),
    delete: vi.fn(() => {
      deleteCalls += 1;
      return deleteCalls === 1
        ? new Promise<void>((_resolve, reject) => {
            rejectFirstDelete = reject;
          })
        : ((deleted = true), Promise.resolve());
    }),
  } as unknown as ChatApi;
  const view = await renderSearch(
    <>
      <ChatSearch client={client} scope={scope} scopeKey="org:user" />
      <ChatHistory client={client} scope={scope} />
    </>,
  );
  await setSearchTerm(view.container, 'query');
  await submitSearch(view.container);
  expect(view.container.textContent).toContain('Searchable chat');

  const openActions = async () => {
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>(
          `button[aria-label="Chat actions for ${title}"]`,
        )
        ?.click(),
    );
    await settle();
  };
  await openActions();
  await act(async () =>
    [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((menuitem) => menuitem.textContent?.includes('Rename'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  const renameInput = view.container.querySelector(
    'input[aria-label="Chat title"]',
  ) as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!;
  await act(async () => {
    setValue.call(renameInput, 'Updated search title');
    renameInput.dispatchEvent(new Event('input', { bubbles: true }));
    renameInput
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  expect(view.container.textContent).toContain('Updated search title');
  expect(view.container.textContent).not.toContain('Searchable chat');

  await openActions();
  await act(async () =>
    [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((menuitem) => menuitem.textContent?.includes('Delete'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  const confirm = document.body.querySelector(
    'button[data-slot="alert-dialog-action"]',
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  await vi.waitFor(() => expect(client.delete).toHaveBeenCalledOnce());
  await settle();
  expect(view.container.textContent).not.toContain('Updated search title');
  await act(async () => rejectFirstDelete(new Error('offline')));
  await settle();
  expect(view.container.textContent).toContain('Updated search title');

  await openActions();
  await act(async () =>
    [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((menuitem) => menuitem.textContent?.includes('Delete'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  await act(async () =>
    (
      document.body.querySelector(
        'button[data-slot="alert-dialog-action"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await settle();
  expect(view.container.textContent).not.toContain('Updated search title');
  await view.unmount();
});

it('clear and tenant change suppress late completions and errors', async () => {
  const first = deferred<ChatSearchPage>();
  const second = deferred<ChatSearchPage>();
  const client = {
    search: vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  } as unknown as ChatApi;
  const active = vi.fn();
  const view = await renderSearch(
    <ChatSearch
      client={client}
      scope={{ orgId: 'org-a', userId: 'user-a' }}
      scopeKey="org-a:user"
      onActiveSearchChange={active}
    />,
  );
  await setSearchTerm(view.container, 'old owner query');
  await submitSearch(view.container);
  await view.rerender(
    <ChatSearch
      client={client}
      scope={{ orgId: 'org-b', userId: 'user-a' }}
      scopeKey="org-b:user"
      onActiveSearchChange={active}
    />,
  );
  await setSearchTerm(view.container, 'new owner query');
  await submitSearch(view.container);
  await act(async () => second.resolve(page('Current owner result')));
  await act(async () => first.reject(new Error('expired owner error')));
  expect(view.container.textContent).toContain('Current owner result');
  expect(view.container.textContent).not.toContain('expired owner error');
  await setSearchTerm(view.container, '');
  await submitSearch(view.container);
  await act(async () => first.reject(new Error('cleared stale error')));
  expect(view.container.textContent).not.toContain('cleared stale error');
  expect(active).toHaveBeenLastCalledWith(false);
  await view.unmount();
});

it('renders matched excerpt text literally and marks only the returned range', async () => {
  const client = {
    search: vi.fn().mockResolvedValue({
      items: [
        {
          chatId: '00000000-0000-4000-8000-000000000003',
          title: 'Employment agreement',
          messageId: null,
          excerpt: '<script>wanprestasi</script>',
          matchStart: 8,
          matchEnd: 19,
          updatedAt: '2026-11-13T10:00:00Z',
        },
      ],
      pageInfo: { nextCursor: null },
    }),
  } as unknown as ChatApi;
  const view = await renderSearch(
    <ChatSearch client={client} scope={scope} scopeKey="org:user" />,
  );
  await setSearchTerm(view.container, 'wanprestasi');
  await submitSearch(view.container);
  expect(view.container.querySelector('script')).toBeNull();
  expect(view.container.textContent).toContain('<script>wanprestasi</script>');
  expect(view.container.querySelector('mark')?.textContent).toBe('wanprestasi');
  await view.unmount();
});

it('resolves and persists a message branch before navigation; title-only results keep the branch', async () => {
  const resolve = vi
    .fn()
    .mockResolvedValue({ messageId: '00000000-0000-4000-8000-000000000004' });
  const remember = vi.fn();
  const navigate = vi.fn();
  await navigateToSearchMatch({
    chatId: '00000000-0000-4000-8000-000000000003',
    messageId: '00000000-0000-4000-8000-000000000004',
    resolve,
    remember,
    isCurrent: () => true,
    navigate,
  });
  expect(resolve).toHaveBeenCalledBefore(remember);
  expect(remember).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledOnce();
  resolve.mockClear();
  remember.mockClear();
  navigate.mockClear();
  await navigateToSearchMatch({
    chatId: '00000000-0000-4000-8000-000000000003',
    messageId: null,
    resolve,
    remember,
    isCurrent: () => true,
    navigate,
  });
  expect(resolve).not.toHaveBeenCalled();
  expect(remember).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledOnce();
});
