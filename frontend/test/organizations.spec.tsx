import { test, expect } from 'vitest';
import { render } from './render';
import type { OrganizationSummary } from '@lexon/contracts';
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
test('Personal and nonowners have no organization edit or invitation controls', async () => {
  for (const organization of [personal, team]) {
    const view = await render(
      <OrganizationSettings organization={organization} />,
    );
    expect(view.container.querySelector('form')).toBeNull();
    await view.unmount();
  }
});
