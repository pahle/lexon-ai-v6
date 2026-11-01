import { test, expect, vi } from 'vitest';
import { render } from './render';
import { SectionNavigation } from '../src/components/settings/section-navigation';
import { ProfileSettings } from '../src/components/settings/profile-settings';
import { identityApi } from '../src/components/organizations/page-state';

const refreshIdentity = vi.fn(async () => {});
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: {
      version: 1,
      user: {
        version: 1,
        id: '00000000-0000-4000-8000-000000000001',
        email: 'person@example.test',
        name: 'Taylor Person',
        emailVerified: true,
        twoFactorEnabled: false,
        onboardingCompleted: true,
      },
      organization: {
        version: 1,
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Personal',
        slug: 'personal',
        kind: 'personal',
        state: 'active',
        require2fa: false,
        role: 'owner',
        createdAt: '2026-11-01T00:00:00Z',
      },
      platformAdmin: false,
    },
    refreshIdentity,
  }),
}));

test('section navigation uses actionable links and marks the current route', async () => {
  const view = await render(
    <SectionNavigation
      items={[
        { href: '/settings/profile', label: 'Profile', current: false },
        { href: '/settings/security', label: 'Security', current: true },
      ]}
    />,
  );
  const links = [...view.container.querySelectorAll('a')];
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/settings/profile',
    '/settings/security',
  ]);
  expect(links[1]?.getAttribute('aria-current')).toBe('page');
  expect(view.container.querySelector('select')).toBeNull();
  expect(links.every((link) => /min-h-11/.test(link.className))).toBe(true);
  expect(view.container.querySelector('nav')?.className).toContain('min-w-0');
  await view.unmount();
});

test('profile settings updates a validated display name and keeps email read-only', async () => {
  const update = vi.spyOn(identityApi, 'updateProfile').mockResolvedValue({
    version: 1,
    id: '00000000-0000-4000-8000-000000000001',
    email: 'person@example.test',
    name: 'New Name',
    emailVerified: true,
    twoFactorEnabled: false,
    onboardingCompleted: true,
  });
  const view = await render(<ProfileSettings />);
  const email = view.container.querySelector(
    'input[aria-label="Email address"]',
  ) as HTMLInputElement;
  expect(email.readOnly).toBe(true);
  expect(email.value).toBe('person@example.test');
  expect(view.container.querySelector('a[href="/settings/security"]')).not.toBe(
    null,
  );
  const name = view.container.querySelector(
    'input[autocomplete="name"]',
  ) as HTMLInputElement;
  await import('react').then(async ({ act }) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(name, 'New Name');
      name.dispatchEvent(new Event('input', { bubbles: true }));
      name.dispatchEvent(new Event('change', { bubbles: true }));
      view.container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
  });
  expect(update).toHaveBeenCalledWith({ name: 'New Name' });
  expect(refreshIdentity).toHaveBeenCalled();
  await view.unmount();
  update.mockRestore();
  refreshIdentity.mockClear();
});
