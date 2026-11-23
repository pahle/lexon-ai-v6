import { StatusPage } from '../src/components/states/status-page';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IdentitySummary } from '@lexon/contracts';
import { render, settle } from './render';
import { WorkspaceProvider } from '../src/components/shell/workspace-provider';
import { WorkspaceShell } from '../src/components/shell/workspace-shell';
import { CompositeSidebarProvider } from '../src/components/shell/sidebar-context';
import { AppSidebar } from '../src/components/shell/app-sidebar';
import { PageHeader } from '../src/components/shell/page-header';
import ChatPage from '../src/app/(workspace)/chats/[chatId]/page';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const navigation = vi.hoisted(() => ({
  path: '/workspace',
  params: { chatId: '11111111-1111-4111-8111-111111111111' },
  router: { replace: vi.fn(), push: vi.fn() },
}));
class EventSourceMock {
  onmessage = null;
  onopen = null;
  onerror = null;
  close() {}
}
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.path,
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => navigation.router,
  useParams: () => navigation.params,
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('../src/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));
const fixture = vi.hoisted(() => ({ title: null as string | null }));
vi.mock('../src/components/chat/chat-view', async () => {
  const { useEffect } = await import('react');
  const { useWorkspace } =
    await import('../src/components/shell/workspace-provider');
  return {
    ChatView: ({
      chatId,
      actorScope,
    }: {
      chatId: string;
      actorScope: string;
    }) => {
      const { setChatTitle } = useWorkspace();
      useEffect(() => {
        if (fixture.title) setChatTitle(chatId, actorScope, fixture.title);
      }, [actorScope, chatId, setChatTitle]);
      return <p>Chat view fixture</p>;
    },
  };
});

beforeEach(() => {
  vi.stubGlobal('EventSource', EventSourceMock);
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  window.innerWidth = 1280;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  navigation.path = '/workspace';
});

const identity: IdentitySummary = {
  version: 1,
  platformAdmin: false,
  organizationMemberCount: 1,
  user: {
    version: 1,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'member@example.test',
    name: 'Member',
    emailVerified: true,
    twoFactorEnabled: false,
    jobTitle: null,
    onboardingCompleted: true,
  },
  organization: {
    version: 1,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Team',
    slug: 'team',
    kind: 'team',
    state: 'active',
    role: 'owner',
    require2fa: false,
    createdAt: '2026-11-01T00:00:00Z',
  },
};

function tree(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <CompositeSidebarProvider defaultOpen>
          <WorkspaceShell sidebar={<AppSidebar />}>{children}</WorkspaceShell>
        </CompositeSidebarProvider>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}

const pill = (view: { container: HTMLElement }) => {
  const main = view.container.querySelector('#main')!;
  return {
    main,
    newChat: main.querySelector<HTMLAnchorElement>('a[aria-label="New chat"]'),
    actions: main.querySelector<HTMLButtonElement>(
      'button[aria-label="Chat actions"]',
    ),
  };
};

for (const path of ['/workspace', `/chats/${CHAT_ID}`]) {
  test(`chat route ${path} has no breadcrumb, a leading trigger, and the pill`, async () => {
    navigation.path = path;
    const view = await render(
      tree(<PageHeader title="Heading" visuallyHidden />),
    );
    const { main, newChat, actions } = pill(view);
    expect(
      view.container.querySelector('[aria-label="breadcrumb"]'),
    ).toBeNull();
    const first = main.querySelector<HTMLElement>(
      'button, a[href], [tabindex]:not([tabindex="-1"])',
    );
    expect(first?.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(newChat?.getAttribute('href')).toBe('/workspace');
    expect(actions).not.toBeNull();
    expect(actions!.disabled).toBe(path !== `/chats/${CHAT_ID}`);
    expect(main.querySelectorAll('h1')).toHaveLength(1);
    await view.unmount();
  });
}

test('the Chats page, like the prototype, has no pill', async () => {
  navigation.path = '/chats';
  const view = await render(
    tree(<PageHeader title="Heading" visuallyHidden />),
  );
  const { newChat, actions } = pill(view);
  expect(newChat).toBeNull();
  expect(actions).toBeNull();
  await view.unmount();
});

test('Chat actions opens Rename and Delete on an open chat', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  const view = await render(
    tree(<PageHeader title="Heading" visuallyHidden />),
  );
  await act(async () => pill(view).actions!.click());
  await settle();
  const items = [...document.body.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent,
  );
  expect(items).toEqual(['Rename', 'Delete']);
  await view.unmount();
});

async function openPillMenuItem(
  view: { container: HTMLElement },
  name: string,
) {
  await act(async () => pill(view).actions!.click());
  await settle();
  await act(async () =>
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === name)!
      .click(),
  );
  await settle();
}
const dialog = () =>
  document.body.querySelector<HTMLElement>('[role="dialog"]');

test('Rename from the pill opens a dialog prefilled with the open chat title', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = 'Employment agreement review';
  const view = await render(tree(<ChatPage />));
  await settle();
  await openPillMenuItem(view, 'Rename');
  expect(dialog()?.textContent).toContain('Rename chat');
  const input = dialog()!.querySelector<HTMLInputElement>('input')!;
  expect(input.labels?.[0]?.textContent).toBe('Chat title');
  expect(input.value).toBe('Employment agreement review');
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  await settle();
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(pill(view).actions);
  await view.unmount();
});

test('saving the pill rename calls the API and updates the pill title and hidden h1', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = 'Employment agreement review';
  const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>(
    async () => new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const view = await render(tree(<ChatPage />));
  await settle();
  await openPillMenuItem(view, 'Rename');
  const input = dialog()!.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'Renamed from the pill');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    dialog()!
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle();
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes(`/chats/${CHAT_ID}`),
  );
  expect(call).toBeDefined();
  expect(JSON.stringify(call)).toContain('Renamed from the pill');
  expect(dialog()).toBeNull();
  expect(view.container.querySelector('#main h1')?.textContent).toBe(
    'Renamed from the pill',
  );
  await view.unmount();
});

test('Delete from the pill opens the delete confirmation', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = 'Employment agreement review';
  const view = await render(tree(<ChatPage />));
  await settle();
  await openPillMenuItem(view, 'Delete');
  const alert = document.body.querySelector('[role="alertdialog"]');
  expect(alert?.textContent).toContain('Delete chat');
  await view.unmount();
});

test('route changes still move focus to the single h1', async () => {
  vi.useFakeTimers();
  navigation.path = '/workspace';
  const view = await render(tree(<PageHeader title="First" visuallyHidden />));
  navigation.path = '/chats';
  await view.rerender(tree(<PageHeader title="Chats" showDivider={false} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(document.activeElement?.tagName).toBe('H1');
  expect(view.container.querySelectorAll('#main h1')).toHaveLength(1);
  await view.unmount();
});

for (const path of [
  `/organizations/${identity.organization.id}/members`,
  '/platform/organizations',
]) {
  test(`non-chat route ${path} keeps the trigger and a serif h1 without the pill`, async () => {
    navigation.path = path;
    const view = await render(tree(<PageHeader title="Members" />));
    const { main, newChat, actions } = pill(view);
    expect(
      view.container.querySelector('[aria-label="breadcrumb"]'),
    ).toBeNull();
    expect(
      main.querySelector('[aria-label="Collapse sidebar"]'),
    ).not.toBeNull();
    expect(main.querySelector('h1')?.className).toContain('font-serif');
    expect(newChat).toBeNull();
    expect(actions).toBeNull();
    await view.unmount();
  });
}

// Moved from workspace-breadcrumb-chat.spec.tsx: chat title resolution now
// feeds the visually hidden h1 of the chat page.
test('the chat page h1 identifies the thread by its resolved title', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = 'Employment agreement review';
  const view = await render(tree(<ChatPage />));
  await settle();
  const heading = view.container.querySelector('#main h1');
  expect(heading?.textContent).toBe('Employment agreement review');
  expect(heading?.closest('header')?.className).toContain('sr-only');
  expect(view.container.textContent).not.toContain('Page not found');
  expect(view.container.querySelectorAll('#main h1')).toHaveLength(1);
  await view.unmount();
});

test('the chat page h1 falls back to Chat until the title is known', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = null;
  const view = await render(tree(<ChatPage />));
  await settle();
  expect(view.container.querySelector('#main h1')?.textContent).toBe('Chat');
  await view.unmount();
});

test('the header keeps the title known from the chat list while the thread loads, never the generic Chat', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = null;
  const client = new QueryClient();
  client.setQueryData(
    ['tenant', identity.organization.id, 'chat', identity.user.id, 'list', 20],
    {
      pageParams: [undefined],
      pages: [
        {
          items: [{ id: CHAT_ID, title: 'Listed chat title' }],
          pageInfo: { nextCursor: null },
        },
      ],
    },
  );
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <CompositeSidebarProvider defaultOpen>
          <WorkspaceShell sidebar={<AppSidebar />}>
            <ChatPage />
          </WorkspaceShell>
        </CompositeSidebarProvider>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await settle();
  expect(view.container.querySelector('#main h1')?.textContent).toBe(
    'Listed chat title',
  );
  expect(view.container.querySelector('#main')?.textContent).not.toMatch(
    /(^|[^a-z])Chat(?![a-z ])/,
  );
  await view.unmount();
});

test('the Chats page keeps only its own Chats heading', async () => {
  navigation.path = '/chats';
  const view = await render(tree(<PageHeader title="Chats" />));
  expect(view.container.querySelector('#main')?.textContent).not.toContain(
    'Page not found',
  );
  expect(view.container.querySelector('#main h1')?.textContent).toBe('Chats');
  await view.unmount();
});

test('the mobile header shows the chat title after the trigger and keeps the single hidden h1', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = 'Syarat sah perjanjian';
  window.innerWidth = 390;
  const view = await render(tree(<ChatPage />));
  await settle();
  const header = view.container.querySelector('#main > header')!;
  const title = header.querySelector<HTMLElement>(
    '[data-slot="chat-header-title"]',
  );
  expect(title?.textContent).toBe('Syarat sah perjanjian');
  expect(title?.getAttribute('aria-hidden')).toBe('true');
  expect(title?.className).toContain('truncate');
  const trigger = header.querySelector('button');
  expect(
    trigger!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(view.container.querySelectorAll('#main h1')).toHaveLength(1);
  expect(view.container.querySelector('#main h1')?.textContent).toBe(
    'Syarat sah perjanjian',
  );
  await view.unmount();
});

test('the desktop header shows the title and the divider; non-thread mobile routes show no chat title', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = 'Syarat sah perjanjian';
  window.innerWidth = 1280;
  const desktop = await render(tree(<ChatPage />));
  await settle();
  expect(
    desktop.container.querySelector('[data-slot="chat-header-title"]')
      ?.textContent,
  ).toBe('Syarat sah perjanjian');
  expect(
    desktop.container.querySelector('[data-slot="chat-header-divider"]'),
  ).not.toBeNull();
  await desktop.unmount();
  navigation.path = '/workspace';
  window.innerWidth = 390;
  const home = await render(
    tree(<PageHeader title="Heading" visuallyHidden />),
  );
  expect(
    home.container.querySelector('[data-slot="chat-header-title"]'),
  ).toBeNull();
  await home.unmount();
});

test('the pill is a fully round ring with two 28px round icon buttons and a 180px menu with a red Delete', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  const view = await render(
    tree(<PageHeader title="Heading" visuallyHidden />),
  );
  const { newChat, actions } = pill(view);
  const root = actions!.parentElement!;
  for (const token of ['rounded-full', 'p-[3px]', 'bg-background', 'gap-0.5'])
    expect(root.className).toContain(token);
  for (const button of [newChat!, actions!]) {
    expect(button.className).toContain('size-7');
    expect(button.className).toContain('rounded-full');
  }
  await act(async () => actions!.click());
  await settle();
  const menu = document.body.querySelector<HTMLElement>(
    '[data-slot="dropdown-menu-content"]',
  )!;
  expect(menu.className).toContain('w-[180px]');
  const remove = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === 'Delete')!;
  expect(remove.className).toContain('text-(--lexon-red-text)');
  await view.unmount();
});

test('a status page (for example the workspace error) shows no pill', async () => {
  navigation.path = '/workspace';
  const view = await render(
    tree(
      <StatusPage
        role="alert"
        icon={<span />}
        title="Something went wrong"
        text="We could not load this page. Your work is saved."
      />,
    ),
  );
  await settle();
  const { newChat, actions } = pill(view);
  expect(
    view.container.querySelector('[data-slot="status-page"]'),
  ).not.toBeNull();
  expect(newChat).toBeNull();
  expect(actions).toBeNull();
  await view.unmount();
});

test('the open chat title loads without the sidebar mounted, never as "Chat"', async () => {
  navigation.path = `/chats/${CHAT_ID}`;
  fixture.title = null;
  const { useOpenChat } =
    await import('../src/components/chat/chat-floating-actions');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        items: [
          {
            id: CHAT_ID,
            title: 'Lease dispute memo',
            updatedAt: '2026-11-01T00:00:00Z',
            lastMessageAt: null,
          },
        ],
        pageInfo: { nextCursor: null },
      }),
    ),
  );
  function Title() {
    const chat = useOpenChat();
    return chat?.title === 'Chat' ? (
      <p>generic</p>
    ) : chat ? (
      <p data-testid="title">{chat.title}</p>
    ) : null;
  }
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <Title />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(view.container.textContent).not.toContain('generic');
  await settle();
  expect(view.container.textContent).toBe('Lease dispute memo');
  await view.unmount();
});
