import { act } from 'react';
import type { OrganizationSummary } from '@lexon/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileSettings } from '../src/components/settings/profile-settings';
import { OrganizationSettings } from '../src/components/organizations/organization-settings';
import { render, settle } from './render';

const refreshIdentity = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: {
      user: {
        id: '00000000-0000-4000-8000-0000000000aa',
        name: 'Ayu Wardani',
        jobTitle: 'Senior Associate',
        email: 'ayu@hukum.test',
      },
    },
    refreshIdentity,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const profileFailure =
  'We could not save your profile. Your changes are still here. Try again.';
const org: OrganizationSummary = {
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
const savedProfile = {
  version: 1,
  id: '00000000-0000-4000-8000-0000000000aa',
  email: 'ayu@hukum.test',
  name: 'Ayu Wardani',
  emailVerified: true,
  twoFactorEnabled: false,
  jobTitle: 'Partner',
  onboardingCompleted: true,
};

let responses: Array<() => Response>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  refreshIdentity.mockClear();
  fetcher = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    return next();
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

const down = () =>
  Response.json(
    { error: { code: 'AUTH_UNAVAILABLE', message: 'Unavailable' } },
    { status: 503 },
  );
const slugTaken = () =>
  Response.json(
    { error: { code: 'ORG_SLUG_TAKEN', message: 'Taken' } },
    { status: 409 },
  );

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const save = (c: HTMLElement) =>
  c.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const input = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLInputElement>(`#${id}`)!;
const alertText = (c: HTMLElement) =>
  c.querySelector('[role="alert"]')?.textContent ?? '';

it('profile: a failed save shows the form alert above the fields, keeps the typed value, and leaves Save enabled', async () => {
  responses = [down];
  const view = await render(<ProfileSettings />);
  await type(input(view.container, 'profile-job-title'), 'Partner');
  await act(async () => save(view.container).click());
  await settle();
  expect(alertText(view.container)).toBe(profileFailure);
  const alert = view.container.querySelector('[role="alert"]')!;
  const firstField = view.container.querySelector('#profile-display-name')!;
  expect(
    alert.compareDocumentPosition(firstField) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(input(view.container, 'profile-job-title').value).toBe('Partner');
  expect(save(view.container).disabled).toBe(false);
  await view.unmount();
});

it('profile: retry saves', async () => {
  responses = [down, () => Response.json(savedProfile)];
  const view = await render(<ProfileSettings />);
  await type(input(view.container, 'profile-job-title'), 'Partner');
  await act(async () => save(view.container).click());
  await settle();
  await act(async () => save(view.container).click());
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(refreshIdentity).toHaveBeenCalledTimes(1);
  expect(alertText(view.container)).toBe('');
  expect(input(view.container, 'profile-job-title').value).toBe('Partner');
  await view.unmount();
});

it('profile: with the form alert shown, the first row sits 16px under it (prototype .falert then .srow), so the group pulls up the 12px gap', async () => {
  responses = [down];
  const view = await render(<ProfileSettings />);
  const group = () =>
    view.container.querySelector('[role="alert"]')?.nextElementSibling;
  expect(view.container.querySelector('[role="alert"]')).toBeNull();
  await act(async () => save(view.container).click());
  await settle();
  expect(group()?.className).toContain('-mt-3');
  await view.unmount();
});

it('organization General: a failed save shows the form alert above the fields, keeps the typed value, and leaves Save enabled', async () => {
  responses = [down];
  const view = await render(<OrganizationSettings organization={org} />);
  await type(input(view.container, 'organization-name'), 'Hukum Nusantara LLP');
  await act(async () => save(view.container).click());
  await settle();
  expect(alertText(view.container)).toBe(
    'We could not save the organization settings. Your changes are still here. Try again.',
  );
  expect(input(view.container, 'organization-name').value).toBe(
    'Hukum Nusantara LLP',
  );
  expect(save(view.container).disabled).toBe(false);
  await view.unmount();
});

it('organization General: retry saves', async () => {
  responses = [
    down,
    () => Response.json({ ...org, name: 'Hukum Nusantara LLP' }),
  ];
  const view = await render(<OrganizationSettings organization={org} />);
  await type(input(view.container, 'organization-name'), 'Hukum Nusantara LLP');
  await act(async () => save(view.container).click());
  await settle();
  await act(async () => save(view.container).click());
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(alertText(view.container)).toBe('');
  await view.unmount();
});

it('organization General: a slug the server rejected reverts with its own field error; the name stays', async () => {
  responses = [slugTaken];
  const view = await render(<OrganizationSettings organization={org} />);
  await type(input(view.container, 'organization-name'), 'Hukum Nusantara LLP');
  await type(input(view.container, 'organization-slug'), 'taken-slug');
  await act(async () => save(view.container).click());
  await settle();
  expect(input(view.container, 'organization-slug').value).toBe(
    'hukum-nusantara',
  );
  expect(
    view.container.querySelector('#organization-slug-error')?.textContent,
  ).toBeTruthy();
  expect(input(view.container, 'organization-name').value).toBe(
    'Hukum Nusantara LLP',
  );
  expect(save(view.container).disabled).toBe(false);
  await view.unmount();
});
