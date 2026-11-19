import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatApi } from '@lexon/contracts';
import { ChatView } from '../src/components/chat/chat-view';
import { ChatHistory } from '../src/components/chat/chat-history';
import { ChatFloatingActions } from '../src/components/chat/chat-floating-actions';
import ChatsPage from '../src/app/(workspace)/chats/page';
import { render, settle } from './render';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 16, 9, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    setChatTitle: vi.fn(),
    chatTitleRefreshVersion: 0,
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

const wrap = (node: React.ReactNode) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {node}
  </QueryClientProvider>
);

async function renderNewChat() {
  return render(
    wrap(
      <ChatView
        actorScope="a"
        displayName="Ayu Wardani"
        client={{} as unknown as ChatApi}
        orgId="o"
        userId="u"
      />,
    ),
  );
}

it('centers a large greeting above the composer', async () => {
  const view = await renderNewChat();
  const heading = view.container.querySelector('h2');
  expect(heading?.className).toContain('text-[46px]');
  expect(heading?.className).toContain('max-md:text-[32px]');
  expect(heading?.className).toContain('text-center');
  await view.unmount();
});

it('puts the disclaimer directly under the composer and the starter pills below it', async () => {
  const view = await renderNewChat();
  const shell = view.container.querySelector(
    '[data-slot="aui_composer-shell"]',
  )!;
  const disclaimer = [...view.container.querySelectorAll('p')].find((p) =>
    p.textContent?.includes('Lexon can make mistakes'),
  )!;
  const pills = view.container.querySelector('[aria-label="Starter prompts"]')!;
  const after = (a: Node, b: Node) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(after(shell, disclaimer)).toBe(true);
  expect(after(disclaimer, pills)).toBe(true);
  await view.unmount();
});

it('keeps the composer text area transparent in dark mode and the focus ring on the shell', async () => {
  const view = await renderNewChat();
  const input = view.container.querySelector('textarea')!;
  expect(input.className).toContain('dark:bg-transparent');
  const shell = view.container.querySelector(
    '[data-slot="aui_composer-shell"]',
  )!;
  expect(shell.className).toContain('focus-within:border-input');
  await view.unmount();
});

it('marks New chat with a plus icon on the Chats page', async () => {
  const view = await render(wrap(<ChatsPage />));
  await settle();
  const link = [...view.container.querySelectorAll('a')].find(
    (a) => a.textContent?.trim() === 'New chat',
  )!;
  expect(link.querySelector('.lucide-plus')).not.toBeNull();
  expect(link.querySelector('.lucide-square-pen')).toBeNull();
  await view.unmount();
});

it('marks New chat with a plus icon in the empty state', async () => {
  const api = {
    list: vi.fn(async () => ({ items: [], pageInfo: { nextCursor: null } })),
  } as unknown as ChatApi;
  const view = await render(
    wrap(<ChatHistory client={api} scope={{ orgId: 'o', userId: 'u' }} />),
  );
  await settle();
  const link = view.container.querySelector('a[href="/workspace"]')!;
  expect(link.querySelector('.lucide-plus')).not.toBeNull();
  await view.unmount();
});

it('sizes the new-chat composer like the prototype: 56px text area and no extra toolbar padding', async () => {
  const view = await renderNewChat();
  const input = view.container.querySelector('textarea')!;
  expect(input.className).toContain('min-h-14');
  expect(input.className).not.toContain('min-h-20');
  const toolbar = view.container.querySelector(
    '[data-slot="aui_composer-shell"] > div',
  )!;
  expect(toolbar.className).not.toContain('pt-2');
  await view.unmount();
});

it('grows the new-chat text area with its content from 56px to 200px (mobile 144px), then scrolls inside', async () => {
  const view = await renderNewChat();
  const input = view.container.querySelector('textarea')!;
  for (const token of [
    'min-h-14',
    'max-h-[200px]',
    'max-md:max-h-36',
    'overflow-y-auto',
  ])
    expect(input.className).toContain(token);
  expect(input.className).not.toContain('max-h-48');
  await view.unmount();
});

it('marks the floating New chat pill with a plus icon', async () => {
  const view = await render(wrap(<ChatFloatingActions chat={null} />));
  await settle();
  const link = view.container.querySelector('a[aria-label="New chat"]')!;
  expect(link.querySelector('.lucide-plus')).not.toBeNull();
  expect(link.querySelector('.lucide-square-pen')).toBeNull();
  await view.unmount();
});
