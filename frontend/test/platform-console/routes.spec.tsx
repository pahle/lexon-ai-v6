import { afterEach, expect, test, vi } from 'vitest';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, settle } from '../render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/platform/accounts',
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
const workspace = vi.hoisted(() => ({ identity: null as unknown }));
vi.mock('../../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({ identity: workspace.identity }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AccountsRoute, {
  metadata as accountsMetadata,
} from '../../src/app/(workspace)/platform/accounts/page';
import AccountRecordRoute from '../../src/app/(workspace)/platform/accounts/[userId]/page';
import OrganizationsRoute from '../../src/app/(workspace)/platform/organizations/page';
import OrganizationRecordRoute from '../../src/app/(workspace)/platform/organizations/[organizationId]/page';
import ProvisioningRedirect from '../../src/app/(workspace)/platform/provisioning/page';
import ProvisioningRecordRedirect from '../../src/app/(workspace)/platform/provisioning/[orgId]/page';

const ID = '00000000-0000-4000-8000-000000000062';
const admin = {
  platformAdmin: true,
  organization: { id: '00000000-0000-4000-8000-000000000001' },
  user: { id: '00000000-0000-4000-8000-000000000002' },
};
const routes: [string, () => Promise<ReactElement> | ReactElement, string][] = [
  ['/platform/accounts', () => AccountsRoute(), 'h1'],
  [
    '/platform/accounts/[userId]',
    () => AccountRecordRoute({ params: Promise.resolve({ userId: ID }) }),
    '[aria-label="Loading account"]',
  ],
  ['/platform/organizations', () => OrganizationsRoute(), 'h1'],
  [
    '/platform/organizations/[organizationId]',
    () =>
      OrganizationRecordRoute({
        params: Promise.resolve({ organizationId: ID }),
      }),
    '[aria-label="Loading organization"]',
  ],
];

afterEach(() => {
  vi.unstubAllGlobals();
  workspace.identity = null;
  document.body.innerHTML = '';
});

async function mount(element: ReactElement) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {element}
    </QueryClientProvider>,
  );
}

test('/platform/provisioning redirects to the provisioning organizations', () => {
  expect(() => ProvisioningRedirect()).toThrow(
    'redirect:/platform/organizations?state=provisioning',
  );
});

test('/platform/provisioning/<id> redirects to the organization record', async () => {
  await expect(
    ProvisioningRecordRedirect({ params: Promise.resolve({ orgId: ID }) }),
  ).rejects.toThrow(`redirect:/platform/organizations/${ID}`);
});

test('/platform/accounts is the Accounts console with the console metadata', async () => {
  workspace.identity = admin;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
  const view = await mount(await AccountsRoute());
  await settle();
  expect(view.container.querySelector('h1')?.textContent).toBe('Accounts');
  expect(
    [...view.container.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.textContent?.trim(),
    ),
  ).toEqual(['Accounts', 'Invitations']);
  expect(view.container.textContent).not.toContain('Account status');
  expect(view.container.querySelector('input[name="userId"]')).toBeNull();
  expect(accountsMetadata).toEqual({
    title: 'Accounts | Lexon',
    description: expect.any(String),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  });
  await view.unmount();
});

for (const [path, route, loaded] of routes) {
  test(`${path} shows the shared no-access page and loads nothing for non-administrators`, async () => {
    for (const identity of [null, { ...admin, platformAdmin: false }]) {
      workspace.identity = identity;
      const fetcher = vi.fn(async () => Response.json({}));
      vi.stubGlobal('fetch', fetcher);
      const view = await mount(await route());
      await settle();
      expect(
        view.container.querySelector('[data-slot="status-page"]'),
      ).not.toBeNull();
      expect(view.container.querySelector('h1')?.textContent).toBe(
        'You do not have access',
      );
      expect(view.container.textContent).toContain(
        'This page is available to platform administrators only.',
      );
      expect(fetcher).not.toHaveBeenCalled();
      await view.unmount();
    }
  });

  test(`${path} renders the console for a platform administrator`, async () => {
    workspace.identity = admin;
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const view = await mount(await route());
    await settle();
    expect(
      view.container.querySelector('[data-slot="status-page"]'),
    ).toBeNull();
    expect(view.container.querySelector(loaded)).not.toBeNull();
    expect(fetcher).toHaveBeenCalled();
    await view.unmount();
  });
}
