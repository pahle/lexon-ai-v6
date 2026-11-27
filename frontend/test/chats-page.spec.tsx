import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle, settleUntil } from './render';
import type { ChatPage } from '@lexon/contracts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/chats',
}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: {
      organization: { id: '00000000-0000-4000-8000-000000000001' },
      user: { id: '00000000-0000-4000-8000-000000000002' },
    },
  }),
}));
const list = vi.hoisted(() =>
  vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (input?: { cursor?: string; limit?: number; scope?: string }) => ({
      items: [] as ChatPage['items'],
      pageInfo: { nextCursor: null },
    }),
  ),
);
vi.mock('../src/lib/chat-client', () => ({
  createChatClient: () => ({
    list,
    search: vi.fn(),
    resolveSearchMatch: vi.fn(),
  }),
}));
import ChatsPage from '../src/app/(workspace)/chats/page';

const item = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Due diligence checklist',
  updatedAt: '2026-11-20T09:00:00.000Z',
  lastMessageAt: '2026-11-20T09:00:00.000Z',
  awaitingUser: false,
  ...over,
});

function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ChatsPage />
    </QueryClientProvider>,
  );
}

it('shows a serif Chats title with a primary New chat link beside it', async () => {
  list.mockResolvedValue({ items: [], pageInfo: { nextCursor: null } });
  const view = await mount();
  await settle();
  const heading = view.container.querySelector('h1');
  expect(heading?.textContent).toBe('Chats');
  expect(heading?.className).toContain('font-serif');
  const link = [...view.container.querySelectorAll('a')].find(
    (a) => a.textContent?.trim() === 'New chat',
  );
  expect(link?.getAttribute('href')).toBe('/workspace');
  expect(link?.className).toContain('bg-primary');
  expect(heading?.parentElement).toBe(link?.closest('header'));
  await view.unmount();
});

it('the Shared with me tab queries scope=shared and rows name the sharer', async () => {
  list.mockImplementation(async (input?: { scope?: string }) => ({
    items:
      input?.scope === 'shared'
        ? [
            item({
              ownerName: 'Andi Wijaya',
              updatedAt: '2026-11-19T09:00:00.000Z',
            }),
          ]
        : [item()],
    pageInfo: { nextCursor: null },
  }));
  const view = await mount();
  await settleUntil(() =>
    view.container.textContent!.includes('Due diligence checklist'),
  );
  const sharedTab = [...view.container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Shared with me',
  );
  expect(sharedTab).toBeDefined();
  sharedTab!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
  await settleUntil(() =>
    view.container.textContent!.includes('Shared by Andi Wijaya'),
  );
  expect(list.mock.calls.some(([input]) => input?.scope === 'shared')).toBe(
    true,
  );
  // Shared rows carry no owner-only row menu.
  expect(
    view.container.querySelector('[aria-label^="Chat actions for"]'),
  ).toBeNull();
  await view.unmount();
});

it('project chats on the All tab carry the matter name as secondary text', async () => {
  list.mockResolvedValue({
    items: [
      item({
        title: 'Klausul perpanjangan sewa',
        projectName: 'Kontrak sewa ruko Tebet',
      }),
    ],
    pageInfo: { nextCursor: null },
  });
  const view = await mount();
  await settleUntil(() =>
    view.container.textContent!.includes('Klausul perpanjangan sewa'),
  );
  expect(view.container.textContent).toContain('Kontrak sewa ruko Tebet');
  await view.unmount();
});
