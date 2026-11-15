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

for (const path of ['/workspace', '/chats', `/chats/${CHAT_ID}`]) {
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
  '/platform/provisioning',
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

test('the Chats page keeps only its own Chats heading', async () => {
  navigation.path = '/chats';
  const view = await render(tree(<PageHeader title="Chats" />));
  expect(view.container.querySelector('#main')?.textContent).not.toContain(
    'Page not found',
  );
  expect(view.container.querySelector('#main h1')?.textContent).toBe('Chats');
  await view.unmount();
});
