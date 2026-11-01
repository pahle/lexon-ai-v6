import { test, expect, vi } from 'vitest';
import { act, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IdentitySummary } from '@lexon/contracts';
import { render, settle } from './render';
import {
  WorkspaceProvider,
  useWorkspace,
} from '../src/components/shell/workspace-provider';
import { WorkspaceShell } from '../src/components/shell/workspace-shell';
import { identityApi } from '../src/components/organizations/page-state';
const routePath = vi.hoisted(() => ({ current: '/workspace' }));
vi.mock('next/navigation', () => ({ usePathname: () => routePath.current }));

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
      <button onClick={() => setRevision((value) => value + 1)}>
        Rerender child {revision}
      </button>
      {workspace.identity?.organization.role === 'owner' ? (
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
  const client = new QueryClient();
  routePath.current = '/workspace';
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
  routePath.current = '/account/security';
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
  routePath.current = '/workspace';
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

test('a later distinct fallback is announced once after the previous notice clears', async () => {
  const client = new QueryClient();
  const view = await render(
    <Harness
      client={client}
      initial={{ ...identity, fallbackReason: 'membership_removed' }}
    />,
  );
  await act(async () => {
    client.setQueryData(['identity'], identity);
  });
  await settle();
  expect(view.container.textContent).not.toContain('no longer have access');
  await act(async () => {
    client.setQueryData(['identity'], {
      ...identity,
      fallbackReason: 'selection_repaired',
    });
  });
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
