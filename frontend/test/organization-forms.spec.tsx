import { act } from 'react';
import { vi, test, expect } from 'vitest';
import { render, settle } from './render';
import { IdentityClientError } from '../src/lib/identity-client';

const api = vi.hoisted(() => ({ createOrganization: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('../src/components/organizations/page-state', () => ({
  identityApi: api,
  identityMessage: () =>
    'Unable to complete this action. Refresh and check your access.',
}));
vi.mock('sonner', () => ({ toast }));
import { CreateTeam } from '../src/components/organizations/create-team';

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('Create team shows pending feedback and toasts after the existing API call succeeds', async () => {
  let release!: () => void;
  api.createOrganization.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const view = await render(<CreateTeam />);
  await fill(
    view.container.querySelector('input[name="name"]')!,
    'Hukum Nusantara',
  );
  await fill(
    view.container.querySelector('input[name="slug"]')!,
    'hukum-nusantara',
  );
  await act(async () =>
    view.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle();
  const submit = view.container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!;
  expect(submit.disabled).toBe(true);
  expect(submit.textContent).toContain('Creating team…');
  await act(async () => release());
  await settle();
  expect(api.createOrganization).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith(
    'Team created. Your current organization is unchanged.',
  );
  await view.unmount();
});

test('a 409 ORG_SLUG_TAKEN response becomes the slug field error, not a form alert', async () => {
  api.createOrganization.mockRejectedValue(
    new IdentityClientError('ORG_SLUG_TAKEN', 409),
  );
  const view = await render(<CreateTeam />);
  await fill(view.container.querySelector('input[name="name"]')!, 'Hukum');
  await fill(view.container.querySelector('input[name="slug"]')!, 'hukum');
  await act(async () =>
    view.container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle();
  const error = view.container.querySelector('#slug-error, [id$="-error"]');
  expect(error?.textContent).toBe(
    'That team slug is already taken. Choose another.',
  );
  expect(
    view.container.querySelector('[role="alert"]')?.textContent ?? '',
  ).not.toContain('Unable to complete');
  await view.unmount();
});
