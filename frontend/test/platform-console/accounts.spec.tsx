import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountsPage } from '../../src/components/platform-console/accounts-page';
import { render, settle, settleUntil } from '../render';
import { byLabel, byText, click, typeInto } from '../data-views/helpers';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: '' }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => '/platform/accounts',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));

const ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const account = (over: object = {}) => ({
  id: ID,
  name: 'Dimas Prasetyo',
  email: 'dimas@lexon.id',
  status: 'active',
  twoFactorEnabled: true,
  isPlatformAdministrator: true,
  teamCount: 0,
  createdAt: '2026-09-01T03:00:00.000Z',
  lastActiveAt: null,
  ...over,
});
const invitation = (over: object = {}) => ({
  id: '4b241101-e2bb-4255-8caf-4136c566a962',
  email: 'joko@gmail.com',
  name: null,
  status: 'expired',
  invitedBy: 'Dimas Prasetyo',
  sentAt: '2026-11-02T03:00:00.000Z',
  expiresAt: '2026-11-09T03:00:00.000Z',
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
const failure = (code: string, status: number, issues?: object[]) =>
  json(
    { error: { code, message: 'x', ...(issues ? { issues } : {}) } },
    status,
  );

const fetchMock = vi.fn();
// A fresh Response per call: a body can be read once.
const reply = (res: Response) =>
  fetchMock.mockImplementation(async () => res.clone());
const replyOnce = (res: Response) =>
  fetchMock.mockImplementationOnce(async () => res.clone());
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
  const view = await render(
    <QueryClientProvider client={client}>
      <AccountsPage />
    </QueryClientProvider>,
  );
  return { view, client };
}
const urlOf = (call: number) => String(fetchMock.mock.calls[call]![0]);

test('lists accounts with the prototype columns and the administrator badge', async () => {
  reply(
    json(
      page([
        account(),
        account({
          id: 'a2f41101-e2bb-4255-8caf-4136c566a962',
          name: 'Bagus Santoso',
          email: 'bagus@x.id',
          status: 'unverified',
          twoFactorEnabled: false,
          isPlatformAdministrator: false,
          teamCount: 2,
          lastActiveAt: '2026-11-20T03:00:00.000Z',
        }),
      ]),
    ),
  );
  const { view } = await mount();
  await settleUntil(() => !!view.container.querySelector('table'));
  const text = view.container.textContent!;
  for (const h of [
    'Account',
    'Status',
    'Two-step',
    'Teams',
    'Joined',
    'Last active',
  ])
    expect(text).toContain(h);
  expect(text).toContain('Platform administrator');
  expect(text.match(/Platform administrator/g)).toHaveLength(1);
  expect(text).toContain('Unverified');
  expect(text).toContain('1 Sep 2026');
  expect(text).toContain('Never');
  expect(text).toContain('2 accounts');
  expect(urlOf(0)).toBe('/api/platform/accounts?page=1&pageSize=20');
  expect(byLabel(view.container, 'Open Dimas Prasetyo')).not.toBeNull();
  await click(byLabel(view.container, 'Open Bagus Santoso')!);
  expect(nav.push).toHaveBeenCalledWith(
    '/platform/accounts/a2f41101-e2bb-4255-8caf-4136c566a962',
  );
  await view.unmount();
});

test('filters come from the URL into the request', async () => {
  nav.search = 'query=ayu&status=active&status=disabled&twoFactor=off&page=2';
  reply(json({ ...page([account()], 45), page: 2 }));
  const { view } = await mount();
  await settleUntil(() => fetchMock.mock.calls.length > 0);
  expect(urlOf(0)).toBe(
    '/api/platform/accounts?query=ayu&status=active&status=disabled&twoFactor=off&page=2&pageSize=20',
  );
  expect(byLabel(view.container, 'Status')).not.toBeNull();
  expect(byLabel(view.container, 'Two-step')).not.toBeNull();
  await view.unmount();
});

test('loading shows skeleton rows', async () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  const { view } = await mount();
  expect(
    view.container.querySelector('[aria-label="Loading accounts"]'),
  ).not.toBeNull();
  await view.unmount();
});

test('no results names the search and offers Reset', async () => {
  nav.search = 'query=notaris';
  reply(json(page([])));
  const { view } = await mount();
  await settleUntil(() =>
    view.container.textContent!.includes('No accounts match'),
  );
  expect(view.container.textContent).toContain('No accounts match “notaris”');
  expect(byText(view.container, 'button', 'Reset filters')).toBeDefined();
  await view.unmount();
});

test('empty list says so', async () => {
  reply(json(page([])));
  const { view } = await mount();
  await settleUntil(() =>
    view.container.textContent!.includes('No accounts yet'),
  );
  await view.unmount();
});

test('a failure shows the error row, never the empty text', async () => {
  reply(failure('AUTH_UNAVAILABLE', 500));
  const { view } = await mount();
  await settleUntil(() =>
    view.container.textContent!.includes('We could not load accounts.'),
  );
  expect(view.container.textContent).not.toContain('No accounts yet');
  expect(view.container.textContent).toContain('Try again');
  await view.unmount();
});

test('Invitations tab (?tab=invitations): rows, then each state', async () => {
  nav.search = 'tab=invitations';
  reply(
    json(
      page([
        invitation(),
        invitation({
          id: '5b241101-e2bb-4255-8caf-4136c566a962',
          name: 'Rina Kusuma',
          email: 'rina@kusumalaw.co.id',
          status: 'pending',
        }),
      ]),
    ),
  );
  const { view } = await mount();
  await settleUntil(() => !!view.container.querySelector('table'));
  const text = view.container.textContent!;
  for (const h of ['Invited person', 'Status', 'Invited by', 'Sent', 'Expires'])
    expect(text).toContain(h);
  expect(text).toContain('No name given');
  expect(text).toContain('Rina Kusuma');
  expect(text).toContain('Expired');
  expect(text).toContain('2 invitations');
  expect(urlOf(0)).toBe('/api/platform/account-invitations?page=1&pageSize=20');
  await view.unmount();
});

test('Invitations tab empty, loading, no results, failure', async () => {
  nav.search = 'tab=invitations';
  fetchMock.mockReturnValue(new Promise(() => {}));
  let m = await mount();
  expect(
    m.view.container.querySelector('[aria-label="Loading invitations"]'),
  ).not.toBeNull();
  await m.view.unmount();

  fetchMock.mockReset();
  reply(json(page([])));
  m = await mount();
  await settleUntil(() =>
    m.view.container.textContent!.includes('No invitations'),
  );
  await m.view.unmount();

  nav.search = 'tab=invitations&query=zzz';
  m = await mount();
  await settleUntil(() =>
    m.view.container.textContent!.includes('No invitations match “zzz”'),
  );
  await m.view.unmount();

  nav.search = 'tab=invitations';
  fetchMock.mockReset();
  reply(failure('AUTH_UNAVAILABLE', 500));
  m = await mount();
  await settleUntil(() =>
    m.view.container.textContent!.includes('We could not load invitations.'),
  );
  expect(m.view.container.textContent).not.toContain('No invitations');
  await m.view.unmount();
});

test('filtering on the Invitations tab keeps the tab in the URL', async () => {
  nav.search = 'tab=invitations';
  reply(json(page([invitation()])));
  const { view } = await mount();
  await settleUntil(() => !!view.container.querySelector('table'));
  const input = view.container.querySelector(
    'input[type="search"]',
  ) as HTMLInputElement;
  vi.useFakeTimers();
  await typeInto(input, 'joko');
  await act(async () => vi.advanceTimersByTime(400));
  vi.useRealTimers();
  expect(nav.replace).toHaveBeenLastCalledWith(
    '/platform/accounts?query=joko&tab=invitations',
  );
  await view.unmount();
});

async function openDialog() {
  reply(json(page([account()])));
  const m = await mount();
  await settleUntil(() => !!m.view.container.querySelector('table'));
  await click(byText(m.view.container, 'button', 'Invite account')!);
  await settle();
  const email = document.querySelector(
    'input[type="email"]',
  ) as HTMLInputElement;
  const form = document.querySelector('form')!;
  return { ...m, email, form };
}
const fill = async (el: HTMLInputElement, v: string) => {
  await typeInto(el, v);
};
const send = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  await settle();
};

test('invite dialog shows the 409 as a field error under Email', async () => {
  const { view, email, form } = await openDialog();
  expect(document.body.textContent).toContain('Invite someone to Lexon');
  replyOnce(
    failure('PLATFORM_INVITATION_CONFLICT', 409, [
      {
        path: 'email',
        message:
          'This address already has a Lexon account or a pending invitation.',
      },
    ]),
  );
  await fill(email, 'rina@kusumalaw.co.id');
  await send(form);
  const alert = document.querySelector(
    `#${email.getAttribute('aria-describedby')!.split(' ').pop()}`,
  );
  expect(alert?.textContent).toBe(
    'This address already has a Lexon account or a pending invitation.',
  );
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(toastSuccess).not.toHaveBeenCalled();
  await view.unmount();
});

test('invite dialog is pending while sending and posts the input', async () => {
  const { view, email, form } = await openDialog();
  let release!: (r: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
  await fill(email, 'rina@kusumalaw.co.id');
  await send(form);
  const submit = form.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  const post = fetchMock.mock.calls.at(-1)!;
  expect(post[0]).toBe('/api/platform/account-invitations');
  expect(post[1].method).toBe('POST');
  expect(JSON.parse(post[1].body)).toEqual({ email: 'rina@kusumalaw.co.id' });
  await act(async () => release(failure('AUTH_RATE_LIMITED', 429)));
  await settle();
  expect(document.body.textContent).toContain('Too many invitations');
  expect(submit.disabled).toBe(false);
  await view.unmount();
});

test('re-auth required shows the confirm-identity message', async () => {
  const { view, email, form } = await openDialog();
  replyOnce(failure('AUTH_REAUTH_REQUIRED', 403));
  await fill(email, 'rina@kusumalaw.co.id');
  await send(form);
  expect(document.body.textContent).toContain(
    'Confirm your identity in account security',
  );
  await view.unmount();
});

test('a sent invitation is prepended to the cached Invitations list and toasts', async () => {
  const { view, client, email, form } = await openDialog();
  const key = ['platform', 'account-invitations', '', [], 1, 20];
  client.setQueryData(key, page([invitation()]));
  const created = invitation({
    id: '6b241101-e2bb-4255-8caf-4136c566a962',
    email: 'rina@kusumalaw.co.id',
    name: 'Rina Kusuma',
    status: 'pending',
  });
  replyOnce(json(created, 201));
  await fill(email, 'rina@kusumalaw.co.id');
  await send(form);
  const cached = client.getQueryData<ReturnType<typeof page>>(key)!;
  expect(cached.items.map((i) => (i as { email: string }).email)).toEqual([
    'rina@kusumalaw.co.id',
    'joko@gmail.com',
  ]);
  expect(cached.total).toBe(2);
  expect(toastSuccess).toHaveBeenCalledWith(
    'Invitation sent to rina@kusumalaw.co.id.',
  );
  expect(document.querySelector('form')).toBeNull();
  await view.unmount();
});
