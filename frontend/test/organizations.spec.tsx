import { test, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from './render';
import type { OrganizationSummary } from '@lexon/contracts';
import { OrganizationSettings } from '../src/components/organizations/organization-settings';
import { OrganizationPage } from '../src/components/organizations/organization-page';
const workspaceState = vi.hoisted(() => ({ identity: null as unknown }));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({ identity: workspaceState.identity }),
}));
const personal: OrganizationSummary = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Private name',
  slug: 'internal-personal',
  kind: 'personal',
  state: 'active',
  require2fa: false,
  role: 'owner',
  createdAt: '2026-11-01T00:00:00Z',
};
const team: OrganizationSummary = {
  ...personal,
  id: '00000000-0000-4000-8000-000000000002',
  kind: 'team',
  name: 'Protected team',
  slug: 'protected-team',
  role: 'member',
  require2fa: true,
};
test('Personal and nonowners have no organization edit or invitation controls', async () => {
  for (const organization of [personal, team]) {
    const view = await render(
      <OrganizationSettings organization={organization} />,
    );
    expect(view.container.querySelector('form')).toBeNull();
    await view.unmount();
  }
});

test('organization route gates deny unauthorized sections before protected data loads', async () => {
  const member = {
    version: 1 as const,
    user: {
      version: 1 as const,
      id: '00000000-0000-4000-8000-000000000003',
      email: 'member@example.test',
      name: 'Team Member',
      emailVerified: true,
      twoFactorEnabled: false,
      onboardingCompleted: true,
    },
    organization: { ...team, role: 'member' as const },
    platformAdmin: false,
  };
  const unauthorized = [
    { organizationId: team.id, view: 'invitations' as const },
    { organizationId: team.id, view: 'general' as const },
    {
      organizationId: '00000000-0000-4000-8000-000000000099',
      view: 'members' as const,
    },
    {
      organizationId: personal.id,
      view: 'general' as const,
      identity: { ...member, organization: personal },
    },
  ];
  const fetcher = vi.fn(async () => {
    throw new Error('protected organization fetch should not run');
  });
  vi.stubGlobal('fetch', fetcher);
  for (const item of unauthorized) {
    workspaceState.identity = item.identity ?? member;
    const view = await render(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationPage
          organizationId={item.organizationId}
          view={item.view}
        />
      </QueryClientProvider>,
    );
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await view.unmount();
  }
  vi.unstubAllGlobals();
});

test('role refresh removes a formerly allowed settings view and its cached data', async () => {
  const owner = {
    version: 1 as const,
    user: {
      version: 1 as const,
      id: '00000000-0000-4000-8000-000000000003',
      email: 'owner@example.test',
      name: 'Team Owner',
      emailVerified: true,
      twoFactorEnabled: false,
      onboardingCompleted: true,
    },
    organization: { ...team, role: 'owner' as const },
    platformAdmin: false,
  };
  const queryClient = new QueryClient();
  const protectedKey = ['tenant', team.id, 'members', 'start'] as const;
  queryClient.setQueryData(protectedKey, { items: ['protected'] });
  workspaceState.identity = owner;
  const view = await render(
    <QueryClientProvider client={queryClient}>
      <OrganizationPage organizationId={team.id} view="general" />
    </QueryClientProvider>,
  );
  expect(view.container.textContent).toContain('Organization settings');
  workspaceState.identity = {
    ...owner,
    organization: { ...team, role: 'member' },
  };
  await view.rerender(
    <QueryClientProvider client={queryClient}>
      <OrganizationPage organizationId={team.id} view="general" />
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  expect(queryClient.getQueryData(protectedKey)).toBeUndefined();
  await view.unmount();
});

test('lost organization context retains F1 recovery copy and workspace link without loading old data', async () => {
  workspaceState.identity = {
    version: 1,
    user: {
      version: 1,
      id: '00000000-0000-4000-8000-000000000003',
      email: 'member@example.test',
      name: 'Team Member',
      emailVerified: true,
      twoFactorEnabled: false,
      onboardingCompleted: true,
    },
    organization: personal,
    platformAdmin: false,
  };
  const fetcher = vi.fn(async () => {
    throw new Error('old organization data should not load');
  });
  vi.stubGlobal('fetch', fetcher);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationPage organizationId={team.id} view="members" />
    </QueryClientProvider>,
  );
  expect(view.container.textContent).toContain(
    'You no longer have access to this organization in the current workspace. Personal is selected.',
  );
  expect(view.container.querySelector('a[href="/workspace"]')).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  await view.unmount();
  vi.unstubAllGlobals();
});
