import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  DenySummary,
  ProjectMemberSummary,
  ProjectPage,
  ProjectSummary,
} from '@lexon/contracts';
import type { MattersApi, ProjectDetail } from '../src/lib/matters-api';
import { MattersPage } from '../src/components/matters/matters-page';
import { MatterPage } from '../src/components/matters/matter-page';
import { render, settle } from './render';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => '/matters',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const scope = { orgId: 'org-1', userId: 'owner-1' };

const owned: ProjectSummary = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000101',
  name: 'Prasetyo acquisition',
  matterNumber: 'M-2026-014',
  practiceArea: 'Mergers & acquisitions',
  owner: {
    userId: '00000000-0000-4000-8000-000000000001',
    name: 'Amara Wijaya',
  },
  myRole: 'owner',
  memberCount: 2,
  chatCount: 2,
  lastActivityAt: '2026-11-20T09:00:00.000Z',
  createdAt: '2026-11-01T09:00:00.000Z',
};
const shared: ProjectSummary = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000102',
  name: 'Merdeka financing',
  matterNumber: null,
  practiceArea: null,
  owner: {
    userId: '00000000-0000-4000-8000-000000000002',
    name: 'Dimas Prasetyo',
  },
  myRole: 'viewer',
  memberCount: 3,
  chatCount: 5,
  lastActivityAt: '2026-11-18T09:00:00.000Z',
  createdAt: '2026-11-02T09:00:00.000Z',
};
const detail: ProjectDetail = {
  ...owned,
  instructions: 'Prefer Indonesian law.',
};
const member = (over: Partial<ProjectMemberSummary>): ProjectMemberSummary => ({
  version: 1,
  memberId: '00000000-0000-4000-8000-000000000301',
  userId: '00000000-0000-4000-8000-000000000301',
  name: 'Budi Santoso',
  email: 'budi@lexon.id',
  role: 'editor',
  createdAt: '2026-11-01T09:00:00.000Z',
  ...over,
});
const denied: DenySummary = {
  version: 1,
  userId: '00000000-0000-4000-8000-000000000302',
  name: 'Kirana Puspita',
  email: 'kirana@lexon.id',
  setByUserId: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-11-10T09:00:00.000Z',
};

const page = (items: ProjectSummary[]): ProjectPage => ({
  items,
  pageInfo: { nextCursor: null },
});

function tree(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(['identity'], {
    user: { id: scope.userId },
    organization: { id: scope.orgId, role: 'owner', kind: 'team' },
  });
  client.setQueryData(['active-organization'], { id: scope.orgId });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

const api = (over: Partial<MattersApi>): MattersApi =>
  ({
    list: vi.fn(async () => page([])),
    detail: vi.fn(async () => detail),
    listChats: vi.fn(async () => []),
    listMembers: vi.fn(async () => [member({})]),
    listDenies: vi.fn(async () => []),
    ...over,
  }) as unknown as MattersApi;

const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  );

it('Matters: list renders matter, number, practice area, owner, role, chats and activity columns', async () => {
  const client = api({ list: vi.fn(async () => page([owned, shared])) });
  const view = await render(
    tree(<MattersPage client={client} scope={scope} />),
  );
  await settle();
  const text = view.container.textContent!;
  expect(text).toContain('Matters');
  expect(text).toContain('Prasetyo acquisition');
  expect(text).toContain('M-2026-014');
  expect(text).toContain('Mergers & acquisitions');
  expect(text).toContain('Amara Wijaya');
  expect(text).toContain('Merdeka financing');
  expect(text).toContain('Dimas Prasetyo');
  expect(text).toContain('Owner');
  expect(text).toContain('Viewer');
  expect(button(view.container, 'New matter')).toBeDefined();
  await view.unmount();
});

it('Matters: filter tabs and sort control render; the shared filter reaches the API', async () => {
  const list = vi.fn(async () => page([owned]));
  nav.search = 'filter=shared&sort=name';
  const view = await render(
    tree(<MattersPage client={api({ list })} scope={scope} />),
  );
  await settle();
  expect(view.container.textContent).toContain('All');
  expect(view.container.textContent).toContain('Owned by me');
  expect(view.container.textContent).toContain('Shared with me');
  expect(view.container.textContent).toContain('Sort');
  expect(list).toHaveBeenCalledWith(
    expect.objectContaining({ filter: 'shared', sort: 'name' }),
    expect.anything(),
  );
  nav.search = '';
  await view.unmount();
});

it('Matters: empty state names the New matter action and opens the create dialog', async () => {
  const view = await render(
    tree(<MattersPage client={api({})} scope={scope} />),
  );
  await settle();
  expect(view.container.textContent).toContain('No matters yet');
  await act(async () => button(view.container, 'New matter')!.click());
  await settle();
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('New matter');
  expect(dialog.textContent).toContain('Matter number');
  expect(dialog.textContent).toContain('Practice area');
  await view.unmount();
});

it('Matter page: owner sees the composer and editor controls; instructions render', async () => {
  const client = api({
    listChats: vi.fn(async () => [
      {
        id: '00000000-0000-4000-8000-000000000201',
        title: 'Draft SPA review',
        updatedAt: '2026-11-19T09:00:00.000Z',
      },
    ]),
  });
  const view = await render(
    tree(<MatterPage client={client} scope={scope} projectId={owned.id} />),
  );
  await settle();
  const text = view.container.textContent!;
  expect(text).toContain('Prasetyo acquisition');
  expect(text).toContain('M-2026-014');
  expect(text).toContain('Chats');
  expect(text).toContain('Draft SPA review');
  expect(text).toContain('Matter instructions');
  expect(text).toContain('Prefer Indonesian law.');
  expect(view.container.querySelector('textarea')).not.toBeNull();
  expect(button(view.container, 'Members')).toBeDefined();
  await view.unmount();
});

it('Matter page: a viewer sees the matter read-only and cannot compose', async () => {
  const client = api({
    detail: vi.fn(async () => ({ ...shared, instructions: null })),
  });
  const view = await render(
    tree(<MatterPage client={client} scope={scope} projectId={shared.id} />),
  );
  await settle();
  const text = view.container.textContent!;
  expect(text).toContain('Viewer');
  expect(view.container.querySelector('textarea')).toBeNull();
  expect(button(view.container, 'Members')).toBeUndefined();
  await view.unmount();
});

it('Matter page: members dialog lists members with role controls and a restricted member state', async () => {
  const client = api({
    listMembers: vi.fn(async () => [member({})]),
    listDenies: vi.fn(async () => [denied]),
  });
  const view = await render(
    tree(<MatterPage client={client} scope={scope} projectId={owned.id} />),
  );
  await settle();
  await act(async () => button(view.container, 'Members')!.click());
  await settle();
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Amara Wijaya');
  expect(dialog.textContent).toContain('Budi Santoso');
  expect(dialog.textContent).toContain('Kirana Puspita');
  expect(dialog.textContent).toContain(
    'Access restricted by your organization',
  );
  await view.unmount();
});

it('Matter page: delete confirm names the chat count', async () => {
  const view = await render(
    tree(<MatterPage client={api({})} scope={scope} projectId={owned.id} />),
  );
  await settle();
  await act(async () =>
    [...view.container.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label') === 'Matter actions')!
      .click(),
  );
  await settle();
  await act(async () =>
    [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((i) => i.textContent === 'Delete matter')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  await settle();
  const alert = document.body.querySelector('[role="alertdialog"]')!;
  expect(alert.textContent).toContain('Prasetyo acquisition');
  expect(alert.textContent).toContain('2 chats');
  await view.unmount();
});
