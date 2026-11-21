import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationsPage } from '../../src/components/platform-console/organizations-page';
import { render, settle, settleUntil } from '../render';
import { byLabel, byText, click, typeInto } from '../data-views/helpers';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: '' }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => '/platform/organizations',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

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
  fetchMock.mockReset();
  nav.replace.mockClear();
  nav.push.mockClear();
  toastSuccess.mockClear();
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

test('lists organizations with the prototype columns', async () => {
  reply(
    json(
      page([
        org(),
        org({
          id: '4b241101-e2bb-4255-8caf-4136c566a962',
          name: 'Harbor Legal Partners',
          slug: 'harbor-legal-partners',
          state: 'provisioning',
          memberCount: 0,
          ownerEmail: 'owner@harborlegal.co.id',
        }),
      ]),
    ),
  );
  const v = await mount();
  await settleUntil(() => !!v.container.querySelector('table'));
  const t = v.container.textContent!;
  for (const h of ['Organization', 'State', 'Members', 'Owner', 'Created'])
    expect(t).toContain(h);
  expect(t).toContain(
    'Every team organization on Lexon. Personal workspaces are not listed.',
  );
  expect(t).toContain('hukum-nusantara');
  expect(t).toContain('Active');
  expect(t).toContain('Provisioning');
  expect(t).toContain('—');
  expect(t).toContain('2 Sep 2026');
  expect(t).toContain('2 organizations');
  expect(urls()).toContain('/api/platform/organizations?page=1&pageSize=20');
  await click(byLabel(v.container, 'Open Hukum Nusantara')!);
  expect(nav.push).toHaveBeenCalledWith(`/platform/organizations/${ID}`);
  await v.unmount();
});

test('state facet and search come from the URL into the request', async () => {
  nav.search = 'query=harbor&state=provisioning';
  reply(json(page([org()])));
  const v = await mount();
  await settleUntil(() => urls().length > 0);
  expect(urls()).toContain(
    '/api/platform/organizations?query=harbor&state=provisioning&page=1&pageSize=20',
  );
  expect(byLabel(v.container, 'State')).not.toBeNull();
  expect(
    v.container
      .querySelector('input[type="search"]')!
      .getAttribute('placeholder'),
  ).toBe('Search by name or slug');
  await v.unmount();
});

test('empty, loading, no results, error', async () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  let v = await mount();
  expect(
    v.container.querySelector('[aria-label="Loading organizations"]'),
  ).not.toBeNull();
  await v.unmount();

  reply(json(page([])));
  v = await mount();
  await settleUntil(() =>
    v.container.textContent!.includes('No team organizations yet'),
  );
  expect(v.container.textContent).toContain(
    'Provision an organization and invite its first owner. It appears here right away.',
  );
  await v.unmount();

  nav.search = 'state=active';
  v = await mount();
  await settleUntil(() =>
    v.container.textContent!.includes('No organizations match these filters'),
  );
  expect(v.container.textContent).not.toContain('No team organizations yet');
  await v.unmount();

  nav.search = '';
  reply(failure('AUTH_UNAVAILABLE', 500));
  v = await mount();
  await settleUntil(() =>
    v.container.textContent!.includes('We could not load organizations.'),
  );
  expect(v.container.textContent).not.toContain('No team organizations yet');
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
  await v.unmount();
});
