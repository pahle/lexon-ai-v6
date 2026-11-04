import { test, expect, vi } from 'vitest';
import { render } from './render';
import { SettingsNavigation } from '../src/components/settings/settings-navigation';
import { ProfileSettings } from '../src/components/settings/profile-settings';
import { identityApi } from '../src/components/organizations/page-state';

const refreshIdentity = vi.fn(async () => {});
const successToast = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/workspace',
}));
vi.mock('sonner', () => ({ toast: { success: successToast } }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));
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
        name: 'Personal internal name',
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

test('settings navigation uses actionable section links and marks the current section', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const view = await render(<SettingsNavigation section="security" />);
  const links = [...view.container.querySelectorAll('a')];
  expect(links.map((link) => link.textContent)).toEqual([
    'Profile',
    'Appearance',
    'Security',
  ]);
  expect(links[2]?.getAttribute('aria-current')).toBe('page');
  expect(view.container.querySelector('select')).toBeNull();
  expect(links.every((link) => link.hasAttribute('data-slot'))).toBe(true);
  expect(view.container.querySelector('nav')?.className).toContain('min-w-0');
  await view.unmount();
  vi.unstubAllGlobals();
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
  expect(
    view.container.querySelector('input[aria-label="Email address"]'),
  ).toBeNull();
  expect(view.container.textContent).toContain('person@example.test');
  expect(view.container.textContent).toContain('Active organization');
  expect(view.container.textContent).toContain('Personal');
  expect(view.container.textContent).not.toContain('Personal internal name');
  expect(
    view.container.querySelector('a[href*="settings=security"]'),
  ).toBeNull();
  expect(view.container.querySelector('p[role="status"]')).toBeNull();
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
  expect(successToast).toHaveBeenCalledWith('Changes saved.');
  expect(view.container.textContent).not.toContain(
    'Manage your account details.',
  );
  expect(
    view.container
      .querySelector('button[type="submit"] > span > span:last-child')
      ?.textContent?.trim(),
  ).toBe('Save');
  expect(view.container.querySelector('p[role="status"]')).toBeNull();
  await view.unmount();
  update.mockRestore();
  refreshIdentity.mockClear();
  successToast.mockClear();
});

test('profile save failures render a safe alert before profile rows', async () => {
  const update = vi
    .spyOn(identityApi, 'updateProfile')
    .mockRejectedValue(new Error('private server detail'));
  const view = await render(<ProfileSettings />);
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
  const alert = view.container.querySelector('[role="alert"]')!;
  expect(alert).not.toBeNull();
  expect(alert.querySelector('[data-slot="alert-title"]')?.textContent).toBe(
    'Unable to save your profile',
  );
  expect(alert.textContent).not.toContain('private server detail');
  expect(
    alert.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await view.unmount();
  update.mockRestore();
});

test('invalid profile name uses the shared Field error and destructive label state', async () => {
  const view = await render(<ProfileSettings />);
  const name = view.container.querySelector(
    'input[autocomplete="name"]',
  ) as HTMLInputElement;
  await import('react').then(async ({ act }) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(name, '');
      name.dispatchEvent(new Event('input', { bubbles: true }));
      name.dispatchEvent(new Event('change', { bubbles: true }));
      view.container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
  });
  const field = name.closest('[data-slot="field"]')!;
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(field.getAttribute('data-invalid')).toBe('true');
  expect(field.className).toContain('data-[invalid=true]:text-destructive');
  expect(name.getAttribute('aria-describedby')).toBe(
    'profile-display-name-error',
  );
  expect(
    field.querySelector('[data-slot="field-error"]')?.textContent,
  ).toBeTruthy();
  await view.unmount();
});
