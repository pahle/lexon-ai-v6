import { test, expect, vi } from 'vitest';
import { act } from 'react';
import { render, settle } from './render';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IdentitySummary } from '@lexon/contracts';
import { Sidebar } from '../src/components/ui/sidebar';
import { CompositeSidebarProvider as SidebarProvider } from '../src/components/shell/sidebar-context';
import { AppSidebar } from '../src/components/shell/app-sidebar';
import { OrganizationMenu } from '../src/components/shell/organization-menu';
import { UserMenu } from '../src/components/shell/user-menu';
import { WorkspaceShell } from '../src/components/shell/workspace-shell';
import { sidebarDefaultOpen } from '../src/components/shell/sidebar-cookie';
import { ChatRuntimeProvider } from '../src/components/shell/chat-runtime-provider';

const identity: IdentitySummary = {
  version: 1,
  user: {
    version: 1,
    id: '00000000-0000-4000-8000-000000000011',
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    emailVerified: true,
    onboardingCompleted: true,
    twoFactorEnabled: true,
    jobTitle: null,
  },
  organization: {
    version: 1,
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Hidden personal name',
    slug: 'private-personal-slug',
    kind: 'personal',
    state: 'active',
    require2fa: false,
    role: 'owner',
    createdAt: '2026-11-01T00:00:00Z',
  },
  platformAdmin: true,
  organizationMemberCount: null,
};

const workspace = vi.hoisted(() => ({
  identity: null as IdentitySummary | null,
}));
const signOut = vi.hoisted(() => vi.fn());
const transition = vi.hoisted(() => vi.fn());
const fullReload = vi.hoisted(() => vi.fn());
const beginExplicitTransition = vi.hoisted(() => vi.fn());
const finishExplicitTransition = vi.hoisted(() => vi.fn());
const refreshIdentity = vi.hoisted(() => vi.fn(async () => {}));
async function sidebarFetch(input: RequestInfo | URL) {
  const requestUrl = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin,
  );
  if (requestUrl.pathname === '/api/chats')
    return Response.json({ items: [], pageInfo: { nextCursor: null } });
  return Response.json({
    version: 1,
    id: identity.user.id,
    name: identity.user.name,
    email: identity.user.email,
    emailVerified: true,
    twoFactorEnabled: true,
    jobTitle: null,
    onboardingCompleted: true,
  });
}
async function openNavigationGroup(container: HTMLElement, title: string) {
  const trigger = container.querySelector<HTMLButtonElement>(
    `nav button[aria-label="Toggle ${title} navigation"]`,
  );
  if (!trigger) throw new Error(`Missing navigation group: ${title}`);
  await act(async () => trigger.click());
}
vi.mock('../src/lib/auth-client', () => ({ authClient: { signOut } }));
vi.mock('../src/lib/tenant-queries', () => ({ transitionTenant: transition }));
vi.mock('../src/lib/full-reload', () => ({ fullReload }));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: workspace.identity,
    status: 'ready',
    transitioning: false,
    fallbackNotice: null,
    transitionNotice: null,
    beginExplicitTransition,
    finishExplicitTransition,
    refreshIdentity,
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

test('sidebar shows only eligible Lexon navigation and safe user identity', async () => {
  workspace.identity = identity;
  vi.stubGlobal('fetch', sidebarFetch);
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider>
        <ChatRuntimeProvider
          tenantId={`${identity.user.id}:${identity.organization.id}`}
        >
          <AppSidebar />
        </ChatRuntimeProvider>
      </SidebarProvider>
    </QueryClientProvider>,
  );
  await settle();
  const organizationTrigger = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Organization: Personal"]',
  )!;
  await act(async () => organizationTrigger.focus());
  await settle();
  expect(organizationTrigger.hasAttribute('data-popup-open')).toBe(false);
  const links = [
    ...view.container.querySelectorAll(
      'nav[aria-label="Primary navigation"] a',
    ),
  ];
  expect(
    links.map((link) => [link.textContent?.trim(), link.getAttribute('href')]),
  ).toEqual([
    ['Assistant', '/workspace'],
    ['New chatCtrl Alt N', '/workspace'],
    ['Chats', '/chats'],
    ['Platform', '/platform/provisioning'],
  ]);
  // LEX-DS-001 §5: the inset shell, a Tools group, and Assistant open by
  // default with New chat and Chats as its sub-items.
  expect(
    view.container.querySelector('[data-slot="sidebar"][data-variant="inset"]'),
  ).not.toBeNull();
  const groupLabels = [
    ...view.container.querySelectorAll('[data-slot="sidebar-group-label"]'),
  ].map((label) => label.textContent);
  expect(groupLabels).toEqual(['Tools', 'Recent']);
  expect(
    view.container
      .querySelector('nav button[aria-label="Toggle Assistant navigation"]')
      ?.getAttribute('aria-expanded'),
  ).toBe('true');
  const hint = view.container.querySelector('[data-slot="shortcut-hint"]')!;
  expect(hint.textContent).toBe('Ctrl Alt N');
  expect(hint.getAttribute('aria-hidden')).toBe('true');
  expect(
    view.container.querySelector(
      '[role="group"][aria-label="Recent chats"] a[href="/chats"]',
    ),
  ).toBeNull();
  expect(
    links
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent?.trim()),
  ).toEqual(['New chatCtrl Alt N']);
  const activeLink = links.find(
    (link) => link.getAttribute('aria-current') === 'page',
  )!;
  expect(activeLink.hasAttribute('data-active')).toBe(true);
  expect(activeLink.className).toContain('data-active:bg-sidebar-accent');
  await openNavigationGroup(view.container, 'Platform');
  expect(
    view.container.querySelector<HTMLButtonElement>(
      'nav button[aria-label="Toggle Platform navigation"]',
    )?.className,
  ).toContain('size-6');
  expect(view.container.querySelectorAll('img[alt="Lexon"]')).toHaveLength(1);
  expect(
    view.container.querySelector<HTMLImageElement>('img[alt="Lexon"]')?.width,
  ).toBe(16);
  expect(
    view.container.querySelector(
      'button[aria-label^="Organization: Personal"] img[alt="Lexon"]',
    ),
  ).not.toBeNull();
  expect(
    view.container.querySelector('button[aria-label^="Organization: Personal"]')
      ?.className,
  ).toContain('data-open:bg-sidebar-accent');
  expect(
    view.container.querySelector(
      'button[aria-label^="Organization: Personal"] svg.lucide-chevrons-up-down',
    ),
  ).not.toBeNull();
  expect(view.container.textContent).toContain('Ada Lovelace');
  expect(view.container.textContent).toContain('ada@example.test');
  expect(
    view.container.querySelector('button[aria-label^="Organization: Personal"]')
      ?.textContent,
  ).toBe('Personal Your private workspace');
  expect(
    view.container
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Organization: Personal"]',
      )
      ?.getAttribute('aria-label'),
  ).toBe('Organization: Personal Your private workspace, Owner');
  expect(
    view.container.querySelector('button[aria-label^="Organization: Personal"]')
      ?.textContent,
  ).not.toContain('Owner');
  expect(view.container.textContent).toContain('No chats yet.');
  const recentGroup = view.container.querySelector(
    '[role="group"][aria-label="Recent chats"]',
  );
  expect(recentGroup?.querySelector('p')?.textContent).toBe('No chats yet.');
  expect(
    [...(recentGroup?.querySelectorAll('a') ?? [])].map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]),
  ).toEqual([]);
  expect(view.container.textContent).not.toContain('View all chats');
  expect(view.container.textContent).not.toContain('private-personal-slug');
  expect(view.container.textContent).not.toContain('Hidden personal name');
  expect(
    [...view.container.querySelectorAll('a')]
      .filter((link) => link.closest('[data-slot="sidebar-menu-sub"]'))
      .map((link) => [link.textContent?.trim(), link.getAttribute('href')]),
  ).toEqual([
    ['New chatCtrl Alt N', '/workspace'],
    ['Chats', '/chats'],
    ['Provisioning', '/platform/provisioning'],
    ['Account status', '/platform/accounts'],
  ]);
  expect(
    view.container.querySelector('a[href="/settings/profile"]'),
  ).toBeNull();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
      }),
    ),
  );
  await settle();
  expect(
    view.container
      .querySelector('[data-slot="sidebar"]')
      ?.getAttribute('data-state'),
  ).toBe('collapsed');
  await act(async () => {
    organizationTrigger.blur();
    organizationTrigger.focus();
  });
  await settle();
  expect(organizationTrigger.hasAttribute('data-popup-open')).toBe(true);
  expect(
    view.container.querySelector('[role="group"][aria-label="Recent chats"]'),
  ).toBeNull();
  expect(view.container.textContent).not.toContain('No chats yet.');
  expect(
    view.container.querySelector('img[alt="Lexon"]')?.getAttribute('src'),
  ).toContain('LEXON-monogram-micro-seal.svg');
  expect(
    view.container.querySelector<HTMLImageElement>('img[alt="Lexon"]')?.width,
  ).toBe(16);
  expect(
    view.container.querySelector('button[aria-label^="Organization: Personal"]')
      ?.textContent,
  ).not.toContain('P');
  expect(
    view.container.querySelector('button[aria-label^="Organization: Personal"]')
      ?.textContent,
  ).not.toContain('Owner');
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
      }),
    ),
  );
  await settle();
  expect(view.container.textContent).toContain('No chats yet.');
  await act(async () =>
    (
      view.container.querySelector(
        '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
      ) as HTMLButtonElement
    )?.click(),
  );
  await settle();
  const settingsItem = [
    ...document.body.querySelectorAll('[role="menuitem"]'),
  ].find((item) => item.textContent?.includes('Settings')) as HTMLElement;
  expect(settingsItem).toBeDefined();
  expect(settingsItem.getAttribute('href')).toContain('settings=profile');
  expect(settingsItem.querySelector('svg.lucide-settings')).not.toBeNull();
  expect(settingsItem.textContent).toContain('⌘,');
  const signOutItem = [
    ...document.body.querySelectorAll('[role="menuitem"]'),
  ].find((item) => item.textContent?.trim() === 'Sign out') as HTMLElement;
  expect(signOutItem.querySelector('svg.lucide-log-out')).not.toBeNull();
  expect(
    document.body.querySelector('[data-slot="dropdown-menu-content"]')
      ?.className,
  ).toContain('shadow-md');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('Recent shows View all chats with its icon when there is at least one chat', async () => {
  workspace.identity = identity;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const requestUrl = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    if (requestUrl.pathname === '/api/chats')
      return Response.json({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000021',
            title: 'Contract review',
            updatedAt: '2026-11-13T09:00:00.000Z',
            lastMessageAt: '2026-11-13T09:00:00.000Z',
          },
        ],
        pageInfo: { nextCursor: null },
      });
    return sidebarFetch(input);
  });
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider>
        <ChatRuntimeProvider
          tenantId={`${identity.user.id}:${identity.organization.id}`}
        >
          <AppSidebar />
        </ChatRuntimeProvider>
      </SidebarProvider>
    </QueryClientProvider>,
  );
  await settle();
  expect(view.container.textContent).toContain('Contract review');
  expect(view.container.textContent).not.toContain('No chats yet.');
  const viewAll = view.container.querySelector(
    '[role="group"][aria-label="Recent chats"] a[href="/chats"]',
  )!;
  expect(viewAll.textContent?.trim()).toBe('View all chats');
  expect(viewAll.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  await view.unmount();
  vi.unstubAllGlobals();
});

test('long user names truncate inside the user menu without hiding controls', async () => {
  const longName = 'Avery Alexandra Extremely Long Professional Name';
  workspace.identity = {
    ...identity,
    user: { ...identity.user, name: longName },
  };
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <UserMenu />
    </QueryClientProvider>,
  );
  const trigger = view.container.querySelector('button[aria-haspopup="menu"]')!;
  expect(trigger.textContent).toContain(longName);
  expect(trigger.textContent).toContain(identity.user.email);
  expect(
    trigger.querySelector('[data-slot="avatar-initials"]')?.textContent,
  ).toBe('AA');
  expect(trigger.querySelector('svg.lucide-chevrons-up-down')).not.toBeNull();
  expect(trigger.className).toContain('aria-expanded:bg-muted');
  expect(trigger.querySelectorAll('.truncate').length).toBeGreaterThanOrEqual(
    2,
  );
  expect(
    view.container.querySelector('[aria-hidden="true"] button'),
  ).toBeNull();
  await view.unmount();
  workspace.identity = identity;
});

test('every active team role gets organization settings; only platform admins get Platform', async () => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', sidebarFetch);
  for (const organization of [
    { ...identity.organization, kind: 'team' as const, name: 'Lexon Team' },
    {
      ...identity.organization,
      kind: 'team' as const,
      name: 'Lexon Team',
      role: 'member' as const,
    },
    {
      ...identity.organization,
      kind: 'team' as const,
      name: 'Lexon Team',
      role: 'admin' as const,
    },
  ] as const) {
    workspace.identity = {
      ...identity,
      organization,
      organizationMemberCount: 1,
    };
    const view = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SidebarProvider>
          <ChatRuntimeProvider
            tenantId={`${workspace.identity!.user.id}:${workspace.identity!.organization.id}`}
          >
            <AppSidebar />
          </ChatRuntimeProvider>
        </SidebarProvider>
      </QueryClientProvider>,
    );
    await settle();
    const organizationTrigger = view.container.querySelector(
      'button[aria-label^="Organization: Lexon Team"]',
    )!;
    expect(organizationTrigger.getAttribute('aria-label')).toBe(
      `Organization: Lexon Team 1 member, ${organization.role.charAt(0).toUpperCase() + organization.role.slice(1)}`,
    );
    const links = [
      ...view.container.querySelectorAll(
        'nav[aria-label="Primary navigation"] a',
      ),
    ];
    expect(
      links.map((link) => [
        link.textContent?.trim(),
        link.getAttribute('href'),
      ]),
    ).toEqual([
      ['Assistant', '/workspace'],
      ['New chatCtrl Alt N', '/workspace'],
      ['Chats', '/chats'],
      ['Platform', '/platform/provisioning'],
    ]);
    expect(
      links
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent?.trim()),
    ).toEqual(['New chatCtrl Alt N']);
    if (organization.kind === 'team') {
      expect(view.container.querySelector('a[href*="/settings/"]')).toBeNull();
    }
    await openNavigationGroup(view.container, 'Platform');
    expect(
      view.container.querySelector('a[href="/platform/provisioning"]'),
    ).not.toBeNull();
    await view.unmount();
  }
  workspace.identity = {
    ...identity,
    organization: {
      ...identity.organization,
      kind: 'team',
      name: 'Lexon Team',
      role: 'admin',
    },
    platformAdmin: false,
    organizationMemberCount: 1,
  };
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider>
        <ChatRuntimeProvider
          tenantId={`${workspace.identity!.user.id}:${workspace.identity!.organization.id}`}
        >
          <AppSidebar />
        </ChatRuntimeProvider>
      </SidebarProvider>
    </QueryClientProvider>,
  );
  await settle();
  expect(
    [
      ...view.container.querySelectorAll(
        'nav[aria-label="Primary navigation"] a',
      ),
    ].map((link) => [link.textContent?.trim(), link.getAttribute('href')]),
  ).toEqual([
    ['Assistant', '/workspace'],
    ['New chatCtrl Alt N', '/workspace'],
    ['Chats', '/chats'],
  ]);
  expect(view.container.textContent).not.toContain('Organization settings');
  expect(view.container.textContent).not.toContain('Platform');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('organization menu paginates and a denied switch preserves Personal', async () => {
  beginExplicitTransition.mockClear();
  finishExplicitTransition.mockClear();
  transition.mockClear();
  fullReload.mockClear();
  const personal = identity.organization;
  const team = {
    ...personal,
    id: '00000000-0000-4000-8000-000000000002',
    kind: 'team' as const,
    name: 'Protected team',
    slug: 'protected-team',
    require2fa: true,
  };
  let activeSwitchRequests = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/organizations/active') {
      activeSwitchRequests++;
      return Response.json({
        status: 'enrollment_required',
        organization: personal,
        pendingOrganizationId: team.id,
      });
    }
    if (
      url.pathname === '/api/organizations' &&
      url.searchParams.has('cursor')
    ) {
      return Response.json({ items: [team], pageInfo: { nextCursor: null } });
    }
    return Response.json({
      items: [personal],
      pageInfo: { nextCursor: team.id },
    });
  });
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationMenu identity={identity} />
    </QueryClientProvider>,
  );
  await settle();
  await act(async () =>
    (view.container.querySelector('button') as HTMLButtonElement).click(),
  );
  await settle();
  const organizationPopover = document.body.querySelector(
    '[data-slot="dropdown-menu-content"]',
  );
  expect(organizationPopover?.className).toContain('shadow-md');
  expect(organizationPopover?.className).toContain('w-fit');
  expect(organizationPopover?.className).toContain('overflow-y-auto');
  expect(organizationPopover?.className).toContain('--available-height');
  expect(document.body.textContent).toContain('Personal');
  expect(document.body.textContent).not.toContain('private-personal-slug');
  expect(
    document.body.querySelectorAll(
      '[data-testid="organization-popup"] svg.lucide-check',
    ),
  ).toHaveLength(1);
  const currentOrganization = document.body.querySelector<HTMLElement>(
    '[role="menuitem"][aria-current="true"]',
  );
  expect(currentOrganization?.textContent).toContain('Personal');
  expect(currentOrganization?.hasAttribute('data-disabled')).toBe(false);
  await act(async () => currentOrganization?.click());
  await settle();
  expect(activeSwitchRequests).toBe(0);
  expect(beginExplicitTransition).not.toHaveBeenCalled();
  expect(
    document.body.querySelector('[data-testid="organization-popup"]'),
  ).not.toBeNull();
  const next = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === 'Next page')!;
  await act(async () => next.click());
  await settle();
  const option = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.endsWith('Protected team'))!;
  await act(async () => option.click());
  await settle();
  expect(beginExplicitTransition).toHaveBeenCalledTimes(1);
  expect(finishExplicitTransition).toHaveBeenCalledWith(
    expect.objectContaining({ securityLink: true }),
  );
  expect(document.body.textContent).toContain(
    'Your current organization is unchanged.',
  );
  expect(
    document.body.querySelector('a[href="/workspace?settings=security"]'),
  ).not.toBeNull();
  expect(
    document.body.querySelector('button[aria-label^="Organization: Personal"]'),
  ).not.toBeNull();
  await view.unmount();
  vi.unstubAllGlobals();
});

test('team creation uses a named dialog, refreshes the list, and keeps Personal selected', async () => {
  const personal = identity.organization;
  const created = {
    ...personal,
    id: '00000000-0000-4000-8000-000000000003',
    kind: 'team' as const,
    name: 'New team',
    slug: 'new-team',
  };
  let listRequests = 0;
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === '/api/organizations' && init?.method === 'POST')
        return Response.json(created, { status: 201 });
      if (url.pathname === '/api/organizations') {
        listRequests++;
        return Response.json({
          items: [personal],
          pageInfo: { nextCursor: null },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    },
  );
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationMenu identity={identity} />
    </QueryClientProvider>,
  );
  await settle();
  const organizationTrigger = view.container.querySelector(
    'button[aria-label^="Organization: Personal"]',
  )!;
  await act(async () =>
    (view.container.querySelector('button') as HTMLButtonElement).click(),
  );
  await settle();
  const create = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === 'Create a team')!;
  await act(async () => create.click());
  await settle();
  const dialog = document.body.querySelector('[role="dialog"]')!;
  const dialogOverlay = document.body.querySelector(
    '[data-slot="dialog-overlay"]',
  )!;
  expect(dialogOverlay.getAttribute('class')).toContain('bg-black/10');
  expect(dialogOverlay.getAttribute('class')).toContain('duration-100');
  expect(dialog.getAttribute('class')).toContain('sm:max-w-sm');
  expect(dialog.getAttribute('class')).toContain('w-[calc(100%-2rem)]');
  expect(dialog.querySelector('[data-slot="dialog-title"]')).not.toBeNull();
  expect(dialog.getAttribute('aria-labelledby')).not.toBeNull();
  expect(dialog.textContent).toContain('Create a team');
  const inputs = [...dialog.querySelectorAll('input')];
  for (const [index, value] of ['New team', 'new-team'].entries()) {
    const input = inputs[index];
    if (!input) throw new Error('Expected both team form inputs');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  await act(async () =>
    dialog
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle();
  expect(listRequests).toBeGreaterThanOrEqual(2);
  expect(
    view.container.querySelector(
      'button[aria-label^="Organization: Personal"]',
    ),
  ).not.toBeNull();
  expect(document.activeElement).toBe(organizationTrigger);
  await view.unmount();
  vi.unstubAllGlobals();
});

test('organization list failure hides fallback choices and retries safely', async () => {
  let attempts = 0;
  vi.stubGlobal('fetch', async () => {
    attempts++;
    if (attempts === 1) throw new Error('private server detail');
    return Response.json({
      items: [identity.organization],
      pageInfo: { nextCursor: null },
    });
  });
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationMenu identity={identity} />
    </QueryClientProvider>,
  );
  await settle();
  await act(async () =>
    (view.container.querySelector('button') as HTMLButtonElement).click(),
  );
  await settle();
  expect(document.body.textContent).toContain('Unable to load organizations.');
  const organizationLoadAlert = document.body.querySelector(
    '[data-testid="organization-load-alert"]',
  );
  expect(organizationLoadAlert?.getAttribute('role')).toBe('alert');
  expect(organizationLoadAlert?.textContent).toBe(
    'Unable to load organizations.',
  );
  expect(
    document.body.querySelector(
      '[data-testid="organization-popup"] [role="alert"]',
    ),
  ).toBeNull();
  expect(document.body.textContent).not.toContain('private server detail');
  const retry = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === 'Retry')!;
  expect(retry).toBeDefined();
  await act(async () => retry.click());
  await settle();
  expect(attempts).toBe(2);
  expect(document.body.textContent).not.toContain(
    'Unable to load organizations.',
  );
  await view.unmount();
  vi.unstubAllGlobals();
});

test('Personal organization monogram switches to cream artwork in dark mode', async () => {
  workspace.identity = identity;
  vi.stubGlobal('fetch', async () =>
    Response.json({
      items: [identity.organization],
      pageInfo: { nextCursor: null },
    }),
  );
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationMenu identity={identity} />
    </QueryClientProvider>,
  );
  await settle();
  const trigger = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Organization: Personal"]',
  )!;
  await act(async () => trigger.click());
  await settle();
  const personal = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.includes('Personal'))!;
  const logos = [...personal.querySelectorAll<HTMLImageElement>('img')];
  // The v4.1 monogram is one seal-red mark for both themes.
  expect(logos.map((logo) => logo.getAttribute('src'))).toEqual([
    '/LEXON-monogram-micro-seal.svg',
  ]);
  await view.unmount();
  vi.unstubAllGlobals();
});

test('canceling Create team returns focus to the stable organization trigger', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      items: [identity.organization],
      pageInfo: { nextCursor: null },
    }),
  );
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationMenu identity={identity} />
    </QueryClientProvider>,
  );
  await settle();
  const trigger = view.container.querySelector(
    'button[aria-label^="Organization: Personal"]',
  ) as HTMLButtonElement;
  await act(async () => trigger.click());
  await settle();
  const create = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === 'Create a team')!;
  await act(async () => create.click());
  await settle();
  const cancel = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === 'Cancel',
  )!;
  await act(async () => cancel.click());
  await settle();
  expect(document.activeElement).toBe(trigger);
  await view.unmount();
  vi.unstubAllGlobals();
});

test('successful switch waits for tenant transition before a full workspace reload', async () => {
  const personal = identity.organization;
  const team = {
    ...personal,
    id: '00000000-0000-4000-8000-000000000004',
    kind: 'team' as const,
    name: 'Switch target',
    slug: 'switch-target',
  };
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  transition.mockImplementation(async () => {
    events.push('transition-start');
    await gate;
    events.push('transition-end');
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/organizations/active')
      return Response.json({ status: 'switched', organization: team });
    return Response.json({
      items: [personal, team],
      pageInfo: { nextCursor: null },
    });
  });
  fullReload.mockImplementation((path: string) => {
    events.push('navigate');
    expect(path).toBe('/workspace');
  });
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationMenu identity={identity} />
    </QueryClientProvider>,
  );
  await settle();
  await act(async () =>
    (view.container.querySelector('button') as HTMLButtonElement).click(),
  );
  await settle();
  const option = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.endsWith('Switch target'))!;
  await act(async () => option.click());
  await settle();
  expect(events).toEqual(['transition-start']);
  expect(document.body.textContent).toContain('Switching organization…');
  release();
  await settle();
  expect(events).toEqual(['transition-start', 'transition-end', 'navigate']);
  expect(fullReload).toHaveBeenCalledWith('/workspace');
  await view.unmount();
  vi.unstubAllGlobals();
  transition.mockReset();
});

test('sign-out cancels, clears, calls auth, and shows the F1 failure message', async () => {
  const events: string[] = [];
  signOut.mockImplementation(async () => {
    events.push('signOut');
    return { error: { code: 'AUTH_UNAVAILABLE' } };
  });
  vi.stubGlobal('fetch', async () =>
    Response.json({
      version: 1,
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      emailVerified: true,
      twoFactorEnabled: true,
      jobTitle: null,
      onboardingCompleted: true,
    }),
  );
  const query = new QueryClient();
  vi.spyOn(query, 'cancelQueries').mockImplementation(async () => {
    events.push('cancel');
    return;
  });
  vi.spyOn(query, 'clear').mockImplementation(() => {
    events.push('clear');
  });
  const view = await render(
    <QueryClientProvider client={query}>
      <UserMenu />
    </QueryClientProvider>,
  );
  await settle();
  await act(async () =>
    (view.container.querySelector('button') as HTMLButtonElement).click(),
  );
  await settle();
  const action = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === 'Sign out',
  ) as HTMLElement;
  await act(async () => action.click());
  await settle();
  expect(events).toEqual(['cancel', 'clear', 'signOut']);
  expect(document.body.textContent).toContain(
    'Unable to sign out. Please try again.',
  );
  await view.unmount();
  vi.unstubAllGlobals();
  signOut.mockReset();
  fullReload.mockReset();
});

test('successful sign-out navigates only after authentication completes', async () => {
  const events: string[] = [];
  signOut.mockImplementation(async () => {
    events.push('signOut');
    return { error: null };
  });
  fullReload.mockImplementation((path: string, replace: boolean) => {
    events.push('navigate');
    expect([path, replace]).toEqual(['/sign-in', true]);
  });
  vi.stubGlobal('fetch', async () =>
    Response.json({
      version: 1,
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      emailVerified: true,
      twoFactorEnabled: true,
      jobTitle: null,
      onboardingCompleted: true,
    }),
  );
  const query = new QueryClient();
  vi.spyOn(query, 'cancelQueries').mockImplementation(async () => {
    events.push('cancel');
    return;
  });
  vi.spyOn(query, 'clear').mockImplementation(() => {
    events.push('clear');
  });
  const view = await render(
    <QueryClientProvider client={query}>
      <UserMenu />
    </QueryClientProvider>,
  );
  await settle();
  await act(async () =>
    (view.container.querySelector('button') as HTMLButtonElement).click(),
  );
  await settle();
  const action = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === 'Sign out',
  ) as HTMLElement;
  await act(async () => action.click());
  await settle();
  expect(events).toEqual(['cancel', 'clear', 'signOut', 'navigate']);
  expect(fullReload).toHaveBeenCalledWith('/sign-in', true);
  await view.unmount();
  vi.unstubAllGlobals();
  signOut.mockReset();
  fullReload.mockReset();
});

test('mobile sidebar closes on Escape and returns focus; the 768px boundary removes the sheet', async () => {
  workspace.identity = {
    ...identity,
    organizationMemberCount: 1,
    organization: {
      ...identity.organization,
      kind: 'team',
      name: 'Mobile team',
      role: 'admin',
    },
  };
  vi.stubGlobal('fetch', sidebarFetch);
  vi.stubGlobal('innerWidth', 767);
  const mediaListeners: Array<() => void> = [];
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: (_: string, cb: () => void) => {
      mediaListeners.push(cb);
    },
    removeEventListener: () => undefined,
  }));
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider defaultOpen={false}>
        <WorkspaceShell sidebar={<AppSidebar />}>
          <p>Home content</p>
        </WorkspaceShell>
      </SidebarProvider>
    </QueryClientProvider>,
  );
  await settle();
  const opener = view.container.querySelector(
    'button[aria-label="Open navigation"]',
  ) as HTMLButtonElement;
  opener.focus();
  await act(async () => opener.click());
  await settle();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain('No chats yet.');
  const mobileOrganizationTrigger = document.body.querySelector(
    'button[aria-label^="Organization: Mobile team"]',
  );
  expect(mobileOrganizationTrigger?.getAttribute('aria-label')).toContain(
    'Admin',
  );
  const closeSidebar = document.body.querySelector(
    'button[aria-label="Close navigation"]',
  ) as HTMLButtonElement | null;
  expect(closeSidebar).not.toBeNull();
  await act(async () => closeSidebar?.click());
  await settle();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  await act(async () => opener.click());
  await settle();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    document.body
      .querySelector(
        'button[aria-label^="Organization: Mobile team"] .bg-sidebar-primary',
      )
      ?.getAttribute('data-initials'),
  ).toBe('MT');
  expect(document.body.textContent).toContain('ada@example.test');
  const userSettingsTrigger = document.body.querySelector(
    '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
  ) as HTMLButtonElement | null;
  if (!userSettingsTrigger)
    throw new Error('User menu trigger was not rendered');
  expect(userSettingsTrigger.getAttribute('aria-label')).toBeNull();
  const sheetOverlay = document.body.querySelector(
    '[data-slot="sheet-overlay"]',
  )!;
  const sheetContent = document.body.querySelector(
    '[data-slot="sidebar"][data-mobile="true"]',
  )!;
  expect(sheetOverlay.className).toContain('bg-black/10');
  expect(sheetOverlay.className).toContain('duration-150');
  expect(sheetContent.className).toContain('bg-sidebar');
  expect(sheetContent.className).toContain('w-(--sidebar-width)');
  const closeExpanded = document.body.querySelector(
    'button[aria-label="Close navigation"]',
  ) as HTMLButtonElement;
  await act(async () => closeExpanded.click());
  await settle();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  await act(async () => opener.click());
  await settle();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  const reopenedOrganizationTrigger = document.body.querySelector(
    'button[aria-label^="Organization: Mobile team"]',
  ) as HTMLButtonElement;
  reopenedOrganizationTrigger.focus();
  await act(async () =>
    reopenedOrganizationTrigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  await settle();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  await act(async () => opener.click());
  await settle();
  vi.stubGlobal('innerWidth', 768);
  await act(async () => mediaListeners.forEach((listener) => listener()));
  await settle();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(
    view.container.querySelector('button[aria-label="Open navigation"]'),
  ).toBeNull();
  await view.unmount();
  vi.unstubAllGlobals();
});

test('native collapse persists sidebar_state and the keyboard shortcut toggles it', async () => {
  expect(sidebarDefaultOpen('false')).toBe(false);
  expect(sidebarDefaultOpen('true')).toBe(true);
  expect(sidebarDefaultOpen('malformed')).toBe(true);
  workspace.identity = {
    ...identity,
    organizationMemberCount: 1,
    organization: {
      ...identity.organization,
      kind: 'team',
      name: 'Lexon Team',
      role: 'admin',
    },
  };
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', sidebarFetch);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider>
        <WorkspaceShell sidebar={<AppSidebar />}>
          <p>Home content</p>
        </WorkspaceShell>
      </SidebarProvider>
    </QueryClientProvider>,
  );
  await settle();
  const sidebar = view.container.querySelector('[data-slot="sidebar"]')!;
  expect(
    view.container.querySelector(
      '[role="complementary"][aria-label="Workspace navigation"]',
    ),
  ).not.toBeNull();
  const toggle = view.container.querySelector(
    'button[aria-label="Collapse sidebar"]',
  ) as HTMLButtonElement;
  await act(async () => toggle.click());
  expect(sidebar.getAttribute('data-state')).toBe('collapsed');
  expect(document.cookie).toContain('sidebar_state=false');
  expect(
    sidebar.querySelector(
      'a[data-slot="sidebar-menu-button"][href*="settings=profile"]',
    ),
  ).toBeNull();
  expect(
    sidebar.querySelector(
      'a[data-slot="sidebar-menu-button"][href="/platform/provisioning"]',
    ),
  ).not.toBeNull();
  expect(
    sidebar.querySelector('button[aria-label="Toggle Settings navigation"]'),
  ).toBeNull();
  const collapsedHeader = sidebar.querySelector(
    '[data-slot="sidebar-header"]',
  )!;
  expect(collapsedHeader.className).toContain('p-2');
  expect(
    collapsedHeader
      .querySelector('.bg-sidebar-primary')
      ?.getAttribute('data-initials'),
  ).toBe('LT');
  const collapsedMenuButton = sidebar.querySelector(
    '[data-slot="sidebar-menu-button"]',
  )!;
  expect(collapsedMenuButton.className).toContain('size-8!');
  const organizationTrigger = sidebar.querySelector(
    'button[aria-label^="Organization: Lexon Team"]',
  )!;
  expect(organizationTrigger.textContent).toBe('');
  expect(
    organizationTrigger
      .querySelector('.bg-sidebar-primary')
      ?.getAttribute('data-initials'),
  ).toBe('LT');
  expect(organizationTrigger.textContent).not.toContain('Admin');
  expect(sidebar.textContent).not.toContain('ada@example.test');
  expect(
    sidebar.querySelector('[data-slot="avatar-initials"]')?.className,
  ).toContain('rounded-full');
  for (const button of sidebar.querySelectorAll(
    '[data-slot="sidebar-header"] button[aria-haspopup], [data-slot="sidebar-footer"] button[aria-haspopup]',
  )) {
    expect(button.className).toContain('h-12');
  }
  // Collapsed (prototype screen 32): one Assistant icon. It opens a menu with
  // the same destinations, so New chat and Chats stay keyboard reachable.
  const assistantMenu = sidebar.querySelector<HTMLButtonElement>(
    'nav button[aria-label="Assistant navigation"]',
  )!;
  expect(assistantMenu.getAttribute('aria-haspopup')).toBe('menu');
  expect(
    sidebar.querySelector('nav [data-slot="sidebar-menu-sub"]'),
  ).toBeNull();
  await act(async () => assistantMenu.click());
  await settle();
  expect(
    [
      ...document.body.querySelectorAll<HTMLAnchorElement>(
        '[data-slot="dropdown-menu-content"] a[role="menuitem"]',
      ),
    ].map((item) => [item.textContent?.trim(), item.getAttribute('href')]),
  ).toEqual([
    ['New chat', '/workspace'],
    ['Chats', '/chats'],
  ]);
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  await settle();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }),
    ),
  );
  await settle();
  expect(sidebar.getAttribute('data-state')).toBe('expanded');
  await view.unmount();
  const collapsed = await render(
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="icon" />
    </SidebarProvider>,
  );
  expect(
    collapsed.container
      .querySelector('[data-slot="sidebar"]')
      ?.getAttribute('data-state'),
  ).toBe('collapsed');
  await collapsed.unmount();
  vi.unstubAllGlobals();
});

test('the New chat shortcut hint follows the platform', async () => {
  workspace.identity = identity;
  vi.stubGlobal('fetch', sidebarFetch);
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const platform = vi
    .spyOn(window.navigator, 'platform', 'get')
    .mockReturnValue('MacIntel');
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider>
        <ChatRuntimeProvider
          tenantId={`${identity.user.id}:${identity.organization.id}`}
        >
          <AppSidebar />
        </ChatRuntimeProvider>
      </SidebarProvider>
    </QueryClientProvider>,
  );
  await settle();
  try {
    const hint = view.container.querySelector('[data-slot="shortcut-hint"]')!;
    expect(hint.textContent).toBe('⌘ ⌥ N');
    expect(hint.getAttribute('aria-hidden')).toBe('true');
  } finally {
    platform.mockRestore();
    await view.unmount();
    vi.unstubAllGlobals();
  }
});

const teamIdentity = (name: string, count: number | null): IdentitySummary => ({
  ...identity,
  organization: {
    ...identity.organization,
    id: '00000000-0000-4000-8000-000000000002',
    name,
    slug: 'team-slug',
    kind: 'team',
    role: 'admin',
  },
  organizationMemberCount: count,
});

async function renderMenu(value: IdentitySummary) {
  workspace.identity = value;
  vi.stubGlobal('fetch', async () =>
    Response.json({
      items: [identity.organization, { ...value.organization }],
      pageInfo: { nextCursor: null },
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationMenu identity={value} />
    </QueryClientProvider>,
  );
}

test('team trigger shows initials on the ink tile, the name, and the member count', async () => {
  const view = await renderMenu(teamIdentity('Hukum Nusantara', 12));
  await settle();
  const trigger = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Organization: Hukum Nusantara"]',
  )!;
  expect(trigger.getAttribute('aria-label')).toBe(
    'Organization: Hukum Nusantara 12 members, Admin',
  );
  const tile = trigger.querySelector('.bg-sidebar-primary')!;
  expect(tile.className).toContain('text-sidebar-primary-foreground');
  expect(tile.getAttribute('data-initials')).toBe('HN');
  expect(trigger.textContent).toBe('Hukum Nusantara 12 members');
  expect(trigger.querySelector('img[alt="Lexon"]')).toBeNull();
  await view.unmount();
  vi.unstubAllGlobals();
});

test('team trigger says "1 member" for a single member', async () => {
  const view = await renderMenu(teamIdentity('Solo', 1));
  await settle();
  const trigger = view.container.querySelector('button')!;
  expect(trigger.textContent).toBe('Solo 1 member');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('personal trigger shows the monogram tile and the private workspace line', async () => {
  const view = await renderMenu(identity);
  await settle();
  const trigger = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Organization: Personal"]',
  )!;
  const logo = trigger.querySelector<HTMLImageElement>(
    'img[alt="Lexon"][src="/LEXON-monogram-micro-seal.svg"]',
  )!;
  expect(logo).not.toBeNull();
  const tile = logo.parentElement!;
  expect(tile.className).toContain('bg-background');
  expect(tile.className).toContain('border');
  expect(trigger.textContent).toBe('Personal Your private workspace');
  expect(trigger.getAttribute('aria-label')).toBe(
    'Organization: Personal Your private workspace, Owner',
  );
  expect(trigger.textContent).not.toContain('member');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('a 60-character team name truncates inside the trigger', async () => {
  const name = 'Nusantara '.repeat(6).trim().slice(0, 60);
  const view = await renderMenu(teamIdentity(name, 3));
  await settle();
  const trigger = view.container.querySelector('button')!;
  const nameElement = [...trigger.querySelectorAll('span')].find(
    (el) => el.textContent === name,
  )!;
  expect(nameElement.className).toContain('truncate');
  expect(nameElement.parentElement!.className).toContain('min-w-0');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('the dropdown list shows a tile and name per organization and no counts', async () => {
  const view = await renderMenu(teamIdentity('Hukum Nusantara', 12));
  await settle();
  await act(async () => view.container.querySelector('button')!.click());
  await settle();
  const items = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].filter(
    (item) =>
      item.hasAttribute('aria-current') ||
      item.querySelector('span[aria-hidden="true"]'),
  );
  const text = items.map((item) => item.textContent);
  expect(text).toContain('PPersonal'.slice(1));
  expect(text.some((value) => value?.includes('Hukum Nusantara'))).toBe(true);
  const popup = document.body.querySelector(
    '[data-testid="organization-popup"]',
  )!;
  expect(popup.textContent).not.toMatch(/\d+ members?/);
  expect(popup.querySelectorAll('.bg-sidebar-primary')).toHaveLength(1);
  expect(popup.querySelectorAll('img[alt="Lexon"]')).toHaveLength(1);
  await view.unmount();
  vi.unstubAllGlobals();
});

test('trigger accessible names contain the visible text in order and keep the role', async () => {
  for (const [value, visible, role] of [
    [
      teamIdentity('Hukum Nusantara', 12),
      'Hukum Nusantara 12 members',
      'Admin',
    ],
    [teamIdentity('Solo', 1), 'Solo 1 member', 'Admin'],
    [identity, 'Personal Your private workspace', 'Owner'],
  ] as const) {
    const view = await renderMenu(value);
    await settle();
    const trigger = view.container.querySelector('button')!;
    const label = trigger.getAttribute('aria-label')!;
    expect(label.startsWith(`Organization: ${visible}`)).toBe(true);
    expect(label).toContain(role);
    const spoken = [...trigger.querySelectorAll('span:not([aria-hidden])')]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent);
    expect(label).toContain(spoken.join(' '));
    await view.unmount();
    vi.unstubAllGlobals();
  }
});

test('the user menu shows the job title instead of the email, and the email without one', async () => {
  workspace.identity = {
    ...identity,
    user: { ...identity.user, jobTitle: 'Senior Associate' },
  };
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <UserMenu />
    </QueryClientProvider>,
  );
  const trigger = view.container.querySelector('button[aria-haspopup="menu"]')!;
  expect(trigger.textContent).toContain('Senior Associate');
  expect(trigger.textContent).not.toContain('ada@example.test');
  await act(async () => (trigger as HTMLButtonElement).click());
  await settle();
  const label = document.body.querySelector(
    '[data-slot="dropdown-menu-label"]',
  )!;
  expect(label.textContent).toContain('Senior Associate');
  expect(label.textContent).not.toContain('ada@example.test');
  await view.unmount();

  workspace.identity = identity;
  const plain = await render(
    <QueryClientProvider client={new QueryClient()}>
      <UserMenu />
    </QueryClientProvider>,
  );
  const plainTrigger = plain.container.querySelector(
    'button[aria-haspopup="menu"]',
  )!;
  expect(plainTrigger.textContent).toContain('ada@example.test');
  await act(async () => (plainTrigger as HTMLButtonElement).click());
  await settle();
  expect(
    document.body.querySelector('[data-slot="dropdown-menu-label"]')
      ?.textContent,
  ).toContain('ada@example.test');
  await plain.unmount();
});

test('an 80-character job title truncates inside the trigger', async () => {
  workspace.identity = {
    ...identity,
    user: { ...identity.user, jobTitle: 'J'.repeat(80) },
  };
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <UserMenu />
    </QueryClientProvider>,
  );
  const trigger = view.container.querySelector('button[aria-haspopup="menu"]')!;
  const line = [...trigger.querySelectorAll('span.truncate')].find((el) =>
    el.textContent?.startsWith('JJJ'),
  )!;
  expect(line.className).toContain('truncate');
  expect(line.parentElement?.className).toContain('min-w-0');
  expect(trigger.className).not.toContain('overflow-visible');
  await view.unmount();
});
