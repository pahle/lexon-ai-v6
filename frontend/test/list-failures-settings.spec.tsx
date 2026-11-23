import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrganizationSummary } from '@lexon/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { Members } from '../src/components/organizations/members';
import { Invitations } from '../src/components/organizations/invitations';
import { AccountSecurity } from '../src/components/auth/account-security';
import { render, settle, settleUntil } from './render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: {
      user: { id: '00000000-0000-4000-8000-0000000000aa', email: 'a@b.test' },
    },
    refreshIdentity: vi.fn(async () => {}),
  }),
}));
vi.mock('../src/lib/auth-client', () => ({ authClient: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.unstubAllGlobals());

const team: OrganizationSummary = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Hukum Nusantara',
  slug: 'hukum-nusantara',
  kind: 'team',
  state: 'active',
  require2fa: false,
  role: 'owner',
  createdAt: '2026-11-01T00:00:00Z',
};
const down = () =>
  Response.json(
    { error: { code: 'AUTH_UNAVAILABLE', message: 'Unavailable' } },
    { status: 503 },
  );
const member = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000010',
  userId: '00000000-0000-4000-8000-0000000000bb',
  organizationId: team.id,
  name: 'Dewi Lestari',
  email: 'dewi@hukum.test',
  role: 'member',
  createdAt: '2026-11-01T00:00:00.000Z',
};
const invitation = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000020',
  organizationId: team.id,
  organizationName: team.name,
  email: 'rina@hukum.test',
  role: 'member',
  purpose: 'team',
  status: 'pending',
  createdAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2026-11-08T00:00:00.000Z',
};
const security = {
  version: 1,
  twoFactorEnabled: false,
  mfaVerified: false,
  reauthenticationExpiresAt: null,
  recoveryCodesRemaining: 0,
  passwordChangedAt: '2026-09-18T12:00:00.000Z',
};
const session = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000003',
  channel: 'cookie',
  createdAt: '2026-11-01T00:00:00Z',
  expiresAt: '2026-11-08T00:00:00Z',
  current: true,
  deviceName: 'Chrome on macOS',
  deviceKind: 'desktop',
};

type Route = (path: string) => Response | undefined;
/** First call of each failing route fails; later calls succeed. */
function stubFetch(routes: { failFirst: string; ok: Route }) {
  const seen = new Map<string, number>();
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).pathname;
    const count = (seen.get(path) ?? 0) + 1;
    seen.set(path, count);
    if (path.endsWith(routes.failFirst) && count === 1) return down();
    const response = routes.ok(path);
    if (response) return response;
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
);
const retry = (c: HTMLElement) =>
  [...c.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Try again',
  );
const alerts = (c: HTMLElement) =>
  [...c.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
const page = (items: unknown[]) =>
  Response.json({ items, pageInfo: { nextCursor: null } });

it('members: a failed fetch shows "We could not load members." with Try again, never Empty', async () => {
  stubFetch({ failFirst: '/members', ok: () => page([member]) });
  const view = await render(wrap(<Members organization={team} />));
  await settle();
  expect(alerts(view.container).join()).toContain('We could not load members.');
  expect(retry(view.container)).toBeDefined();
  expect(view.container.textContent).not.toContain('No members');
  await view.unmount();
});

it('members: when the list fails the subtitle names the organization without a count', async () => {
  stubFetch({ failFirst: '/members', ok: () => page([member]) });
  const view = await render(wrap(<Members organization={team} />));
  await settle();
  expect(view.container.textContent).toContain('People in Hukum Nusantara.');
  expect(view.container.textContent).not.toMatch(/\d+ members? in/);
  await view.unmount();
});

it('members: when the list fails Leave organization is hidden (last-owner eligibility needs the list)', async () => {
  stubFetch({ failFirst: '/members', ok: () => page([member]) });
  const view = await render(wrap(<Members organization={team} />));
  await settle();
  const buttons = [...view.container.querySelectorAll('button')].map(
    (b) => b.textContent,
  );
  expect(buttons).not.toContain('Leave organization');
  await view.unmount();
});

it('members: Try again refetches and the list renders', async () => {
  stubFetch({ failFirst: '/members', ok: () => page([member]) });
  const view = await render(wrap(<Members organization={team} />));
  await settle();
  await act(async () => retry(view.container)!.click());
  await settle();
  expect(view.container.textContent).toContain('Dewi Lestari');
  expect(alerts(view.container).join()).not.toContain('We could not load');
  await view.unmount();
});

it('invitations: a failed fetch shows "We could not load invitations." with Try again, never Empty', async () => {
  stubFetch({ failFirst: '/invitations', ok: () => page([invitation]) });
  const view = await render(wrap(<Invitations organization={team} />));
  await settle();
  expect(alerts(view.container).join()).toContain(
    'We could not load invitations.',
  );
  expect(retry(view.container)).toBeDefined();
  expect(view.container.textContent).not.toContain('No pending invitations');
  await view.unmount();
});

it('invitations: Try again refetches and the list renders', async () => {
  stubFetch({ failFirst: '/invitations', ok: () => page([invitation]) });
  const view = await render(wrap(<Invitations organization={team} />));
  await settle();
  await act(async () => retry(view.container)!.click());
  await settle();
  expect(view.container.textContent).toContain('rina@hukum.test');
  await view.unmount();
});

const securityOk: Route = (path) =>
  path === '/api/identity/security'
    ? Response.json(security)
    : path === '/api/identity/sessions'
      ? Response.json([session])
      : undefined;

it('sessions: a failed fetch shows "We could not load sessions." under its own heading, never Empty, and the rest of security stays', async () => {
  stubFetch({ failFirst: '/sessions', ok: securityOk });
  const view = await render(wrap(<AccountSecurity />));
  // security resolves first, then sessions is requested: wait for the outcome.
  await settleUntil(() => alerts(view.container).length > 0);
  expect(alerts(view.container).join()).toContain(
    'We could not load sessions.',
  );
  expect(retry(view.container)).toBeDefined();
  expect(view.container.textContent).toContain('Where you are signed in');
  expect(view.container.textContent).not.toContain('No active sessions');
  await view.unmount();
});

it('sessions: Try again refetches and the list renders', async () => {
  stubFetch({ failFirst: '/sessions', ok: securityOk });
  const view = await render(wrap(<AccountSecurity />));
  await settleUntil(() => retry(view.container) !== undefined);
  await act(async () => retry(view.container)!.click());
  await settleUntil(
    () => !!view.container.textContent?.includes('Chrome on macOS'),
  );
  expect(view.container.textContent).toContain('Chrome on macOS');
  await view.unmount();
});
