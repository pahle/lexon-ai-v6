import { afterEach, test, expect, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import type { IdentitySummary } from '@lexon/contracts';
import { render, settle } from './render';
import {
  WorkspaceProvider,
  useWorkspace,
} from '../src/components/shell/workspace-provider';
import { WorkspaceShell } from '../src/components/shell/workspace-shell';
import { usePanelHost } from '../src/components/shell/workspace-shell';
import { Workspace } from '../src/components/organizations/workspace';
import { UserMenu } from '../src/components/shell/user-menu';
import { OrganizationMenu } from '../src/components/shell/organization-menu';
import { fullReload } from '../src/lib/full-reload';
import { identityApi } from '../src/components/organizations/page-state';
import { IdentityClientError } from '../src/lib/identity-client';
import { CompositeSidebarProvider } from '../src/components/shell/sidebar-context';
import { AppSidebar } from '../src/components/shell/app-sidebar';
import { PageHeader } from '../src/components/shell/page-header';
const navigation = vi.hoisted(() => ({
  path: '/workspace',
  search: '',
  replace: vi.fn(),
  router: { replace: vi.fn() },
}));
const signOut = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/auth-client', () => ({ authClient: { signOut } }));
vi.mock('../src/lib/full-reload', () => ({ fullReload: vi.fn() }));
vi.mock('../src/components/auth/account-security', () => ({
  AccountSecurity: () => <p>Account security fixture</p>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.path,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => navigation.router,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  navigation.path = '/workspace';
  navigation.search = '';
  navigation.router.replace.mockClear();
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
});

const identity: IdentitySummary = {
  version: 1,
  platformAdmin: false,
  user: {
    version: 1,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'member@example.test',
    name: 'Member',
    emailVerified: true,
    twoFactorEnabled: false,
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

function Harness({
  client,
  initial = identity,
}: {
  client: QueryClient;
  initial?: IdentitySummary;
}) {
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity: initial }}>
        <WorkspaceShell>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}

test('workspace shell composes one sidebar inset, one main, and a route breadcrumb', async () => {
  window.innerWidth = 1280;
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <CompositeSidebarProvider defaultOpen>
          <WorkspaceShell sidebar={<AppSidebar />}>
            <p>Workspace content</p>
          </WorkspaceShell>
        </CompositeSidebarProvider>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );

  expect(view.container.querySelectorAll('[data-slot="sidebar"]')).toHaveLength(
    1,
  );
  expect(
    view.container.querySelectorAll(
      '[role="complementary"][aria-label="Workspace navigation"]',
    ),
  ).toHaveLength(1);
  expect(view.container.querySelectorAll('main')).toHaveLength(1);
  expect(
    view.container.querySelector('[data-slot="sidebar-inset"]'),
  ).not.toBeNull();
  expect(
    view.container.querySelector('[aria-label="breadcrumb"]')?.textContent,
  ).toContain('Home');
  expect(view.container.textContent).toContain('Workspace content');
  await view.unmount();
});

test('incomplete onboarding keeps Account Security available without team settings', async () => {
  navigation.search = '?settings=security';
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const incomplete = {
    ...identity,
    user: { ...identity.user, onboardingCompleted: false },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderShell = () => (
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity: incomplete }}>
        <WorkspaceShell>
          <p>Onboarding flow</p>
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
  const view = await render(renderShell());
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Account security fixture');
  expect(document.body.textContent).toContain('Onboarding flow');
  expect(
    [
      ...document.body.querySelectorAll('[aria-label="Settings sections"] a'),
    ].map((link) => link.textContent),
  ).toEqual(['Security']);
  expect(document.body.textContent).not.toContain('Members');
  navigation.search = '?settings=members';
  await view.rerender(renderShell());
  expect(document.body.textContent).toContain(
    'You do not have access to this section.',
  );
  expect(document.body.textContent).not.toContain('Account security fixture');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('workspace breadcrumb follows team routes with valid list semantics and safe labels', async () => {
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  navigation.path = '/workspace';
  navigation.search = '?settings=general';
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider
        bootstrap={{
          status: 'ready',
          identity: {
            ...identity,
            organization: {
              ...identity.organization,
              name: 'Private team name',
            },
          },
        }}
      >
        <CompositeSidebarProvider defaultOpen>
          <WorkspaceShell sidebar={<AppSidebar />}>
            <p>Settings content</p>
          </WorkspaceShell>
        </CompositeSidebarProvider>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  const breadcrumb = view.container.querySelector(
    'nav[aria-label="breadcrumb"]',
  )!;
  const items = [...breadcrumb.querySelectorAll('ol > li')];
  expect(items).toHaveLength(1);
  expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe(
    'Home',
  );
  expect(breadcrumb.textContent).not.toContain('Private team name');
  expect(breadcrumb.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(
    view.container.querySelector(
      `nav[aria-label="Primary navigation"] a[href*="settings=general"]`,
    ),
  ).toBeNull();
  await view.unmount();
});

test('workspace breadcrumb labels provisioning details and invalid organization routes safely', async () => {
  navigation.path = '/platform/provisioning/org-private-id';
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <CompositeSidebarProvider defaultOpen>
          <WorkspaceShell sidebar={<AppSidebar />}>
            <p>Route content</p>
          </WorkspaceShell>
        </CompositeSidebarProvider>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  const breadcrumb = view.container.querySelector(
    'nav[aria-label="breadcrumb"]',
  )!;
  expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe(
    'Provisioning details',
  );
  expect(breadcrumb.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(breadcrumb.textContent).not.toContain('org-private-id');

  navigation.path = `/organizations/${identity.organization.id}/members`;
  await view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <CompositeSidebarProvider defaultOpen>
          <WorkspaceShell sidebar={<AppSidebar />}>
            <p>Route content</p>
          </WorkspaceShell>
        </CompositeSidebarProvider>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  const invalidBreadcrumb = view.container.querySelector(
    'nav[aria-label="breadcrumb"]',
  )!;
  expect(
    invalidBreadcrumb.querySelector('[aria-current="page"]')?.textContent,
  ).toBe('Page not found');
  expect(
    invalidBreadcrumb.querySelectorAll('[aria-current="page"]'),
  ).toHaveLength(1);
  await view.unmount();
  vi.unstubAllGlobals();
});

test('mobile user menu opens settings and closing restores focus to the navigation opener', async () => {
  navigation.path = '/workspace';
  vi.stubGlobal('innerWidth', 767);
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const renderShell = () => (
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <CompositeSidebarProvider defaultOpen={false}>
          <WorkspaceShell sidebar={<AppSidebar />}>
            <PageHeader title="Home" />
          </WorkspaceShell>
        </CompositeSidebarProvider>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
  const view = await render(renderShell());
  const opener = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Open navigation"]',
  )!;
  await act(async () => opener.click());
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  const userMenu = document.body.querySelector<HTMLButtonElement>(
    '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
  )!;
  await act(async () => userMenu.click());
  const settings = document.body.querySelector<HTMLAnchorElement>(
    '[role="menuitem"][href*="settings=profile"]',
  )!;
  await act(async () => settings.click());
  navigation.search = '?settings=profile';
  await view.rerender(renderShell());
  await vi.waitFor(() =>
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull(),
  );
  expect(
    [
      ...document.body.querySelectorAll('[aria-label="Settings sections"] a'),
    ].map((link) => link.textContent),
  ).toEqual([
    'Profile',
    'Appearance',
    'Security',
    'Members',
    'Invitations',
    'General',
  ]);
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  navigation.search = '';
  await view.rerender(renderShell());
  await vi.waitFor(() =>
    expect(document.body.querySelector('[role="dialog"]')).toBeNull(),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  await view.unmount();
  vi.unstubAllGlobals();
});

function Protected() {
  const workspace = useWorkspace();
  const [revision, setRevision] = useState(0);
  return (
    <>
      <p>Protected {workspace.identity?.organization.name}</p>
      <p>{workspace.identity?.user.name}</p>
      <button onClick={() => setRevision((value) => value + 1)}>
        Rerender child {revision}
      </button>
      {workspace.identity?.organization.kind === 'team' &&
      workspace.identity.organization.role === 'owner' &&
      workspace.identity.user.name === 'Member' ? (
        <p>Old private members</p>
      ) : null}
    </>
  );
}

function RetryIdentity() {
  const workspace = useWorkspace();
  return (
    <>
      <button onClick={() => void workspace.refreshIdentity()}>
        Retry identity
      </button>
      <p data-testid="workspace-status">{workspace.status}</p>
      {workspace.identity ? <p>Fresh {workspace.identity.user.name}</p> : null}
    </>
  );
}

function BeginExplicitTransition() {
  const workspace = useWorkspace();
  return (
    <button onClick={() => workspace.beginExplicitTransition()}>
      Switch organization
    </button>
  );
}

test('shared explicit shell transition suppresses protected content and runtime host', async () => {
  const client = new QueryClient();
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <WorkspaceShell sidebar={<BeginExplicitTransition />}>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(view.container.textContent).toContain('Old private members');
  await act(async () =>
    (view.container.querySelector('button') as HTMLButtonElement).click(),
  );
  expect(view.container.textContent).toContain('Verifying your workspace');
  expect(view.container.textContent).not.toContain('Old private members');
  expect(view.container.querySelector('[data-slot="thread"]')).toBeNull();
  await view.unmount();
});

test('organization switch hides old protected content and enrollment denial restores current content', async () => {
  const target = {
    ...identity.organization,
    kind: 'team' as const,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Next team',
    slug: 'next-team',
  };
  vi.spyOn(identityApi, 'listOrganizations').mockResolvedValue({
    items: [identity.organization, target],
    pageInfo: { nextCursor: null },
  });
  let finishSwitch!: (value: {
    status: 'switched';
    organization: typeof target;
  }) => void;
  let finishCleanup!: () => void;
  const tenantQueries = await import('../src/lib/tenant-queries');
  const cleanupSpy = vi
    .spyOn(tenantQueries, 'transitionTenant')
    .mockImplementation(
      () => new Promise((resolve) => (finishCleanup = resolve)),
    );
  const switchCall = vi
    .spyOn(identityApi, 'switchOrganization')
    .mockImplementation(
      () => new Promise((resolve) => (finishSwitch = resolve)),
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <WorkspaceShell sidebar={<OrganizationMenu identity={identity} />}>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await settle();
  await act(async () =>
    (
      view.container.querySelector(
        '[aria-label^="Organization: Team"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await settle();
  await act(async () =>
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Next team')
      ?.click(),
  );
  expect(switchCall).toHaveBeenCalledWith(target.id);
  expect(view.container.textContent).not.toContain('Old private members');
  await act(async () =>
    finishSwitch({ status: 'switched', organization: target }),
  );
  await settle();
  expect(fullReload).not.toHaveBeenCalled();
  expect(view.container.textContent).not.toContain('Old private members');
  await act(async () => finishCleanup());
  await settle();
  expect(fullReload).toHaveBeenCalledWith('/workspace');
  expect(view.container.textContent).not.toContain('Old private members');
  await view.unmount();

  vi.spyOn(identityApi, 'switchOrganization').mockResolvedValue({
    status: 'enrollment_required',
    organization: identity.organization,
    pendingOrganizationId: target.id,
  });
  const deniedView = await render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <WorkspaceShell sidebar={<OrganizationMenu identity={identity} />}>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await settle();
  await act(async () =>
    (
      deniedView.container.querySelector(
        '[aria-label^="Organization: Team"]',
      ) as HTMLButtonElement
    ).click(),
  );
  await settle();
  await act(async () =>
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Next team')
      ?.click(),
  );
  await settle();
  expect(deniedView.container.textContent).toContain('Old private members');
  expect(
    deniedView.container.querySelector(
      'a[href="/workspace?settings=security"]',
    ),
  ).not.toBeNull();
  expect(deniedView.container.textContent).toContain(
    'Your current organization is unchanged.',
  );
  await deniedView.unmount();
  switchCall.mockRestore();
  cleanupSpy.mockRestore();
});

test('unavailable bootstrap recovers only after an explicit fresh identity check', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const verified = {
    ...identity,
    user: { ...identity.user, name: 'Fresh member' },
  };
  const later = {
    ...verified,
    user: { ...verified.user, name: 'Updated member' },
  };
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockResolvedValueOnce(verified)
    .mockResolvedValue(later);
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'unavailable' }}>
        <RetryIdentity />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('button')?.textContent).toBe(
    'Retry identity',
  );
  await act(async () => view.container.querySelector('button')?.click());
  await act(async () => vi.advanceTimersByTimeAsync(10));
  expect(identityCall).toHaveBeenCalledTimes(1);
  expect(view.container.textContent).toContain('Fresh Fresh member');
  expect(view.container.textContent).not.toContain(
    'Service temporarily unavailable',
  );
  expect(identityCall).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(identityCall).toHaveBeenCalledTimes(2);
  expect(view.container.textContent).toContain('Fresh Updated member');
  await view.unmount();
});

test('late identity polling cannot overwrite a newer fresh verification', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const oldAdmin: IdentitySummary = {
    ...identity,
    platformAdmin: true,
    user: { ...identity.user, name: 'Old admin' },
  };
  const freshOrdinary: IdentitySummary = {
    ...identity,
    user: { ...identity.user, name: 'Fresh ordinary' },
  };
  let releasePoll: (value: IdentitySummary) => void = () => {};
  const heldPoll = new Promise<IdentitySummary>((resolve) => {
    releasePoll = resolve;
  });
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockImplementationOnce(() => heldPoll)
    .mockResolvedValueOnce(freshOrdinary);
  function IdentityPublicationProbe() {
    const workspace = useWorkspace();
    return (
      <>
        <button onClick={() => void workspace.refreshIdentity()}>
          Refresh identity
        </button>
        <p>
          {workspace.identity
            ? `${workspace.identity.user.name}:${workspace.identity.platformAdmin}`
            : 'hidden'}
        </p>
      </>
    );
  }
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity: oldAdmin }}>
        <IdentityPublicationProbe />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );

  let polling!: Promise<void>;
  await act(async () => {
    polling = client.invalidateQueries({ queryKey: ['identity'] });
    await Promise.resolve();
  });
  expect(identityCall).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.container.querySelector('button')!.click();
    await settle();
  });
  expect(view.container.textContent).toContain('Fresh ordinary:false');
  expect(client.getQueryData<IdentitySummary>(['identity'])).toMatchObject({
    user: { name: 'Fresh ordinary' },
    platformAdmin: false,
  });

  await act(async () => {
    releasePoll(oldAdmin);
    await polling;
    await settle();
  });
  expect(view.container.textContent).toContain('Fresh ordinary:false');
  expect(client.getQueryData<IdentitySummary>(['identity'])).toMatchObject({
    user: { name: 'Fresh ordinary' },
    platformAdmin: false,
  });

  await view.unmount();
  client.clear();
  identityCall.mockRestore();
});

test('identity publication also ignores an older poll that finishes before a manual verification', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const currentAdmin: IdentitySummary = {
    ...identity,
    platformAdmin: true,
    user: { ...identity.user, name: 'Current admin' },
  };
  const stalePoll: IdentitySummary = {
    ...currentAdmin,
    user: { ...currentAdmin.user, name: 'Stale poll admin' },
  };
  const freshOrdinary: IdentitySummary = {
    ...identity,
    user: { ...identity.user, name: 'Fresh ordinary' },
  };
  let releasePoll: (value: IdentitySummary) => void = () => {};
  let releaseManual: (value: IdentitySummary) => void = () => {};
  const heldPoll = new Promise<IdentitySummary>((resolve) => {
    releasePoll = resolve;
  });
  const heldManual = new Promise<IdentitySummary>((resolve) => {
    releaseManual = resolve;
  });
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockImplementationOnce(() => heldPoll)
    .mockImplementationOnce(() => heldManual);
  function IdentityPublicationProbe() {
    const workspace = useWorkspace();
    return (
      <>
        <button onClick={() => void workspace.refreshIdentity()}>
          Refresh identity
        </button>
        <p>
          {workspace.identity
            ? `${workspace.identity.user.name}:${workspace.identity.platformAdmin}`
            : 'hidden'}
        </p>
      </>
    );
  }
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider
        bootstrap={{ status: 'ready', identity: currentAdmin }}
      >
        <IdentityPublicationProbe />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  let polling!: Promise<void>;
  await act(async () => {
    polling = client.invalidateQueries({ queryKey: ['identity'] });
    await Promise.resolve();
  });
  await act(async () => {
    view.container.querySelector('button')!.click();
    await settle();
  });
  expect(identityCall).toHaveBeenCalledTimes(2);

  await act(async () => {
    releasePoll(stalePoll);
    await polling;
    await settle();
  });
  expect(view.container.textContent).toContain('Current admin:true');
  expect(view.container.textContent).not.toContain('Stale poll admin');
  expect(client.getQueryData<IdentitySummary>(['identity'])).toMatchObject({
    user: { name: 'Current admin' },
    platformAdmin: true,
  });

  await act(async () => {
    releaseManual(freshOrdinary);
    await settle();
  });
  expect(view.container.textContent).toContain('Fresh ordinary:false');
  expect(client.getQueryData<IdentitySummary>(['identity'])).toMatchObject({
    user: { name: 'Fresh ordinary' },
    platformAdmin: false,
  });
  await view.unmount();
  client.clear();
  identityCall.mockRestore();
});

test('failed unavailable retry continues to hide protected content', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockRejectedValue(new Error('temporary outage'));
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'unavailable' }}>
        <WorkspaceShell>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await act(async () =>
    [...view.container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Retry')
      ?.click(),
  );
  await settle();
  expect(identityCall).toHaveBeenCalledTimes(1);
  expect(view.container.textContent).toContain(
    'Service temporarily unavailable',
  );
  expect(view.container.textContent).not.toContain('Old private members');
  await view.unmount();
});

test('failed sign-out keeps protected content hidden until identity is freshly verified', async () => {
  let finishSignOut!: (value: { error: Error }) => void;
  let finishIdentity!: (value: IdentitySummary) => void;
  signOut.mockImplementation(
    () => new Promise((resolve) => (finishSignOut = resolve)),
  );
  const fresh = {
    ...identity,
    user: { ...identity.user, name: 'Reverified member' },
  };
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockImplementation(
      () => new Promise((resolve) => (finishIdentity = resolve)),
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <WorkspaceShell sidebar={<UserMenu />}>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(view.container.textContent).toContain('Old private members');
  await act(async () =>
    (document.querySelector('button') as HTMLButtonElement).click(),
  );
  await settle();
  await act(async () => {
    [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent === 'Sign out')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
  });
  await settle();
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(view.container.textContent).not.toContain('Old private members');
  await act(async () => {
    finishSignOut({ error: new Error('signout failed') });
    await signOut.mock.results[0]?.value;
  });
  expect(await signOut.mock.results[0]?.value).toMatchObject({
    error: expect.any(Error),
  });
  await settle();
  expect(identityCall).toHaveBeenCalledTimes(1);
  expect(view.container.textContent).not.toContain('Old private members');
  await act(async () => finishIdentity(fresh));
  await settle();
  expect(view.container.textContent).toContain('Protected Team');
  expect(view.container.textContent).toContain('Reverified member');
  expect(view.container.textContent).not.toContain('Old private members');
  expect(view.container.textContent).toContain(
    'Unable to sign out. Please try again.',
  );
  expect(client.getQueriesData({ queryKey: ['tenant'] })).toEqual([]);
  await view.unmount();
  signOut.mockReset();
});

test('failed sign-out plus failed verification stays protected and retries safely', async () => {
  signOut.mockResolvedValue({ error: new Error('signout failed') });
  const fresh = {
    ...identity,
    user: { ...identity.user, name: 'Verified after retry' },
  };
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockRejectedValueOnce(new Error('verification unavailable'))
    .mockResolvedValue(fresh);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <WorkspaceShell sidebar={<UserMenu />}>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await act(async () =>
    (document.querySelector('button') as HTMLButtonElement).click(),
  );
  await settle();
  await act(async () =>
    [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent === 'Sign out')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  await settle();
  expect(identityCall).toHaveBeenCalledTimes(1);
  expect(view.container.textContent).toContain(
    'Service temporarily unavailable',
  );
  expect(view.container.querySelector('button')?.textContent).toBe('Retry');
  expect(view.container.textContent).not.toContain('Old private members');
  await act(async () => view.container.querySelector('button')?.click());
  await settle();
  expect(identityCall).toHaveBeenCalledTimes(2);
  expect(view.container.textContent).toContain('Verified after retry');
  expect(view.container.textContent).not.toContain('Old private members');
  expect(client.getQueriesData({ queryKey: ['tenant'] })).toEqual([]);
  await view.unmount();
});

test('one persistent identity observer polls every five seconds through child rerenders', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockResolvedValue(identity);
  const view = await render(<Harness client={client} />);
  await act(async () => view.container.querySelector('button')?.click());
  expect(view.container.textContent).toContain('Rerender child 1');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(identityCall).toHaveBeenCalledTimes(1);
  await act(async () =>
    view.container.firstElementChild?.dispatchEvent(
      new Event('change', { bubbles: true }),
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(identityCall).toHaveBeenCalledTimes(2);
  await view.unmount();
  identityCall.mockRestore();
  vi.useRealTimers();
});

test('protected children stay hidden while bootstrap is unavailable or expired', async () => {
  const client = new QueryClient();
  for (const status of ['unavailable', 'expired'] as const) {
    const view = await render(
      <QueryClientProvider client={client}>
        <WorkspaceProvider bootstrap={{ status }}>
          <WorkspaceShell>
            <p>Private organization data</p>
          </WorkspaceShell>
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
    expect(view.container.textContent).not.toContain(
      'Private organization data',
    );
    await view.unmount();
  }
});

test('rejected bootstrap never trusts a previously cached identity', async () => {
  for (const status of ['expired', 'unavailable', 'mfa-required'] as const) {
    const client = new QueryClient();
    client.setQueryData(['identity'], identity);
    const view = await render(
      <QueryClientProvider client={client}>
        <WorkspaceProvider bootstrap={{ status }}>
          <WorkspaceShell>
            <p>Old protected identity</p>
          </WorkspaceShell>
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
    expect(view.container.textContent).not.toContain('Old protected identity');
    expect(view.container.textContent).not.toContain('Protected Team');
    await view.unmount();
  }
});

test('ready bootstrap supersedes cached identity before any protected content renders', async () => {
  const client = new QueryClient();
  const oldIdentity: IdentitySummary = {
    ...identity,
    user: {
      ...identity.user,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'User A',
    },
  };
  const verified: IdentitySummary = {
    ...identity,
    user: {
      ...identity.user,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: 'User B',
    },
    organization:
      identity.organization.kind === 'team'
        ? { ...identity.organization, role: 'member' }
        : identity.organization,
  };
  client.setQueryData(['identity'], oldIdentity);
  client.setQueryData(
    ['tenant', identity.organization.id, 'members'],
    ['User A private members'],
  );
  client.setQueryData(['account', 'security'], ['User A account data']);
  client.setQueryData(['platform', 'provisioning'], ['User A platform data']);
  client.setQueryData(['organizations'], ['User A organization choices']);
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity: verified }}>
        <WorkspaceShell>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(view.container.textContent).toContain('Protected Team');
  expect(view.container.textContent).not.toContain('Old private members');
  expect(client.getQueryData(['identity'])).toMatchObject({
    user: { name: 'User B' },
  });
  expect(
    client.getQueriesData({ queryKey: ['tenant', identity.organization.id] }),
  ).toEqual([]);
  for (const key of [['account'], ['platform'], ['organizations']])
    expect(client.getQueriesData({ queryKey: key })).toEqual([]);
  await view.unmount();
});

test('workspace home redirects incomplete users to onboarding', async () => {
  const client = new QueryClient();
  const incomplete = {
    ...identity,
    user: { ...identity.user, onboardingCompleted: false },
  };
  navigation.router.replace.mockClear();
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity: incomplete }}>
        <WorkspaceShell>
          <Workspace />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(navigation.router.replace).toHaveBeenCalledWith('/onboarding');
  expect(view.container.textContent).not.toContain('Create a team');
  await view.unmount();
});

test('onboarding identity does not render the optional sidebar', async () => {
  const client = new QueryClient();
  const incomplete = {
    ...identity,
    user: { ...identity.user, onboardingCompleted: false },
  };
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity: incomplete }}>
        <WorkspaceShell sidebar={<nav>Protected navigation</nav>}>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(view.container.textContent).not.toContain('Protected navigation');
  await view.unmount();
});

test('MFA-required bootstrap keeps a security route and hides other protected content', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockRejectedValue(new IdentityClientError('AUTH_2FA_REQUIRED', 403));
  const client = new QueryClient();
  navigation.path = '/workspace';
  const restricted = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'mfa-required' }}>
        <WorkspaceShell>
          <p>Protected organization data</p>
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(restricted.container.textContent).not.toContain(
    'Protected organization data',
  );
  expect(
    restricted.container.querySelector(
      'a[href="/workspace?settings=security"]',
    ),
  ).not.toBeNull();
  await restricted.unmount();
  identityCall.mockRestore();
  const securityIdentityCall = vi
    .spyOn(identityApi, 'identity')
    .mockRejectedValue(new IdentityClientError('AUTH_2FA_REQUIRED', 403));
  navigation.path = '/workspace';
  navigation.search = '?settings=security';
  const recovery = await render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'mfa-required' }}>
        <WorkspaceShell>
          <p>Recovery controls</p>
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    [
      ...document.body.querySelectorAll('[aria-label="Settings sections"] a'),
    ].map((link) => link.textContent),
  ).toEqual(['Security']);
  expect(recovery.container.textContent).not.toContain(
    'Protected organization data',
  );
  await recovery.unmount();
  securityIdentityCall.mockRestore();
  vi.unstubAllGlobals();
  navigation.path = '/workspace';
});

test('security recovery works at both preserved paths and keeps direct sign-in verification available', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  for (const path of ['/workspace']) {
    const identityCall = vi
      .spyOn(identityApi, 'identity')
      .mockRejectedValue(new IdentityClientError('AUTH_2FA_REQUIRED', 403));
    navigation.path = path;
    navigation.search = '?settings=security';
    const view = await render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceProvider bootstrap={{ status: 'mfa-required' }}>
          <WorkspaceShell>
            <p>Recovery controls</p>
          </WorkspaceShell>
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain(
      'Protected organization data',
    );
    expect(
      view.container.querySelector(
        'a[href="/two-factor?returnTo=%2Fworkspace%3Fsettings%3Dsecurity"]',
      ),
    ).not.toBeNull();
    await view.unmount();
    identityCall.mockRestore();
  }
  vi.unstubAllGlobals();
  navigation.path = '/workspace';
});

test('MFA bootstrap continues verified identity polling and only AUTH_2FA_REQUIRED enters recovery mode', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  let authorized = false;
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockImplementation(async () => {
      if (!authorized) throw new IdentityClientError('AUTH_2FA_REQUIRED', 403);
      return identity;
    });
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'mfa-required' }}>
        <WorkspaceShell>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(identityCall).toHaveBeenCalled();
  expect(view.container.textContent).not.toContain('Protected Team');
  authorized = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(view.container.textContent).toContain('Protected Team');
  await view.unmount();
  identityCall.mockRestore();
  vi.useRealTimers();
});

test('only AUTH_2FA_REQUIRED is classified as MFA recovery', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  client.setQueryData(
    ['tenant', identity.organization.id, 'members'],
    ['Stale protected members'],
  );
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockRejectedValue(new IdentityClientError('ORG_FORBIDDEN', 403));
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <WorkspaceShell>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(
    view.container.querySelector('a[href="/workspace?settings=security"]'),
  ).toBeNull();
  expect(view.container.textContent).toContain(
    'Service temporarily unavailable',
  );
  expect(client.getQueriesData({ queryKey: ['tenant'] })).toEqual([]);
  await view.unmount();
  identityCall.mockRestore();
  vi.useRealTimers();
});

test('fallback notice is emitted once per distinct verified fallback', async () => {
  const client = new QueryClient();
  const first = { ...identity, fallbackReason: 'membership_removed' as const };
  const view = await render(<Harness client={client} initial={first} />);
  expect(
    view.container.textContent?.match(/no longer have access/gi),
  ).toHaveLength(1);
  await act(async () => {
    await settle();
  });
  expect(
    view.container.textContent?.match(/no longer have access/gi),
  ).toHaveLength(1);
  await view.unmount();
});

test('the same fallback event stays dismissed while a fallback from another source organization is announced', async () => {
  const client = new QueryClient();
  const personal = {
    ...identity.organization,
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    name: 'Personal',
    slug: 'personal',
    kind: 'personal' as const,
    role: 'owner' as const,
    require2fa: false as const,
  };
  const sourceA = identity;
  const fallbackA: IdentitySummary = {
    ...identity,
    organization: personal,
    fallbackReason: 'membership_removed',
    previousOrganizationName: 'Shared Team',
  };
  const sourceB: IdentitySummary = {
    ...identity,
    organization: {
      ...identity.organization,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      name: 'Shared Team',
    },
  };
  const fallbackB = { ...fallbackA };
  const view = await render(<Harness client={client} initial={sourceA} />);
  await act(async () => client.setQueryData(['identity'], fallbackA));
  await settle();
  expect(
    view.container.textContent?.match(/no longer have access/gi),
  ).toHaveLength(1);
  await act(async () =>
    client.setQueryData(['identity'], {
      ...fallbackA,
      fallbackReason: undefined,
    }),
  );
  await settle();
  expect(view.container.textContent).not.toContain('no longer have access');
  await act(async () => client.setQueryData(['identity'], fallbackA));
  await settle();
  expect(view.container.textContent).not.toContain('no longer have access');
  await act(async () => client.setQueryData(['identity'], sourceB));
  await settle();
  await act(async () => client.setQueryData(['identity'], fallbackB));
  await settle();
  expect(
    view.container.textContent?.match(/no longer have access/gi),
  ).toHaveLength(1);
  await view.unmount();
});

test('same-organization role demotion hides and clears private tenant data before revealing the new role', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    ['tenant', identity.organization.id, 'members'],
    ['Private cached member list'],
  );
  let resolveIdentity: (value: IdentitySummary) => void = () => {};
  const identityCall = vi.spyOn(identityApi, 'identity').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveIdentity = resolve;
      }),
  );
  const view = await render(<Harness client={client} />);
  expect(view.container.textContent).toContain('Old private members');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await act(async () => {
    const demoted: IdentitySummary = {
      ...identity,
      organization:
        identity.organization.kind === 'team'
          ? { ...identity.organization, role: 'member' }
          : identity.organization,
    };
    resolveIdentity(demoted);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(client.getQueryData(['identity'])).toMatchObject({
    organization: { role: 'member' },
  });
  expect(view.container.textContent).not.toContain('Old private members');
  expect(
    client.getQueriesData({ queryKey: ['tenant', identity.organization.id] }),
  ).toEqual([]);
  expect(client.getQueryData(['active-organization'])).toMatchObject({
    role: 'member',
  });
  await view.unmount();
  identityCall.mockRestore();
  vi.useRealTimers();
});

test('MFA policy changes clear same-organization tenant cache before publishing identity', async () => {
  const requiredOrg: IdentitySummary = {
    ...identity,
    organization:
      identity.organization.kind === 'team'
        ? { ...identity.organization, require2fa: true }
        : identity.organization,
  };
  const enrolled: IdentitySummary = {
    ...identity,
    user: { ...identity.user, twoFactorEnabled: true },
  };
  const cases: Array<[string, IdentitySummary, IdentitySummary]> = [
    ['organization requirement', identity, requiredOrg],
    ['user factor state', enrolled, identity],
  ];
  for (const [label, original, updated] of cases) {
    const client = new QueryClient();
    client.setQueryData(
      ['tenant', identity.organization.id, 'members'],
      [`Private data before ${label}`],
    );
    const identityCall = vi
      .spyOn(identityApi, 'identity')
      .mockResolvedValue(updated);
    const view = await render(
      <QueryClientProvider client={client}>
        <WorkspaceProvider bootstrap={{ status: 'ready', identity: original }}>
          <WorkspaceShell>
            <Protected />
          </WorkspaceShell>
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['identity'] });
    });
    await settle();
    expect(
      client.getQueriesData({ queryKey: ['tenant', identity.organization.id] }),
    ).toEqual([]);
    expect(client.getQueryData(['identity'])).toMatchObject({
      user: { twoFactorEnabled: updated.user.twoFactorEnabled },
      organization: { require2fa: updated.organization.require2fa },
    });
    expect(view.container.textContent).not.toContain(
      `Private data before ${label}`,
    );
    await view.unmount();
    identityCall.mockRestore();
  }
});

test('identity rejection removes protected cache and platform loss removes platform data', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  for (const key of [
    ['tenant', identity.organization.id, 'members'],
    ['account', 'security'],
    ['platform', 'provisioning'],
    ['organizations'],
  ])
    client.setQueryData(key, ['private']);
  const rejected = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'unavailable' }}>
        <WorkspaceShell>
          <p>Protected</p>
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  for (const key of [['tenant'], ['account'], ['platform'], ['organizations']])
    expect(client.getQueriesData({ queryKey: key })).toEqual([]);
  await rejected.unmount();

  const admin = { ...identity, platformAdmin: true };
  client.setQueryData(['identity'], admin);
  client.setQueryData(
    ['platform', 'provisioning'],
    ['Private platform payload'],
  );
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockResolvedValue(identity);
  const demoted = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity: admin }}>
        <WorkspaceShell>
          <Protected />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(client.getQueriesData({ queryKey: ['platform'] })).toEqual([]);
  await demoted.unmount();
  identityCall.mockRestore();
});

test('organization transition cancels old tenant query, clears it, and refreshes organization choices', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let resolveOldTenant: (value: string[]) => void = () => {};
  const oldTenantRequest = new Promise<string[]>((resolve) => {
    resolveOldTenant = resolve;
  });
  const oldOrgId = identity.organization.id;
  client.setQueryData(['organizations'], { items: ['Old choices'] });
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockImplementation(async () => ({
      ...identity,
      organization: {
        ...identity.organization,
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        slug: 'new-team',
      },
    }));
  const view = await render(
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <WorkspaceShell>
          <TenantMembers request={oldTenantRequest} orgId={oldOrgId} />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  resolveOldTenant(['Late private old members']);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(client.getQueriesData({ queryKey: ['tenant', oldOrgId] })).toEqual([]);
  expect(view.container.textContent).not.toContain('Late private old members');
  expect(client.getQueryState(['organizations'])?.isInvalidated).toBe(true);
  await view.unmount();
  identityCall.mockRestore();
  vi.useRealTimers();
});

test('clearing the query cache never restores the initial bootstrap identity or queries its old tenant', async () => {
  const client = new QueryClient();
  const initial = identity;
  const personal: IdentitySummary = {
    ...identity,
    user: { ...identity.user, name: 'Verified latest user' },
    organization: {
      ...identity.organization,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      name: 'Personal',
      slug: 'personal',
      kind: 'personal',
      role: 'owner',
      require2fa: false,
    },
    fallbackReason: 'membership_removed',
    previousOrganizationName: identity.organization.name,
  };
  const tenantRequests: string[] = [];
  const identityCall = vi
    .spyOn(identityApi, 'identity')
    .mockResolvedValue(personal);
  const makeTree = (bootstrap: IdentitySummary) => (
    <QueryClientProvider client={client}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity: bootstrap }}>
        <WorkspaceShell>
          <Protected />
          <ActiveTenantProbe requests={tenantRequests} />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(makeTree(initial)));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['identity'] });
  });
  await settle();
  expect(container.textContent).toContain('Personal');
  expect(container.textContent).toContain('Verified latest user');
  const requestsBeforeClear = tenantRequests.length;
  client.clear();
  await act(async () => root.render(makeTree(initial)));
  await settle();
  expect(container.textContent).toContain('Personal');
  expect(container.textContent).toContain('Verified latest user');
  expect(container.textContent).not.toContain('Old private members');
  expect(tenantRequests.slice(requestsBeforeClear)).not.toContain(
    initial.organization.id,
  );
  await act(async () => root.unmount());
  container.remove();
  identityCall.mockRestore();
});

function TenantMembers({
  request,
  orgId,
}: {
  request: Promise<string[]>;
  orgId: string;
}) {
  const { identity } = useWorkspace();
  const query = useQuery({
    queryKey: ['tenant', identity?.organization.id ?? orgId, 'members'],
    queryFn: () =>
      identity?.organization.id === orgId
        ? request
        : Promise.resolve(['Current members']),
    enabled: !!identity,
  });
  return <p>{query.data?.join(', ')}</p>;
}

function ActiveTenantProbe({ requests }: { requests: string[] }) {
  const { identity } = useWorkspace();
  const organizationId = identity?.organization.id;
  useQuery({
    queryKey: ['tenant', organizationId, 'identity-rewind-probe'],
    enabled: !!organizationId,
    queryFn: async () => {
      requests.push(organizationId!);
      return [];
    },
  });
  return null;
}

function PanelHostProbe() {
  const host = usePanelHost();
  return <span data-host-ready={host ? 'yes' : 'no'} />;
}

test('panel host is page-owned inside a focusable inset main', async () => {
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'ready', identity }}>
        <WorkspaceShell>
          <PanelHostProbe />
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  const host = view.container.querySelector('[data-panel-host]');
  const main = view.container.querySelector('main');
  expect(host).not.toBeNull();
  expect(host?.tagName).toBe('DIV');
  expect(main?.contains(host)).toBe(true);
  expect(host?.closest('aside[aria-label="Context panel"]')).toBeNull();
  expect(main?.tabIndex).toBe(-1);
  expect(main?.className).toContain('min-w-0');
  expect(view.container.querySelectorAll('main')).toHaveLength(1);
  expect(host?.getAttribute('class') ?? '').not.toMatch(/w-80|w-full/);
  await view.unmount();
});
