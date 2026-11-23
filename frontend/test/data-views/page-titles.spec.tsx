import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataListPage, RecordHeader } from '../../src/components/data-views';
import { render, settle } from '../render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/chats',
}));
vi.mock('../../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: {
      organization: { id: '00000000-0000-4000-8000-000000000001' },
      user: { id: '00000000-0000-4000-8000-000000000002' },
    },
  }),
}));
vi.mock('../../src/lib/chat-client', () => ({
  createChatClient: () => ({
    list: vi.fn(async () => ({ items: [], pageInfo: { nextCursor: null } })),
    search: vi.fn(),
    resolveSearchMatch: vi.fn(),
  }),
}));
import ChatsPage from '../../src/app/(workspace)/chats/page';

afterEach(() => {
  document.body.innerHTML = '';
});

const tokens = (el: Element | null) =>
  new Set((el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));

async function chatsTitleTokens() {
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
  const set = tokens(view.container.querySelector('h1'));
  // The Chats heading is a focus target after navigation; that is not style.
  set.delete('outline-none');
  return set;
}

it('the list page title uses the same display title classes as the Chats title (LEX-DS-001 §3)', async () => {
  const chats = await chatsTitleTokens();
  expect([...chats]).toEqual(
    expect.arrayContaining([
      'font-serif',
      'text-[32px]',
      'leading-[normal]',
      'font-normal',
      'tracking-[-0.005em]',
    ]),
  );
  document.body.innerHTML = '';
  const view = await render(
    <DataListPage title="Accounts">
      <p>body</p>
    </DataListPage>,
  );
  const list = tokens(view.container.querySelector('h1'));
  expect([...list].sort()).toEqual([...chats].sort());
});

it('the record title uses the display face: 30px, 26px on mobile (LEX-DS-001 §5.7)', async () => {
  const view = await render(
    <RecordHeader
      backHref="/platform/accounts"
      backLabel="Accounts"
      initials="RK"
      title="Rina Kusuma"
    />,
  );
  const title = tokens(view.container.querySelector('h1'));
  expect([...title]).toEqual(
    expect.arrayContaining([
      'font-serif',
      'font-normal',
      'tracking-[-0.005em]',
      'text-[26px]',
      'leading-[1.15]',
      'md:text-[30px]',
    ]),
  );
  expect(title.has('font-semibold')).toBe(false);
});

it('the record avatar is 48px / 16px below md and 56px / 18px from md (LEX-DS-001 §5.7)', async () => {
  for (const square of [false, true]) {
    document.body.innerHTML = '';
    const view = await render(
      <RecordHeader
        backHref="/platform/organizations"
        backLabel="Organizations"
        initials="HN"
        square={square}
        title="Hukum Nusantara"
      />,
    );
    const avatar = tokens(
      view.container.querySelector('[data-slot="record-avatar"]'),
    );
    expect([...avatar]).toEqual(
      expect.arrayContaining([
        'size-12',
        'text-base',
        'md:size-14',
        'md:text-lg',
      ]),
    );
    expect(avatar.has('size-14')).toBe(false);
  }
});
