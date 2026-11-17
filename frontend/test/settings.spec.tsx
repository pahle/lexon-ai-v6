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
        jobTitle: null,
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
      organizationMemberCount: null,
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
    jobTitle: null,
    onboardingCompleted: true,
  });
  const view = await render(<ProfileSettings />);
  expect(
    view.container.querySelector('input[aria-label="Email address"]'),
  ).toBeNull();
  expect(view.container.textContent).toContain('person@example.test');
  expect(view.container.textContent).not.toContain('Active organization');
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
  expect(update).toHaveBeenCalledWith({ name: 'New Name', jobTitle: null });
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
  expect(field.className).not.toContain('text-destructive');
  expect(field.className).toContain('data-[invalid=true]:text-foreground');
  expect(name.getAttribute('aria-describedby')).toBe(
    'profile-display-name-error',
  );
  expect(
    field.querySelector('[data-slot="field-error"]')?.textContent,
  ).toBeTruthy();
  expect(
    field.querySelector('[data-slot="field-error"]')?.className.split(' '),
  ).toContain('text-destructive');
  await view.unmount();
});

async function typeInto(input: HTMLInputElement, value: string) {
  const { act } = await import('react');
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function submitForm(container: HTMLElement) {
  const { act } = await import('react');
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
const savedProfile = {
  version: 1 as const,
  id: '00000000-0000-4000-8000-000000000001',
  email: 'person@example.test',
  name: 'Taylor Person',
  emailVerified: true,
  twoFactorEnabled: false,
  jobTitle: null,
  onboardingCompleted: true,
};

test('profile settings shows a Job title field with its description', async () => {
  const view = await render(<ProfileSettings />);
  const job = view.container.querySelector('#profile-job-title');
  expect(job).not.toBeNull();
  expect(view.container.textContent).toContain('Job title');
  expect(view.container.textContent).toContain(
    'Shown under your name in the sidebar.',
  );
  expect(
    view.container.querySelector('label[for="profile-job-title"]')?.textContent,
  ).toBe('Job title');
  await view.unmount();
});

test('profile settings trims the job title before saving', async () => {
  const update = vi
    .spyOn(identityApi, 'updateProfile')
    .mockResolvedValue(savedProfile);
  const view = await render(<ProfileSettings />);
  await typeInto(
    view.container.querySelector('#profile-job-title') as HTMLInputElement,
    '  Partner ',
  );
  await submitForm(view.container);
  expect(update).toHaveBeenCalledWith({
    name: 'Taylor Person',
    jobTitle: 'Partner',
  });
  expect(refreshIdentity).toHaveBeenCalled();
  expect(successToast).toHaveBeenCalledWith('Changes saved.');
  await view.unmount();
  update.mockRestore();
  refreshIdentity.mockClear();
  successToast.mockClear();
});

test('clearing the job title saves null', async () => {
  const update = vi
    .spyOn(identityApi, 'updateProfile')
    .mockResolvedValue(savedProfile);
  const view = await render(<ProfileSettings />);
  const job = view.container.querySelector(
    '#profile-job-title',
  ) as HTMLInputElement;
  await typeInto(job, 'Partner');
  await typeInto(job, '');
  await submitForm(view.container);
  expect(update).toHaveBeenCalledWith({
    name: 'Taylor Person',
    jobTitle: null,
  });
  await view.unmount();
  update.mockRestore();
  refreshIdentity.mockClear();
  successToast.mockClear();
});

test('a job title over 80 characters shows an error and does not call the API', async () => {
  const update = vi
    .spyOn(identityApi, 'updateProfile')
    .mockResolvedValue(savedProfile);
  const view = await render(<ProfileSettings />);
  const job = view.container.querySelector(
    '#profile-job-title',
  ) as HTMLInputElement;
  await typeInto(job, 'x'.repeat(81));
  await submitForm(view.container);
  expect(update).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain('Use 80 characters or fewer.');
  expect(job.getAttribute('aria-invalid')).toBe('true');
  const describedBy = job.getAttribute('aria-describedby')!;
  expect(describedBy).toBeTruthy();
  expect(view.container.querySelector(`#${describedBy}`)?.textContent).toBe(
    'Use 80 characters or fewer.',
  );
  await view.unmount();
  update.mockRestore();
});

test('profile title is a serif h2 and each row separates label from control', async () => {
  const view = await render(<ProfileSettings />);
  const heading = view.container.querySelector('h2');
  expect(heading?.textContent).toBe('Profile');
  expect(heading?.className).toContain('font-serif');
  const rows = [...view.container.querySelectorAll('[data-slot="field"]')];
  expect(rows).toHaveLength(3);
  for (const row of rows) expect(row.className).toContain('border-b');
  await view.unmount();
});
