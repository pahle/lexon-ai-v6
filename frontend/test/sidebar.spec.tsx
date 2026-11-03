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
vi.mock('next/navigation', () => ({ usePathname: () => '/workspace' }));

test('sidebar shows only eligible Lexon navigation and safe user identity', async () => {
  workspace.identity = identity;
  vi.stubGlobal('fetch', async () =>
    Response.json({
      version: 1,
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      emailVerified: true,
      twoFactorEnabled: true,
      onboardingCompleted: true,
    }),
  );
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
  const links = [
    ...view.container.querySelectorAll(
      'nav[aria-label="Primary navigation"] a',
    ),
  ];
  expect(links.map((link) => link.textContent?.trim())).toEqual([
    'Home',
    'Platform',
  ]);
  expect(
    links
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent?.trim()),
  ).toEqual(['Home']);
  const activeLink = links.find(
    (link) => link.getAttribute('aria-current') === 'page',
  )!;
  expect(activeLink.hasAttribute('data-active')).toBe(true);
  expect(activeLink.className).toContain('data-active:font-medium');
  await openNavigationGroup(view.container, 'Platform');
  expect(
    view.container.querySelector<HTMLButtonElement>(
      'nav button[aria-label="Toggle Platform navigation"]',
    )?.className,
  ).toContain('size-6');
  expect(view.container.querySelectorAll('img[alt="Lexon"]')).toHaveLength(1);
  expect(
    view.container.querySelector<HTMLImageElement>('img[alt="Lexon"]')?.width,
  ).toBe(32);
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
  ).toContain('Owner');
  expect(
    view.container
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Organization: Personal"]',
      )
      ?.getAttribute('aria-label'),
  ).toBe('Organization: Personal Owner');
  expect(
    view.container.querySelector('button[aria-label^="Organization: Personal"]')
      ?.textContent,
  ).toContain('Personal Owner');
  expect(view.container.textContent).toContain('No conversations yet.');
  const conversationList = view.container.querySelector(
    '[role="group"][aria-label="Conversations"]',
  );
  expect(conversationList?.querySelector('p')?.textContent).toBe(
    'No conversations yet.',
  );
  expect(conversationList?.querySelector('button')).toBeNull();
  expect(view.container.textContent).not.toContain('private-personal-slug');
  expect(view.container.textContent).not.toContain('Hidden personal name');
  expect(
    [...view.container.querySelectorAll('a')]
      .filter((link) => link.closest('[data-slot="sidebar-menu-sub"]'))
      .map((link) => [link.textContent?.trim(), link.getAttribute('href')]),
  ).toEqual([
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
  expect(
    view.container.querySelector('[role="group"][aria-label="Conversations"]'),
  ).toBeNull();
  expect(view.container.textContent).not.toContain('No conversations yet.');
  expect(
    view.container.querySelector('img[alt="Lexon"]')?.getAttribute('src'),
  ).toContain('LEXON-mark-tile-seal-micro.svg');
  expect(
    view.container.querySelector<HTMLImageElement>('img[alt="Lexon"]')?.width,
  ).toBe(32);
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
  expect(view.container.textContent).toContain('No conversations yet.');
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
  ].find((item) => item.textContent?.trim() === 'Settings') as HTMLElement;
  expect(settingsItem).toBeDefined();
  expect(settingsItem.getAttribute('href')).toBe('/settings/profile');
  expect(settingsItem.querySelector('svg.lucide-settings')).not.toBeNull();
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
  vi.stubGlobal('fetch', async () =>
    Response.json({
      version: 1,
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      emailVerified: true,
      twoFactorEnabled: true,
      onboardingCompleted: true,
    }),
  );
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
    workspace.identity = { ...identity, organization };
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
    expect(organizationTrigger.textContent).toContain(
      organization.role.charAt(0).toUpperCase() + organization.role.slice(1),
    );
    const links = [
      ...view.container.querySelectorAll(
        'nav[aria-label="Primary navigation"] a',
      ),
    ];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Home',
      'Platform',
    ]);
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
    ].map((link) => link.textContent?.trim()),
  ).toEqual(['Home']);
  expect(view.container.textContent).not.toContain('Organization settings');
  expect(view.container.textContent).not.toContain('Platform');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('organization menu paginates and a denied switch preserves Personal', async () => {
  beginExplicitTransition.mockClear();
  finishExplicitTransition.mockClear();
  const personal = identity.organization;
  const team = {
    ...personal,
    id: '00000000-0000-4000-8000-000000000002',
    kind: 'team' as const,
    name: 'Protected team',
    slug: 'protected-team',
    require2fa: true,
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/organizations/active') {
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
  const next = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === 'Next page')!;
  await act(async () => next.click());
  await settle();
  const option = [
    ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === 'Protected team')!;
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
    document.body.querySelector('a[href="/settings/security"]'),
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
  ].find((item) => item.textContent === 'Switch target')!;
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
    organization: {
      ...identity.organization,
      kind: 'team',
      name: 'Mobile team',
      role: 'admin',
    },
  };
  vi.stubGlobal('fetch', async () =>
    Response.json({
      version: 1,
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      emailVerified: true,
      twoFactorEnabled: true,
      onboardingCompleted: true,
    }),
  );
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
  expect(document.body.textContent).toContain('No conversations yet.');
  const mobileOrganizationTrigger = document.body.querySelector(
    'button[aria-label^="Organization: Mobile team"]',
  );
  expect(mobileOrganizationTrigger?.textContent).toContain('Admin');
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
    document.body.querySelector('img[alt="Lexon"]')?.getAttribute('src'),
  ).toContain('LEXON-mark-tile-seal-micro.svg');
  expect(
    document.body.querySelector<HTMLImageElement>('img[alt="Lexon"]')?.width,
  ).toBe(32);
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
  await act(async () =>
    document.dispatchEvent(
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
  vi.stubGlobal('fetch', async () =>
    Response.json({
      version: 1,
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      emailVerified: true,
      twoFactorEnabled: true,
      onboardingCompleted: true,
    }),
  );
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
      'a[data-slot="sidebar-menu-button"][href="/settings/profile"]',
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
    collapsedHeader.querySelector('img[alt="Lexon"]')?.getAttribute('src'),
  ).toContain('LEXON-mark-tile-seal-micro.svg');
  const collapsedMenuButton = sidebar.querySelector(
    '[data-slot="sidebar-menu-button"]',
  )!;
  expect(collapsedMenuButton.className).toContain('size-8!');
  const organizationTrigger = sidebar.querySelector(
    'button[aria-label^="Organization: Lexon Team"]',
  )!;
  expect(
    organizationTrigger.querySelector<HTMLImageElement>('img[alt="Lexon"]')
      ?.width,
  ).toBe(32);
  expect(organizationTrigger.textContent).not.toContain('L');
  expect(organizationTrigger.textContent).not.toContain('Admin');
  expect(sidebar.textContent).not.toContain('ada@example.test');
  expect(
    sidebar.querySelector('[data-slot="avatar-initials"]')?.className,
  ).toContain('rounded-full');
  for (const button of sidebar.querySelectorAll('button[aria-haspopup]')) {
    expect(button.className).toContain('h-12');
  }
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
