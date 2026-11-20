import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatApi, ChatPage } from '@lexon/contracts';
import { ChatHistory, RecentChats } from '../src/components/chat/chat-history';
import { SidebarProvider } from '../src/components/ui/sidebar';
import { render, settle } from './render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
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

const scope = { orgId: 'org-1', userId: 'user-1' };
const row = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Acquisition review',
  updatedAt: '2026-11-13T09:00:00.000Z',
  lastMessageAt: '2026-11-13T09:00:00.000Z',
};
const okPage: ChatPage = { items: [row], pageInfo: { nextCursor: null } };

function tree(api: ChatApi, nodes: 'both' | 'chats' | 'recent' = 'both') {
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
      <SidebarProvider>
        {nodes !== 'recent' ? (
          <div data-testid="chats">
            <ChatHistory client={api} scope={scope} />
          </div>
        ) : null}
        {nodes !== 'chats' ? (
          <div data-testid="recent">
            <RecentChats client={api} scope={scope} />
          </div>
        ) : null}
      </SidebarProvider>
    </QueryClientProvider>
  );
}

const region = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const tryAgain = (el: HTMLElement) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Try again');

it('Chats: a failed fetch shows the failure row with Try again, never Empty', async () => {
  const api = {
    list: vi.fn().mockRejectedValue(new Error('x')),
  } as unknown as ChatApi;
  const view = await render(tree(api, 'chats'));
  await settle();
  const chats = region(view.container, 'chats');
  const alert = chats.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain('We could not load your chats.');
  expect(tryAgain(chats)).toBeDefined();
  expect(chats.textContent).not.toContain('No chats yet');
  await view.unmount();
});

it('Chats: Try again refetches and the list renders', async () => {
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error('x'))
    .mockResolvedValue(okPage);
  const view = await render(tree({ list } as unknown as ChatApi, 'chats'));
  await settle();
  await act(async () => tryAgain(region(view.container, 'chats'))!.click());
  await settle();
  expect(region(view.container, 'chats').textContent).toContain(
    'Acquisition review',
  );
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  await view.unmount();
});

it('Recent: a failed fetch shows the inline line with Try again, never "No chats yet."', async () => {
  const api = {
    list: vi.fn().mockRejectedValue(new Error('x')),
  } as unknown as ChatApi;
  const view = await render(tree(api, 'recent'));
  await settle();
  const recent = region(view.container, 'recent');
  const line = recent.querySelector('[role="alert"]')!;
  expect(line.textContent).toContain('We could not load recent chats.');
  expect(line.className).toContain('text-[13px]');
  expect(line.className).toContain('leading-[1.5]');
  expect(line.className).toContain('px-2');
  expect(line.className).toContain('py-1');
  expect(tryAgain(recent)).toBeDefined();
  expect(recent.textContent).not.toContain('No chats yet');
  await view.unmount();
});

it('Recent: Try again refetches and the list renders', async () => {
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error('x'))
    .mockResolvedValue(okPage);
  const view = await render(tree({ list } as unknown as ChatApi, 'recent'));
  await settle();
  await act(async () => tryAgain(region(view.container, 'recent'))!.click());
  await settle();
  expect(region(view.container, 'recent').textContent).toContain(
    'Acquisition review',
  );
  await view.unmount();
});

it('Recent fails while Chats succeeds → only Recent shows the failure', async () => {
  const list = vi.fn(async (input?: { limit?: number }) => {
    if (input?.limit === 6) throw new Error('recent down');
    return okPage;
  });
  const view = await render(tree({ list } as unknown as ChatApi));
  await settle();
  expect(region(view.container, 'recent').textContent).toContain(
    'We could not load recent chats.',
  );
  expect(region(view.container, 'chats').textContent).toContain(
    'Acquisition review',
  );
  expect(
    region(view.container, 'chats').querySelector('[role="alert"]'),
  ).toBeNull();
  await view.unmount();
});

it('Chats fails while Recent succeeds → only Chats shows the failure', async () => {
  const list = vi.fn(async (input?: { limit?: number }) => {
    if (input?.limit === 20) throw new Error('chats down');
    return okPage;
  });
  const view = await render(tree({ list } as unknown as ChatApi));
  await settle();
  expect(region(view.container, 'chats').textContent).toContain(
    'We could not load your chats.',
  );
  expect(region(view.container, 'recent').textContent).toContain(
    'Acquisition review',
  );
  expect(
    region(view.container, 'recent').querySelector('[role="alert"]'),
  ).toBeNull();
  await view.unmount();
});

it('Recent: the failure line replaces the whole list, including View all chats', async () => {
  const api = {
    list: vi.fn().mockRejectedValue(new Error('x')),
  } as unknown as ChatApi;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <RecentChats
          client={api}
          scope={scope}
          viewAll={<a href="/chats">View all chats</a>}
        />
      </SidebarProvider>
    </QueryClientProvider>,
  );
  await settle();
  expect(view.container.textContent).toContain(
    'We could not load recent chats.',
  );
  expect(view.container.textContent).not.toContain('View all chats');
  await view.unmount();
});
