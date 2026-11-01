import { test, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle } from './render';
import { AdminSetup } from '../src/components/auth/admin-setup';
import { ProvisioningList } from '../src/components/platform/provisioning';
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
import { act } from 'react';
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
