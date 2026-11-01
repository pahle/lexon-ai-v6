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
import { identityApi } from '../src/components/organizations/page-state';
import { IdentityClientError } from '../src/lib/identity-client';
const navigation = vi.hoisted(() => ({
  path: '/workspace',
  replace: vi.fn(),
  router: { replace: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.path,
  useRouter: () => navigation.router,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  navigation.path = '/workspace';
  navigation.router.replace.mockClear();
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
      workspace.identity.organization.role === 'owner' ? (
        <p>Old private members</p>
      ) : null}
    </>
  );
}

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
    restricted.container.querySelector('a[href="/account/security"]'),
  ).not.toBeNull();
  await restricted.unmount();
  identityCall.mockRestore();
  const securityIdentityCall = vi
    .spyOn(identityApi, 'identity')
    .mockRejectedValue(new IdentityClientError('AUTH_2FA_REQUIRED', 403));
  navigation.path = '/account/security';
  const recovery = await render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceProvider bootstrap={{ status: 'mfa-required' }}>
        <WorkspaceShell>
          <p>Recovery controls</p>
        </WorkspaceShell>
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
  expect(recovery.container.textContent).toContain('Recovery controls');
  await recovery.unmount();
  securityIdentityCall.mockRestore();
  navigation.path = '/workspace';
});

test('security recovery works at both preserved paths and keeps direct sign-in verification available', async () => {
  for (const path of ['/account/security', '/settings/security']) {
    const identityCall = vi
      .spyOn(identityApi, 'identity')
      .mockRejectedValue(new IdentityClientError('AUTH_2FA_REQUIRED', 403));
    navigation.path = path;
    const view = await render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceProvider bootstrap={{ status: 'mfa-required' }}>
          <WorkspaceShell>
            <p>Recovery controls</p>
          </WorkspaceShell>
        </WorkspaceProvider>
      </QueryClientProvider>,
    );
    expect(view.container.textContent).toContain('Recovery controls');
    expect(
      view.container.querySelector(
        'a[href="/two-factor?returnTo=%2Faccount%2Fsecurity"]',
      ),
    ).not.toBeNull();
    await view.unmount();
    identityCall.mockRestore();
  }
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
    view.container.querySelector('a[href="/account/security"]'),
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

test('panel host is a named aside beside a focusable main', async () => {
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
  expect(main?.contains(host)).toBe(false);
  expect(host?.closest('aside[aria-label="Context panel"]')).toBeNull();
  expect(main?.tabIndex).toBe(-1);
  expect(main?.parentElement?.className).toContain('min-w-0');
  expect(view.container.querySelectorAll('main')).toHaveLength(1);
  expect(host?.getAttribute('class') ?? '').not.toMatch(/w-80|w-full/);
  await view.unmount();
});
