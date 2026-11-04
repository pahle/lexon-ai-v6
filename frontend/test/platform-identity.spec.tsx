import { test, expect, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle } from './render';
import { AdminSetup } from '../src/components/auth/admin-setup';
import { ProvisioningList } from '../src/components/platform/provisioning';
import { ProvisioningDetail } from '../src/components/platform/provisioning-detail';
import { AccountStatusForm } from '../src/components/platform/account-status-form';
import { PlatformPage } from '../src/components/platform/platform-page';
const workspaceState = vi.hoisted(() => ({ identity: null as unknown }));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({ identity: workspaceState.identity }),
}));
vi.mock('../src/lib/auth-client', () => ({
  authClient: { signOut: async () => ({ error: null }) },
}));
test('pending administrator setup has no platform controls and removes proof from visible history', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
    String(input).endsWith('/redeem')
      ? Response.json({ status: 'pending' })
      : Response.json(
          { error: { code: 'AUTH_REQUIRED', message: 'Required' } },
          { status: 401 },
        ),
  );
  const token = 'a'.repeat(43);
  window.history.replaceState(null, '', '/admin-setup?token=' + token);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminSetup setupToken={token} />
    </QueryClientProvider>,
  );
  await settle();
  expect(
    [...view.container.querySelectorAll('button')].some(
      (button) => button.textContent === 'Provision organization',
    ),
  ).toBe(false);
  expect(window.location.search.includes(token)).toBe(false);
  await view.unmount();
  vi.unstubAllGlobals();
});
test('platform forms remain hidden before server authorization and after denial', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json(
      { error: { code: 'ORG_FORBIDDEN', message: 'Unavailable' } },
      { status: 403 },
    ),
  );
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ProvisioningList />
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('form')).toBeNull();
  await settle();
  expect(view.container.querySelector('form')).toBeNull();
  await view.unmount();
  vi.unstubAllGlobals();
});
test('non-platform administrators do not mount provisioning data loaders', async () => {
  workspaceState.identity = {
    platformAdmin: false,
    organization: { id: '00000000-0000-4000-8000-000000000001' },
    user: { id: '00000000-0000-4000-8000-000000000002' },
  };
  const fetcher = vi.fn(async () => Response.json({ items: [] }));
  vi.stubGlobal('fetch', fetcher);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <PlatformPage title="Platform">
        <ProvisioningList />
      </PlatformPage>
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  await view.unmount();
  vi.unstubAllGlobals();
  workspaceState.identity = null;
});

test('platform provisioning uses a published Card, Empty state, and semantic table', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ items: [], pageInfo: { nextCursor: null } }),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ProvisioningList />
    </QueryClientProvider>,
  );
  await settle();
  expect(view.container.querySelector('[data-slot="card"]')).not.toBeNull();
  expect(view.container.querySelector('[data-slot="empty"]')).not.toBeNull();
  expect(view.container.textContent).toContain('No provisioning organizations');
  await view.unmount();

  fetcher.mockResolvedValueOnce(
    Response.json({
      items: [
        {
          version: 1,
          id: '00000000-0000-4000-8000-000000000042',
          name: 'Task 7B Team',
          slug: 'task-7b-team',
          kind: 'team',
          state: 'provisioning',
          createdAt: '2026-11-01T00:00:00.000Z',
          invitation: {
            id: '00000000-0000-4000-8000-000000000043',
            status: 'pending',
            expiresAt: '2026-11-08T00:00:00.000Z',
          },
        },
      ],
      pageInfo: { nextCursor: null },
    }),
  );
  const populated = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ProvisioningList />
    </QueryClientProvider>,
  );
  await settle();
  expect(populated.container.querySelector('table')).not.toBeNull();
  expect(populated.container.textContent).toContain('Task 7B Team');
  await populated.unmount();
  vi.unstubAllGlobals();
});

test('disabling a platform account requires a named confirmation and cancel makes no request', async () => {
  const userId = '00000000-0000-4000-8000-000000000052';
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/api/platform/provisioning?limit=1')
      ? Response.json({ items: [], pageInfo: { nextCursor: null } })
      : new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountStatusForm />
    </QueryClientProvider>,
  );
  await settle();
  const input = view.container.querySelector<HTMLInputElement>(
    'input[name="userId"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, userId);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(input.value).toBe(userId);
  await act(async () =>
    view.container
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click(),
  );
  await settle();
  expect(document.body.textContent).toContain(`Disable account ${userId}?`);
  expect(
    fetcher.mock.calls.filter(([url]) =>
      String(url).includes('/api/platform/users/'),
    ),
  ).toHaveLength(0);
  const cancel = [...document.body.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Keep account enabled'),
  )!;
  await act(async () => cancel.click());
  expect(
    fetcher.mock.calls.filter(([url]) =>
      String(url).includes('/api/platform/users/'),
    ),
  ).toHaveLength(0);
  await act(async () =>
    view.container
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click(),
  );
  const confirm = document.body.querySelector('[role="alertdialog"]')!;
  await act(async () =>
    [...confirm.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Disable account'))!
      .click(),
  );
  await settle();
  expect(
    fetcher.mock.calls.filter(([url]) =>
      String(url).includes('/api/platform/users/'),
    ),
  ).toHaveLength(1);
  await view.unmount();
  vi.unstubAllGlobals();
});

test('cancelling provisioning has a named confirmation and Keep makes no delete request', async () => {
  const organizationId = '00000000-0000-4000-8000-000000000062';
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({
            version: 1,
            id: organizationId,
            name: 'Hukum Nusantara',
            slug: 'hukum-nusantara',
            kind: 'team',
            state: 'provisioning',
            createdAt: '2026-11-01T00:00:00.000Z',
            invitation: {
              id: '00000000-0000-4000-8000-000000000063',
              status: 'pending',
              expiresAt: '2026-11-08T00:00:00.000Z',
            },
          }),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ProvisioningDetail organizationId={organizationId} />
    </QueryClientProvider>,
  );
  await settle();
  await act(async () =>
    [...view.container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Cancel provisioning'))!
      .click(),
  );
  expect(document.body.textContent).toContain(
    'Cancel provisioning for Hukum Nusantara?',
  );
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE'),
  ).toHaveLength(0);
  await act(async () =>
    [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Keep provisioning'))!
      .click(),
  );
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE'),
  ).toHaveLength(0);
  await view.unmount();
  vi.unstubAllGlobals();
});
test('completed setup discards its proof without redeeming it again', async () => {
  const user = {
    version: 1,
    id: '00000000-0000-4000-8000-000000000001',
    email: 'operator@example.test',
    name: 'Operator',
    emailVerified: true,
    twoFactorEnabled: true,
    onboardingCompleted: false,
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
    String(input).endsWith('/profile')
      ? Response.json(user)
      : String(input).endsWith('/security')
        ? Response.json({
            version: 1,
            twoFactorEnabled: true,
            mfaVerified: true,
            reauthenticationExpiresAt: null,
            recoveryCodesRemaining: 10,
          })
        : String(input).endsWith('/complete')
          ? new Response(null, { status: 204 })
          : Response.json({ status: 'pending' }),
  );
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminSetup setupToken={'b'.repeat(43)} />
    </QueryClientProvider>,
  );
  await settle();
  await act(async () => view.container.querySelector('button')!.click());
  await settle();
  expect(view.container.querySelector('h1')?.textContent).toBe(
    'Administrator setup complete',
  );
  await view.unmount();
  vi.unstubAllGlobals();
});
