import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle } from './render';

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
vi.mock('../src/lib/chat-client', () => ({
  createChatClient: () => ({
    list: vi.fn(async () => ({ items: [], pageInfo: { nextCursor: null } })),
    search: vi.fn(),
    resolveSearchMatch: vi.fn(),
  }),
}));
import ChatsPage from '../src/app/(workspace)/chats/page';

it('shows a serif Chats title with a primary New chat link beside it', async () => {
  const view = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ChatsPage />
    </QueryClientProvider>,
  );
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
