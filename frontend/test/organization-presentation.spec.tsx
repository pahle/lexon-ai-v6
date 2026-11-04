import { test, expect, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from './render';
import type { OrganizationSummary } from '@lexon/contracts';

const api = vi.hoisted(() => ({
  changeMemberRole: vi.fn(async () => undefined),
  removeMember: vi.fn(async () => undefined),
  leaveOrganization: vi.fn(async () => undefined),
  createInvitation: vi.fn(async () => undefined),
  resendInvitation: vi.fn(async () => undefined),
  cancelInvitation: vi.fn(async () => undefined),
  updateOrganization: vi.fn(async () => ({
    version: 1,
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Hukum Nusantara',
    slug: 'hukum-nusantara',
    kind: 'team',
    state: 'active',
    require2fa: true,
    role: 'owner',
    createdAt: '2026-11-01T00:00:00.000Z',
  })),
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({ identity: null }),
}));
vi.mock('../src/components/organizations/page-state', () => ({
  identityApi: api,
  identityMessage: () =>
    'Unable to complete this action. Refresh and check your access.',
  QueryFailure: () => <div role="alert">Unable to load data.</div>,
  useCursorPage: (key: readonly unknown[]) => ({
    query: {
      data: {
        items:
          key[2] === 'invitations'
            ? [
                {
                  version: 1,
                  id: '00000000-0000-4000-8000-000000000021',
                  organizationId: '00000000-0000-4000-8000-000000000002',
                  organizationName: 'Hukum Nusantara',
                  email: 'dewi@example.test',
                  role: 'member',
                  purpose: 'team',
                  status: 'pending',
                  createdAt: '2026-11-01T00:00:00.000Z',
                  expiresAt: '2026-11-08T00:00:00.000Z',
                },
              ]
            : [
                {
                  version: 1,
                  id: '00000000-0000-4000-8000-000000000011',
                  userId: '00000000-0000-4000-8000-000000000012',
                  organizationId: '00000000-0000-4000-8000-000000000002',
                  name: 'Dewi Lestari',
                  email: 'dewi@example.test',
                  role: 'admin',
                  createdAt: '2026-11-01T00:00:00.000Z',
                },
              ],
        pageInfo: { nextCursor: null },
      },
      error: null,
    },
    pagination: null,
  }),
}));
import { Members } from '../src/components/organizations/members';
import { Invitations } from '../src/components/organizations/invitations';
import { OrganizationSettings } from '../src/components/organizations/organization-settings';

const team: OrganizationSummary = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Hukum Nusantara',
  slug: 'hukum-nusantara',
  kind: 'team',
  state: 'active',
  require2fa: false,
  role: 'owner',
  createdAt: '2026-11-01T00:00:00.000Z',
};

test('members uses the prototype table, role selector, and eligible invite action', async () => {
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Members organization={team} />
    </QueryClientProvider>,
  );

  expect(view.container.querySelector('table')).not.toBeNull();
  expect(view.container.textContent).toContain('Dewi Lestari');
  expect(view.container.textContent).toContain('dewi@example.test');
  expect(
    view.container.querySelector(
      '[role="combobox"][aria-label="Role for Dewi Lestari"]',
    ),
  ).not.toBeNull();
  expect(
    view.container.querySelector('[aria-label="Role for Dewi Lestari"]')
      ?.textContent,
  ).toContain('Admin');
  expect(
    view.container.querySelector('[aria-label="Role for Dewi Lestari"]')
      ?.textContent,
  ).not.toBe('admin');
  expect(
    view.container.querySelector('table')?.parentElement?.className,
  ).not.toMatch(/rounded-md|border/);
  expect(view.container.textContent).toContain('Invite people');
  expect(view.container.textContent).not.toContain('Make admin');
  window.history.replaceState(null, '', '/workspace?settings=members');
  await act(async () =>
    [...view.container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Invite people'))!
      .click(),
  );
  expect(router.replace.mock.calls.at(-1)?.[0]).toContain(
    'settings=invitations',
  );

  await view.unmount();
});

test('General saves name/slug separately from the existing 2FA setting mutation', async () => {
  const view = await render(<OrganizationSettings organization={team} />);
  const nameLabel = view.container.querySelector(
    'label[for="organization-name"]',
  )!;
  expect(nameLabel.parentElement?.className).not.toContain('md:text-right');
  const twoFactorSwitch = view.container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Require two-factor authentication"]',
  )!;
  await act(async () => twoFactorSwitch.click());
  expect(api.updateOrganization).toHaveBeenCalledWith(team.id, {
    require2fa: true,
  });

  const name =
    view.container.querySelector<HTMLInputElement>('input[name="name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(name, '');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    [...view.container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Save changes'))!
      .click(),
  );
  expect(name.getAttribute('aria-describedby')).toBeTruthy();
  const errorId = name.getAttribute('aria-describedby');
  expect(document.getElementById(errorId!)).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(name, 'Hukum Nusantara Baru');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    [...view.container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Save changes'))!
      .click(),
  );
  expect(api.updateOrganization).toHaveBeenLastCalledWith(team.id, {
    name: 'Hukum Nusantara Baru',
    slug: team.slug,
  });
  await view.unmount();
});

test('member removal and invitation cancellation are named confirmations', async () => {
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Members organization={team} />
      <Invitations organization={team} />
    </QueryClientProvider>,
  );
  expect(
    view.container.querySelector('[aria-label="Invitation role"]')?.textContent,
  ).toContain('Member');
  expect(
    view.container.querySelector('[aria-label="Invitation role"]')?.textContent,
  ).not.toBe('member');
  const remove = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Remove',
  )!;
  await act(async () => remove.click());
  expect(document.body.textContent).toContain(
    'Remove Dewi Lestari from Hukum Nusantara?',
  );
  const memberDialog = document.body.querySelector('[role="alertdialog"]')!;
  await act(async () =>
    [...memberDialog.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Cancel')!
      .click(),
  );
  expect(api.removeMember).not.toHaveBeenCalled();

  const cancelInvitation = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Cancel',
  )!;
  await act(async () => cancelInvitation.click());
  expect(document.body.textContent).toContain(
    'Cancel the invitation to dewi@example.test?',
  );
  const invitationDialog = document.body.querySelector('[role="alertdialog"]')!;
  await act(async () =>
    [...invitationDialog.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Keep invitation'))!
      .click(),
  );
  expect(api.cancelInvitation).not.toHaveBeenCalled();

  await act(async () => cancelInvitation.click());
  const dialog = document.body.querySelector('[role="alertdialog"]')!;
  await act(async () => [...dialog.querySelectorAll('button')].at(-1)!.click());
  expect(api.cancelInvitation).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith('Invitation cancelled.');
  await view.unmount();
});
