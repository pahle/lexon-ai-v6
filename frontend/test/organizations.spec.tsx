import { test, expect, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle } from './render';
import type { OrganizationSummary } from '@lexon/contracts';
import { OrganizationSwitcher } from '../src/components/organizations/organization-switcher';
import { OrganizationSettings } from '../src/components/organizations/organization-settings';
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
test('blocked 2FA switch preserves Personal and uses no client target credential', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      status: 'enrollment_required',
      organization: personal,
      pendingOrganizationId: team.id,
    }),
  );
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationSwitcher
        organizations={[personal, team]}
        current={personal}
      />
    </QueryClientProvider>,
  );
  const button = [...view.container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Protected team'),
  )!;
  await act(async () => button.click());
  await settle();
  expect(
    view.container.querySelector('[data-testid="active-organization"]')
      ?.textContent,
  ).toBe('Personal');
  expect(
    view.container.querySelector('a[href="/account/security"]'),
  ).not.toBeNull();
  expect(view.container.textContent).not.toContain('internal-personal');
  await view.unmount();
  vi.unstubAllGlobals();
});
test('Personal and nonowners have no organization edit or invitation controls', async () => {
  for (const organization of [personal, team]) {
    const view = await render(
      <OrganizationSettings organization={organization} />,
    );
    expect(view.container.querySelector('form')).toBeNull();
    await view.unmount();
  }
});
