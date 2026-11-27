import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrgProjectSummary, DenySummary } from '@lexon/contracts';
import type { MattersApi } from '../src/lib/matters-api';
import { SettingsMatters } from '../src/components/settings/settings-matters';
import { render, settle, settleUntil } from './render';

// F6 §10/§16 settings-matters: org owners/admins see the whole org's matters —
// name metadata only, a Restricted count column, and a restrict dialog that
// lists and lifts deny rows and adds org members through /org/members/search.

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => '/matters',
  useSearchParams: () => new URLSearchParams(''),
}));

const summary = (over: Partial<OrgProjectSummary>): OrgProjectSummary => ({
  version: 1,
  id: '00000000-0000-4000-8000-000000000101',
  name: 'Prasetyo acquisition',
  matterNumber: 'M-2026-014',
  practiceArea: 'Mergers & acquisitions',
  owner: {
    userId: '00000000-0000-4000-8000-000000000001',
    name: 'Amara Wijaya',
  },
  memberCount: 4,
  chatCount: 2,
  restrictedCount: 0,
  lastActivityAt: '2026-11-20T09:00:00.000Z',
  createdAt: '2026-11-01T09:00:00.000Z',
  ...over,
});
const deny: DenySummary = {
  version: 1,
  userId: '00000000-0000-4000-8000-000000000302',
  name: 'Kirana Puspita',
  email: 'kirana@lexon.id',
  setByUserId: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-11-10T09:00:00.000Z',
};

const api = (over: Partial<MattersApi>): MattersApi =>
  ({
    orgList: vi.fn(async () => ({ items: [], nextCursor: null })),
    listDenies: vi.fn(async () => []),
    addDeny: vi.fn(async () => undefined),
    removeDeny: vi.fn(async () => undefined),
    searchMembers: vi.fn(async () => []),
    ...over,
  }) as unknown as MattersApi;

function tree(node: React.ReactNode) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>
  );
}

const scope = { orgId: 'org-1', userId: 'admin-1' };

it('renders name metadata only plus the Restricted count; zero denies read "—"', async () => {
  const walled = summary({ restrictedCount: 2 });
  const view = await render(
    tree(
      <SettingsMatters
        client={api({
          orgList: vi.fn(async () => ({
            items: [summary({}), walled],
            nextCursor: null,
          })),
        })}
        scope={scope}
      />,
    ),
  );
  await settle();
  const text = view.container.textContent!;
  expect(text).toContain('Prasetyo acquisition');
  expect(text).toContain('M-2026-014');
  expect(text).toContain('Mergers & acquisitions');
  expect(text).toContain('Amara Wijaya');
  expect(text).toContain('Restricted');
  expect(text).toContain('—');
  expect(text).toContain('2');
  // Metadata only — never instructions, member names or the caller's role.
  expect(text).not.toContain('Your role');
  expect(text).not.toContain('Instructions');
  await view.unmount();
});

it('the Restrict access dialog lists deny rows with Lift and can add a member', async () => {
  const walled = summary({ restrictedCount: 1 });
  const listDenies = vi.fn(async () => [deny]);
  const removeDeny = vi.fn(async () => undefined);
  const addDeny = vi.fn(async () => undefined);
  const searchMembers = vi.fn(async () => [
    {
      version: 1 as const,
      userId: '00000000-0000-4000-8000-000000000303',
      name: 'Eko Prasetyo',
      email: 'eko@lexon.id',
      role: 'member' as const,
    },
  ]);
  const view = await render(
    tree(
      <SettingsMatters
        client={api({
          orgList: vi.fn(async () => ({ items: [walled], nextCursor: null })),
          listDenies,
          removeDeny,
          addDeny,
          searchMembers,
        })}
        scope={scope}
      />,
    ),
  );
  await settleUntil(() => view.container.textContent!.includes('Prasetyo'));
  const restrict = [
    ...view.container.querySelectorAll('[role="menuitem"], button, a'),
  ].find((el) => el.textContent?.includes('Restrict access'));
  expect(restrict).toBeDefined();
  restrict!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
  await settleUntil(() =>
    document.body.textContent!.includes('Kirana Puspita'),
  );
  expect(document.body.textContent).toContain('Kirana Puspita');
  expect(document.body.textContent).toContain('Lift');
  const lift = [...document.body.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Lift'),
  )!;
  lift.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
  await settleUntil(() => removeDeny.mock.calls.length > 0);
  expect(removeDeny).toHaveBeenCalledWith(walled.id, deny.userId);
  await view.unmount();
});

it('a load failure shows the retry surface, not the table', async () => {
  const orgList = vi.fn(async () => {
    throw new Error('down');
  });
  const view = await render(
    tree(<SettingsMatters client={api({ orgList })} scope={scope} />),
  );
  await settle();
  expect(view.container.textContent).toContain('could not');
  await view.unmount();
});
