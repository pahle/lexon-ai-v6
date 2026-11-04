import { afterEach, test, expect, vi } from 'vitest';
import { act } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { settle } from './render';
import {
  getSettingsFinalFocusTarget,
  readSettingsSection,
  settingsHref,
} from '../src/components/settings/settings-url';
import { SettingsDialog } from '../src/components/settings/settings-dialog';
import { SettingsNavigation } from '../src/components/settings/settings-navigation';
import { render } from './render';

async function renderWithQuery(node: ReactNode, client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

const locationState = vi.hoisted(() => ({
  pathname: '/workspace',
  search: '',
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const TEAM_A = '00000000-0000-4000-8000-000000000041';
const TEAM_B = '00000000-0000-4000-8000-000000000042';
const workspaceState = vi.hoisted(() => ({
  identity: {
    version: 1,
    user: {
      id: 'user-1',
      name: 'Taylor',
      email: 'taylor@example.test',
      emailVerified: true,
      twoFactorEnabled: false,
      onboardingCompleted: true,
    },
    organization: {
      version: 1,
      id: 'personal-1',
      kind: 'personal',
      name: 'Personal',
      slug: 'personal',
      state: 'active',
      require2fa: false,
      role: 'owner',
      createdAt: '2026-11-01T00:00:00.000Z',
    },
    platformAdmin: false,
  } as unknown,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => locationState.pathname,
  useSearchParams: () => new URLSearchParams(locationState.search),
  useRouter: () => router,
}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    status: 'ready',
    identity: workspaceState.identity,
  }),
}));
vi.mock('../src/components/settings/profile-settings', async () => {
  const {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } = await import('../src/components/ui/dropdown-menu');
  return {
    ProfileSettings: () => (
      <section>
        <label>
          Display name
          <input defaultValue="Taylor" />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger>Profile actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Test-only profile action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
    ),
  };
});

afterEach(() => {
  locationState.pathname = '/workspace';
  locationState.search = '';
  workspaceState.identity = {
    version: 1,
    user: {
      id: 'user-1',
      name: 'Taylor',
      email: 'taylor@example.test',
      emailVerified: true,
      twoFactorEnabled: false,
      onboardingCompleted: true,
    },
    organization: {
      version: 1,
      id: 'personal-1',
      kind: 'personal',
      name: 'Personal',
      slug: 'personal',
      state: 'active',
      require2fa: false,
      role: 'owner',
      createdAt: '2026-11-01T00:00:00.000Z',
    },
    platformAdmin: false,
  };
});

test.each([
  ['absent', new URLSearchParams(), null],
  ['profile', new URLSearchParams('settings=profile'), 'profile'],
  ['appearance', new URLSearchParams('settings=appearance'), 'appearance'],
  ['security', new URLSearchParams('settings=security'), 'security'],
  ['members', new URLSearchParams('settings=members'), 'members'],
  ['invitations', new URLSearchParams('settings=invitations'), 'invitations'],
  ['general', new URLSearchParams('settings=general'), 'general'],
  ['unknown', new URLSearchParams('settings=other'), 'invalid'],
  ['empty', new URLSearchParams('settings='), 'invalid'],
  [
    'repeated',
    new URLSearchParams('settings=profile&settings=security'),
    'invalid',
  ],
  [
    'organization id is not a setting',
    new URLSearchParams('orgId=team-42'),
    null,
  ],
])('reads %s settings state', (_name, search, expected) => {
  expect(readSettingsSection(search)).toBe(expected);
});

test('settingsHref preserves unrelated query values and hash while replacing settings', () => {
  expect(
    settingsHref(
      '/workspace?filter=recent&settings=members&filter=mine#cases',
      'security',
    ),
  ).toBe('/workspace?filter=recent&filter=mine&settings=security#cases');
});

test('settingsHref removes every settings value when closing', () => {
  expect(
    settingsHref('/workspace?settings=profile&x=1&settings=security#top', null),
  ).toBe('/workspace?x=1#top');
});

test('settings final focus skips a visible menu trigger retained in a closed mobile sidebar', () => {
  const sheet = document.createElement('div');
  sheet.setAttribute('data-sidebar', 'sidebar');
  sheet.setAttribute('data-mobile', 'true');
  const opener = document.createElement('button');
  Object.defineProperty(opener, 'getClientRects', { value: () => [{}] });
  sheet.append(opener);
  const fallback = document.createElement('button');
  fallback.setAttribute('aria-label', 'Open navigation');
  Object.defineProperty(fallback, 'getClientRects', { value: () => [{}] });
  document.body.append(sheet, fallback);

  expect(getSettingsFinalFocusTarget(opener, fallback)).toBe(fallback);
  sheet.setAttribute('data-open', '');
  expect(getSettingsFinalFocusTarget(opener, fallback)).toBe(opener);
  sheet.remove();
  fallback.remove();
});

test('settings links preserve modified clicks for the browser', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const view = await render(<SettingsNavigation section="profile" />);
  const link = [
    ...view.container.querySelectorAll<HTMLAnchorElement>('a'),
  ].find((item) => item.textContent === 'Appearance')!;
  const modifiedClick = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  await act(async () => link.dispatchEvent(modifiedClick));
  expect(modifiedClick.defaultPrevented).toBe(false);
  expect(router.replace).not.toHaveBeenCalled();
  await view.unmount();
  vi.unstubAllGlobals();
});

test('renders the URL-selected account section in one settings dialog', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  locationState.search = '?filter=recent&settings=profile';
  const view = await renderWithQuery(
    <>
      <main aria-label="Workspace">Workspace page</main>
      <SettingsDialog />
    </>,
  );
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Settings');
  expect(document.body.textContent).toContain('Display name');
  expect(document.body.querySelectorAll('main')).toHaveLength(1);
  expect(document.body.querySelector('[data-slot="dialog-title"]')).toBe(
    document.activeElement,
  );
  await view.unmount();
  vi.unstubAllGlobals();
});

test('invalid settings URLs open a no-access state without account sections', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  locationState.search = '?settings=unknown';
  const view = await renderWithQuery(<SettingsDialog />);
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain(
    'You do not have access to this section.',
  );
  expect(document.body.textContent).not.toContain('Display name');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('an inner Base UI dropdown Escape closes only that layer and restores its trigger', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  locationState.search = '?settings=profile';
  const view = await renderWithQuery(<SettingsDialog />);
  const trigger = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === 'Profile actions',
  )!;
  await act(async () => trigger.click());
  expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement).toBe(trigger);
  await view.unmount();
  vi.unstubAllGlobals();
});

test.each(['invitations', 'general'] as const)(
  'a member deep-linking to %s gets no access and makes no organization request',
  async (section) => {
    const teamId = '00000000-0000-4000-8000-000000000022';
    workspaceState.identity = {
      version: 1,
      user: {
        id: 'user-1',
        name: 'Taylor',
        email: 'taylor@example.test',
        emailVerified: true,
        twoFactorEnabled: false,
        onboardingCompleted: true,
      },
      organization: {
        version: 1,
        id: teamId,
        kind: 'team',
        name: 'Hukum Nusantara',
        slug: 'hukum-nusantara',
        state: 'active',
        require2fa: false,
        role: 'member',
        createdAt: '2026-11-01T00:00:00.000Z',
      },
      platformAdmin: false,
    };
    locationState.search = '?settings=' + section;
    const fetcher = vi.fn(async () =>
      Response.json({ items: [], pageInfo: { nextCursor: null } }),
    );
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const view = await renderWithQuery(<SettingsDialog />);
    expect(document.body.textContent).toContain(
      'You do not have access to this section.',
    );
    expect(document.body.textContent).not.toContain('Invitation email');
    expect(fetcher).not.toHaveBeenCalled();
    await view.unmount();
    vi.unstubAllGlobals();
  },
);

test.each([
  ['admin', 'general'],
  ['member', 'invitations'],
  ['member', 'general'],
] as const)(
  '%s deep-linking to %s gets no access and makes no organization request',
  async (role, section) => {
    workspaceState.identity = organizationIdentity('team-a', 'Team A', role);
    locationState.search = '?settings=' + section;
    const fetcher = vi.fn(async () =>
      Response.json({ items: [], pageInfo: { nextCursor: null } }),
    );
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const view = await renderWithQuery(<SettingsDialog />);
    expect(document.body.textContent).toContain(
      'You do not have access to this section.',
    );
    expect(fetcher).not.toHaveBeenCalled();
    await view.unmount();
    vi.unstubAllGlobals();
  },
);

test('organization navigation updates owner, admin, and member links and content gates', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  locationState.search = '?settings=general';
  workspaceState.identity = organizationIdentity(TEAM_A, 'Team A', 'owner');
  const queryClient = new QueryClient();
  const view = await renderWithQuery(<SettingsDialog />, queryClient);
  expect(document.body.textContent).toContain('Organization name');
  expect(
    [
      ...document.body.querySelectorAll(
        'nav[aria-label="Settings sections"] a',
      ),
    ].map((link) => link.textContent),
  ).toEqual(expect.arrayContaining(['Members', 'Invitations', 'General']));

  workspaceState.identity = organizationIdentity(TEAM_A, 'Team A', 'admin');
  locationState.search = '?settings=invitations';
  await view.rerender(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog />
    </QueryClientProvider>,
  );
  expect(document.body.textContent).toContain('Invitation email');
  const adminLinks = [
    ...document.body.querySelectorAll('nav[aria-label="Settings sections"] a'),
  ].map((link) => link.textContent);
  expect(adminLinks).toContain('Invitations');
  expect(adminLinks).not.toContain('General');

  workspaceState.identity = organizationIdentity(TEAM_A, 'Team A', 'member');
  await view.rerender(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog />
    </QueryClientProvider>,
  );
  expect(document.body.textContent).toContain(
    'You do not have access to this section.',
  );
  const memberLinks = [
    ...document.body.querySelectorAll('nav[aria-label="Settings sections"] a'),
  ].map((link) => link.textContent);
  expect(memberLinks).toContain('Members');
  expect(memberLinks).not.toContain('Invitations');
  expect(memberLinks).not.toContain('General');
  await view.unmount();
  vi.unstubAllGlobals();
});

test('switching active organizations while Members is open drops the old query and ignores its late result', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  workspaceState.identity = organizationIdentity(TEAM_A, 'Team A', 'owner');
  locationState.search = '?settings=members';
  let releaseA!: (response: Response) => void;
  const delayedA = new Promise<Response>((resolve) => {
    releaseA = resolve;
  });
  const bResponse = Response.json({
    items: [
      {
        version: 1,
        id: '00000000-0000-4000-8000-000000000052',
        organizationId: TEAM_B,
        userId: '00000000-0000-4000-8000-000000000053',
        name: 'Bea B',
        email: 'bea@example.test',
        role: 'member',
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    pageInfo: { nextCursor: null },
  });
  const fetcher = vi.fn((input: RequestInfo | URL) =>
    String(input).includes(TEAM_A)
      ? delayedA
      : Promise.resolve(bResponse.clone()),
  );
  vi.stubGlobal('fetch', fetcher);
  const queryClient = new QueryClient();
  const view = await renderWithQuery(<SettingsDialog />, queryClient);
  expect(document.body.textContent).toContain('Members');
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .some((query) => query.queryKey.includes(TEAM_A)),
  ).toBe(true);

  workspaceState.identity = organizationIdentity(TEAM_B, 'Team B', 'owner');
  await view.rerender(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog />
    </QueryClientProvider>,
  );
  await settle();
  expect(document.body.textContent).toContain('Bea B');
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .some((query) => query.queryKey.includes(TEAM_A)),
  ).toBe(false);
  await act(async () =>
    releaseA(
      Response.json({
        items: [
          {
            version: 1,
            id: '00000000-0000-4000-8000-000000000051',
            organizationId: TEAM_A,
            userId: '00000000-0000-4000-8000-000000000054',
            name: 'Stale A',
            email: 'stale@example.test',
            role: 'member',
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        pageInfo: { nextCursor: null },
      }),
    ),
  );
  await settle();
  expect(document.body.textContent).not.toContain('Stale A');
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .some((query) => query.queryKey.includes(TEAM_A)),
  ).toBe(false);
  await view.unmount();
  vi.unstubAllGlobals();
});

test('switching active organizations resets the General form draft', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  locationState.search = '?settings=general';
  workspaceState.identity = organizationIdentity(TEAM_A, 'Team A', 'owner');
  const queryClient = new QueryClient();
  const view = await renderWithQuery(<SettingsDialog />, queryClient);
  const input = document.querySelector<HTMLInputElement>('#organization-name')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, 'Unsaved Team A draft');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(input.value).toBe('Unsaved Team A draft');
  workspaceState.identity = organizationIdentity(TEAM_B, 'Team B', 'owner');
  await view.rerender(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog />
    </QueryClientProvider>,
  );
  await settle();
  expect(
    document.querySelector<HTMLInputElement>('#organization-name')?.value,
  ).toBe('Team B');
  await view.unmount();
  vi.unstubAllGlobals();
});

function organizationIdentity(
  id: string,
  name: string,
  role: 'owner' | 'admin' | 'member',
) {
  return {
    version: 1,
    user: {
      id: 'user-1',
      name: 'Taylor',
      email: 'taylor@example.test',
      emailVerified: true,
      twoFactorEnabled: false,
      onboardingCompleted: true,
    },
    organization: {
      version: 1,
      id,
      kind: 'team',
      name,
      slug: name.toLowerCase().replaceAll(' ', '-'),
      state: 'active',
      require2fa: false,
      role,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
    platformAdmin: false,
  } as const;
}

test('demotion cancels and removes a delayed invitation response while Settings stays open', async () => {
  const teamId = '00000000-0000-4000-8000-000000000022';
  const identity = (role: 'owner' | 'member') => ({
    version: 1,
    user: {
      id: 'user-1',
      name: 'Taylor',
      email: 'taylor@example.test',
      emailVerified: true,
      twoFactorEnabled: false,
      onboardingCompleted: true,
    },
    organization: {
      version: 1,
      id: teamId,
      kind: 'team',
      name: 'Hukum Nusantara',
      slug: 'hukum-nusantara',
      state: 'active',
      require2fa: false,
      role,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
    platformAdmin: false,
  });
  workspaceState.identity = identity('owner');
  locationState.search = '?settings=invitations';
  let release!: (response: Response) => void;
  const delayed = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetcher = vi.fn(() => delayed);
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const queryClient = new QueryClient();
  const view = await renderWithQuery(<SettingsDialog />, queryClient);
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey),
  ).toContainEqual(['tenant', teamId, 'invitations', 'start']);

  workspaceState.identity = identity('member');
  await view.rerender(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog />
    </QueryClientProvider>,
  );
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain(
    'You do not have access to this section.',
  );
  expect(document.body.textContent).not.toContain('stale@example.test');
  expect(
    queryClient.getQueryCache().find({ queryKey: ['tenant', teamId] }),
  ).toBeUndefined();

  await act(async () =>
    release(
      Response.json({
        items: [
          {
            version: 1,
            id: '00000000-0000-4000-8000-000000000032',
            organizationId: teamId,
            organizationName: 'Hukum Nusantara',
            email: 'stale@example.test',
            role: 'member',
            purpose: 'team',
            status: 'pending',
            createdAt: '2026-11-01T00:00:00.000Z',
            expiresAt: '2026-11-08T00:00:00.000Z',
          },
        ],
        pageInfo: { nextCursor: null },
      }),
    ),
  );
  await settle();
  expect(document.body.textContent).not.toContain('stale@example.test');
  expect(
    queryClient.getQueryCache().find({ queryKey: ['tenant', teamId] }),
  ).toBeUndefined();
  await view.unmount();
  vi.unstubAllGlobals();
});
