import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationsPage } from '../../src/components/platform-console/organizations-page';
import { render, settle, settleUntil } from '../render';
import { byLabel, byText, click, typeInto } from '../data-views/helpers';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: '' }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => '/platform/organizations',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const org = (over: object = {}) => ({
  id: ID,
  name: 'Hukum Nusantara',
  slug: 'hukum-nusantara',
  state: 'active',
  memberCount: 3,
  ownerEmail: 'ayu@hukum-nusantara.co.id',
  createdAt: '2026-09-02T03:00:00.000Z',
  ...over,
});
const page = (items: object[], total = items.length) => ({
  items,
  page: 1,
  pageSize: 20,
  total,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const failure = (code: string, status: number) =>
  json({ error: { code, message: 'x' } }, status);

const fetchMock = vi.fn();
const reply = (res: Response) =>
  fetchMock.mockImplementation(async () => res.clone());
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
beforeEach(() => {
  nav.search = '';
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  nav.replace.mockClear();
  nav.push.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  document.body.innerHTML = '';
});

async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OrganizationsPage />
    </QueryClientProvider>,
  );
}

const PROV_ID = '4b241101-e2bb-4255-8caf-4136c566a962';
const provisioningOrg = () =>
  org({
    id: PROV_ID,
    name: 'Harbor Legal Partners',
    slug: 'harbor-legal-partners',
    state: 'provisioning',
    memberCount: 0,
    ownerEmail: 'owner@harborlegal.co.id',
    createdAt: '2026-11-14T03:00:00.000Z',
  });
const cellsOf = (root: ParentNode, name: string) => {
  const row = Array.from(root.querySelectorAll('tbody tr')).find((tr) =>
    tr.textContent!.includes(name),
  )!;
  return Array.from(row.querySelectorAll('td')).map((td) =>
    td.textContent!.trim(),
  );
};
const listFetches = () =>
  urls().filter((u) => u.startsWith('/api/platform/organizations')).length;

test('lists organizations with the prototype columns', async () => {
  reply(json(page([org(), provisioningOrg()])));
  const v = await mount();
  await settleUntil(() => !!v.container.querySelector('table'));
  expect(v.container.querySelector('h1')!.textContent).toBe('Organizations');
  expect(v.container.textContent).toContain(
    'Every team organization on Lexon. Personal workspaces are not listed.',
  );
  expect(byText(v.container, 'button', 'Provision organization')).toBeDefined();
  expect(
    Array.from(v.container.querySelectorAll('thead th')).map((th) =>
      th.textContent!.trim(),
    ),
  ).toEqual([
    'Organization',
    'State',
    'Members',
    'Owner',
    'Created',
    'Actions',
  ]);
  const active = cellsOf(v.container, 'Hukum Nusantara');
  expect(active.slice(0, 5)).toEqual([
    'HNHukum Nusantarahukum-nusantara',
    'Active',
    '3',
    'ayu@hukum-nusantara.co.id',
    '2 Sep 2026',
  ]);
  const provisioning = cellsOf(v.container, 'Harbor Legal Partners');
  expect(provisioning.slice(1, 5)).toEqual([
    'Provisioning',
    '—',
    'owner@harborlegal.co.id',
    '14 Nov 2026',
  ]);
  expect(v.container.textContent).toContain('2 organizations');
  expect(urls()).toContain('/api/platform/organizations?page=1&pageSize=20');
  await click(byLabel(v.container, 'Open Hukum Nusantara')!);
  expect(nav.push).toHaveBeenLastCalledWith(`/platform/organizations/${ID}`);
  await click(byLabel(v.container, 'Actions for Harbor Legal Partners')!);
  const items = Array.from(document.body.querySelectorAll('[role="menuitem"]'));
  expect(items.map((n) => n.textContent)).toEqual([
    'View organization',
    'Resend invitation',
    'Cancel provisioning',
  ]);
  expect(items[2]!.getAttribute('data-variant')).toBe('destructive');
  await click(items[0]!);
  expect(nav.push).toHaveBeenLastCalledWith(
    `/platform/organizations/${PROV_ID}`,
  );
  await v.unmount();
});

test('list columns on a narrow card: the prototype mobile rows', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        this.cb(
          [{ target, contentRect: { width: 400 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  reply(json(page([org(), provisioningOrg()])));
  const v = await mount();
  await settleUntil(
    () => !!v.container.querySelector('[data-slot="data-mobile-row"]'),
  );
  const rows = Array.from(
    v.container.querySelectorAll('[data-slot="data-mobile-row"]'),
  );
  expect(rows.map((r) => r.textContent)).toEqual([
    'HNHukum Nusantarahukum-nusantaraActive3 members · ayu@hukum-nusantara.co.id',
    'HLHarbor Legal Partnersharbor-legal-partnersProvisioningOwner invited · owner@harborlegal.co.id',
  ]);
  await v.unmount();
});

test('state facet: selecting Provisioning sends state=provisioning and resets page', async () => {
  nav.search = 'page=3';
  reply(json(page([org()], 60)));
  let v = await mount();
  await settleUntil(() => !!v.container.querySelector('table'));
  expect(urls()).toContain('/api/platform/organizations?page=3&pageSize=20');
  expect(
    v.container
      .querySelector('input[type="search"]')!
      .getAttribute('placeholder'),
  ).toBe('Search by name or slug');
  await click(byLabel(v.container, 'State')!);
  const options = Array.from(
    document.body.querySelectorAll('[role="menuitemcheckbox"]'),
  );
  expect(options.map((o) => o.textContent)).toEqual(['Active', 'Provisioning']);
  await click(options[1]!);
  expect(nav.replace).toHaveBeenLastCalledWith(
    '/platform/organizations?state=provisioning',
  );
  await v.unmount();

  // The router moved to the new URL: the list asks for that state only.
  nav.search = 'state=provisioning';
  fetchMock.mockClear();
  v = await mount();
  await settleUntil(() => listFetches() > 0);
  expect(urls()).toEqual([
    '/api/platform/organizations?state=provisioning&page=1&pageSize=20',
  ]);
  await v.unmount();
});

test('empty: no team organizations, Provision lives in the empty state', async () => {
  reply(json(page([])));
  const v = await mount();
  await settleUntil(() =>
    v.container.textContent!.includes('No team organizations yet'),
  );
  expect(v.container.textContent).toContain(
    'Provision an organization and invite its first owner. It appears here right away.',
  );
  const buttons = Array.from(v.container.querySelectorAll('button')).filter(
    (b) => b.textContent!.trim() === 'Provision organization',
  );
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.closest('[data-slot="empty"]')).not.toBeNull();
  await click(buttons[0]!);
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
    'Provision a team organization',
  );
  await v.unmount();
});

test('no results: filters match nothing, Reset filters clears them', async () => {
  nav.search = 'state=active';
  reply(json(page([])));
  const v = await mount();
  await settleUntil(() =>
    v.container.textContent!.includes('No organizations match these filters'),
  );
  expect(v.container.textContent).not.toContain('No team organizations yet');
  await click(byText(v.container, 'button', 'Reset filters')!);
  expect(nav.replace).toHaveBeenLastCalledWith('/platform/organizations');
  await v.unmount();
});

test('loading shows skeleton rows', async () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  const v = await mount();
  const loading = v.container.querySelector(
    '[aria-label="Loading organizations"]',
  )!;
  expect(loading).not.toBeNull();
  expect(
    loading.querySelectorAll('[data-slot="data-skeleton-row"]'),
  ).toHaveLength(20);
  await v.unmount();
});

test('error: the failure row with Try again, never the empty text', async () => {
  reply(failure('AUTH_UNAVAILABLE', 500));
  const v = await mount();
  await settleUntil(() =>
    v.container.textContent!.includes('We could not load organizations.'),
  );
  expect(v.container.textContent).not.toContain('No team organizations yet');
  const before = listFetches();
  reply(json(page([org()])));
  await click(byText(v.container, 'button', 'Try again')!);
  await settle();
  expect(listFetches()).toBe(before + 1);
  await settleUntil(() => !!v.container.querySelector('table'));
  await v.unmount();
});

async function openDialog() {
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string }) =>
      init?.method === 'POST' ? provisionReply() : json(page([org()])),
  );
  const v = await mount();
  await settleUntil(() => !!v.container.querySelector('table'));
  await click(byText(v.container, 'button', 'Provision organization')!);
  await settle();
  const inputs = Array.from(
    document.querySelectorAll('form input'),
  ) as HTMLInputElement[];
  return { v, inputs, form: document.querySelector('form')! };
}
let provisionReply: () => Response = () => json({});
const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  await settle();
};
const fillAll = async (inputs: HTMLInputElement[]) => {
  await typeInto(inputs[0]!, 'Harbor Legal Partners');
  await typeInto(inputs[1]!, 'harbor-legal-partners');
  await typeInto(inputs[2]!, 'owner@harborlegal.co.id');
};

test('provision dialog: slug taken shows the field error under the slug', async () => {
  provisionReply = () => failure('ORG_SLUG_TAKEN', 409);
  const { v, inputs, form } = await openDialog();
  expect(document.body.textContent).toContain('Provision a team organization');
  await fillAll(inputs);
  await submit(form);
  expect(document.body.textContent).toContain(
    'That team slug is already taken. Choose another.',
  );
  expect(inputs[1]!.getAttribute('aria-invalid')).toBe('true');
  const describedBy = inputs[1]!.getAttribute('aria-describedby')!.split(' ');
  expect(
    describedBy.map((id) => document.getElementById(id)!.textContent),
  ).toContain('That team slug is already taken. Choose another.');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(nav.push).not.toHaveBeenCalled();
  await v.unmount();
});

test('provision success opens the new record', async () => {
  provisionReply = () =>
    json(
      {
        version: 1,
        id: ID,
        name: 'Harbor Legal Partners',
        slug: 'harbor-legal-partners',
        kind: 'team',
        state: 'provisioning',
        createdAt: '2026-11-14T03:00:00.000Z',
        invitation: {
          id: ID,
          status: 'pending',
          expiresAt: '2026-11-21T03:00:00.000Z',
        },
      },
      201,
    );
  const { v, inputs, form } = await openDialog();
  const before = listFetches();
  await fillAll(inputs);
  await submit(form);
  const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
  expect(post[0]).toBe('/api/platform/provisioning');
  expect(JSON.parse(post[1].body)).toEqual({
    name: 'Harbor Legal Partners',
    slug: 'harbor-legal-partners',
    ownerEmail: 'owner@harborlegal.co.id',
  });
  expect(nav.push).toHaveBeenCalledWith(`/platform/organizations/${ID}`);
  expect(toastSuccess).toHaveBeenCalledWith(
    'Organization provisioning started.',
  );
  // The organization list queries were invalidated and refetched.
  await settle();
  expect(listFetches()).toBe(before + 1);
  await v.unmount();
});

const menuItems = () =>
  Array.from(document.body.querySelectorAll('[role="menuitem"]'));
async function mountRows(
  mutation: (url: string, method: string) => Response = (url) =>
    url.endsWith('/resend')
      ? json({
          version: 1,
          id: PROV_ID,
          name: 'Harbor Legal Partners',
          slug: 'harbor-legal-partners',
          kind: 'team',
          state: 'provisioning',
          createdAt: '2026-11-14T03:00:00.000Z',
          invitation: {
            id: ID,
            status: 'pending',
            expiresAt: '2026-11-21T03:00:00.000Z',
          },
        })
      : new Response(null, { status: 204 }),
) {
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string }) =>
      init?.method && init.method !== 'GET'
        ? mutation(url, init.method)
        : json(page([org(), provisioningOrg()])),
  );
  const v = await mount();
  await settleUntil(() => !!v.container.querySelector('table'));
  return v;
}
const mutations = () =>
  fetchMock.mock.calls.filter((c) => c[1]?.method && c[1].method !== 'GET');

test('active rows offer only View organization', async () => {
  const v = await mountRows();
  await click(byLabel(v.container, 'Actions for Hukum Nusantara')!);
  expect(menuItems().map((n) => n.textContent)).toEqual(['View organization']);
  await v.unmount();
});

test('row menu Resend invitation resends the owner invitation and toasts', async () => {
  const v = await mountRows();
  await click(byLabel(v.container, 'Actions for Harbor Legal Partners')!);
  const before = listFetches();
  await click(byText(document.body, '[role="menuitem"]', 'Resend invitation')!);
  await settleUntil(() => toastSuccess.mock.calls.length > 0);
  expect(mutations().map((c) => `${c[1].method} ${c[0]}`)).toEqual([
    `POST /api/platform/provisioning/${PROV_ID}/resend`,
  ]);
  expect(toastSuccess).toHaveBeenCalledWith('Owner invitation resent.');
  await settleUntil(() => listFetches() > before);
  await v.unmount();
});

test('row menu Resend failure toasts the safe message', async () => {
  const v = await mountRows(() => failure('AUTH_UNAVAILABLE', 500));
  await click(byLabel(v.container, 'Actions for Harbor Legal Partners')!);
  await click(byText(document.body, '[role="menuitem"]', 'Resend invitation')!);
  await settleUntil(() => toastError.mock.calls.length > 0);
  expect(toastSuccess).not.toHaveBeenCalled();
  await v.unmount();
});

test('row menu Cancel provisioning confirms first, then cancels and refreshes', async () => {
  const v = await mountRows();
  await click(byLabel(v.container, 'Actions for Harbor Legal Partners')!);
  await click(
    byText(document.body, '[role="menuitem"]', 'Cancel provisioning')!,
  );
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  expect(dialog.textContent).toContain(
    'Cancel provisioning for Harbor Legal Partners?',
  );
  expect(dialog.textContent).toContain(
    'This deletes the provisioning organization and invalidates its owner invitation.',
  );
  expect(mutations()).toHaveLength(0);
  const confirm = byText(dialog, 'button', 'Cancel provisioning')!;
  expect(confirm.className).toContain('--lexon-destructive-fill');
  const before = listFetches();
  await click(confirm);
  await settleUntil(() => toastSuccess.mock.calls.length > 0);
  expect(mutations().map((c) => `${c[1].method} ${c[0]}`)).toEqual([
    `DELETE /api/platform/provisioning/${PROV_ID}`,
  ]);
  expect(toastSuccess).toHaveBeenCalledWith('Provisioning cancelled.');
  await settleUntil(() => listFetches() > before);
  expect(nav.push).not.toHaveBeenCalled();
  await v.unmount();
});

test('row menu Cancel provisioning: dismissing makes no request', async () => {
  const v = await mountRows();
  await click(byLabel(v.container, 'Actions for Harbor Legal Partners')!);
  await click(
    byText(document.body, '[role="menuitem"]', 'Cancel provisioning')!,
  );
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  await click(byText(dialog, 'button', 'Cancel')!);
  await settle();
  expect(mutations()).toHaveLength(0);
  await v.unmount();
});
