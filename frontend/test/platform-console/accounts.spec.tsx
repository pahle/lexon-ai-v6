import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountsPage } from '../../src/components/platform-console/accounts-page';
import {
  formatPlatformDate,
  formatPlatformDateTime,
} from '../../src/components/platform/platform-format';
import { render, settle, settleUntil } from '../render';
import { byLabel, byText, click, typeInto } from '../data-views/helpers';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: '' }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => '/platform/accounts',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));
const ME = vi.hoisted(() => ({
  id: 'aaaaaaaa-e2bb-4255-8caf-4136c566a962',
  loaded: true,
}));
vi.mock('../../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: ME.loaded ? { user: { id: ME.id } } : null,
  }),
}));

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
  ME.loaded = true;
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
  const view = await render(
    <QueryClientProvider client={client}>
      <AccountsPage />
    </QueryClientProvider>,
  );
  return { view, client };
}
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

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
  expect(urls()).toContain('/api/platform/accounts?page=1&pageSize=20');
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
  await settleUntil(() => urls().some((u) => u.includes('page=2')));
  expect(urls()).toContain(
    '/api/platform/accounts?query=ayu&status=active&status=disabled&twoFactor=off&page=2&pageSize=20',
  );
  // Selected facets show their chips, which then name the trigger.
  const facets = Array.from(
    view.container.querySelectorAll('[data-slot="dropdown-menu-trigger"]'),
  ).map((trigger) => trigger.textContent);
  expect(facets).toContain('StatusActiveDisabled');
  expect(facets).toContain('Two-stepOff');
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
  expect(urls()).toContain(
    '/api/platform/account-invitations?page=1&pageSize=20',
  );
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

const byUrl = (routes: Record<string, () => Response>) =>
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string }) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const hit = Object.entries(routes).find(([k]) => key.startsWith(k));
      return hit ? hit[1]() : json(page([]));
    },
  );
const INV = '4b241101-e2bb-4255-8caf-4136c566a962';

test('tab count pills show each list total, not the filtered page', async () => {
  byUrl({
    'GET /api/platform/accounts': () => json(page([account()], 248)),
    'GET /api/platform/account-invitations': () =>
      json(page([invitation()], 2)),
  });
  const { view } = await mount();
  await settleUntil(
    () => view.container.querySelectorAll('[role="tab"] span').length === 2,
  );
  const tabs = Array.from(view.container.querySelectorAll('[role="tab"]')).map(
    (t) => t.textContent,
  );
  expect(tabs).toEqual(['Accounts248', 'Invitations2']);
  await view.unmount();
});

async function openInvitationMenu(extra: Record<string, () => Response> = {}) {
  nav.search = 'tab=invitations';
  byUrl({
    'GET /api/platform/account-invitations': () => json(page([invitation()])),
    ...extra,
  });
  const m = await mount();
  await settleUntil(() => !!m.view.container.querySelector('table'));
  const trigger = byLabel(m.view.container, 'Actions for joko@gmail.com')!;
  await click(trigger);
  await settle();
  return m;
}
const item = (label: string) =>
  Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
    (n) => n.textContent === label,
  ) as HTMLElement;
const listFetches = () =>
  urls().filter((u) => u.includes('account-invitations?')).length;

test('menu lists Resend then Cancel invitation last', async () => {
  const { view } = await openInvitationMenu();
  expect(
    Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(
      (n) => n.textContent,
    ),
  ).toEqual(['Resend invitation', 'Cancel invitation']);
  await view.unmount();
});

test('Resend posts, toasts, and refetches the list', async () => {
  const { view } = await openInvitationMenu({
    [`POST /api/platform/account-invitations/${INV}/resend`]: () =>
      new Response(null, { status: 204 }),
  });
  const before = listFetches();
  await click(item('Resend invitation'));
  await settleUntil(() => listFetches() > before);
  expect(urls()).toContain(`/api/platform/account-invitations/${INV}/resend`);
  expect(toastSuccess).toHaveBeenCalledWith(
    'Invitation resent to joko@gmail.com.',
  );
  await view.unmount();
});

test('Resend: 429 toasts, 404 refreshes the list, re-auth explains', async () => {
  for (const [code, status, text, refetch] of [
    [
      'AUTH_RATE_LIMITED',
      429,
      'Too many requests. Wait a moment and try again.',
      false,
    ],
    [
      'PLATFORM_INVITATION_NOT_FOUND',
      404,
      'That invitation no longer exists.',
      true,
    ],
    [
      'AUTH_REAUTH_REQUIRED',
      403,
      'Confirm your identity in account security, then try again.',
      false,
    ],
  ] as const) {
    toastError.mockClear();
    const { view } = await openInvitationMenu({
      [`POST /api/platform/account-invitations/${INV}/resend`]: () =>
        failure(code, status),
    });
    const before = listFetches();
    await click(item('Resend invitation'));
    await settleUntil(() => toastError.mock.calls.length > 0);
    expect(toastError).toHaveBeenCalledWith(text);
    expect(toastSuccess).not.toHaveBeenCalled();
    if (refetch) await settleUntil(() => listFetches() > before);
    else expect(listFetches()).toBe(before);
    await view.unmount();
    fetchMock.mockReset();
  }
});

test('Cancel invitation asks first, naming the email, then deletes and refetches', async () => {
  const { view } = await openInvitationMenu({
    [`DELETE /api/platform/account-invitations/${INV}`]: () =>
      new Response(null, { status: 204 }),
  });
  await click(item('Cancel invitation'));
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain(
    'Cancel the invitation to joko@gmail.com?',
  );
  expect(urls().some((u) => u.endsWith(INV))).toBe(false);
  const before = listFetches();
  await click(byText(dialog as HTMLElement, 'button', 'Cancel invitation')!);
  await settleUntil(() => listFetches() > before);
  expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(
    true,
  );
  expect(toastSuccess).toHaveBeenCalledWith(
    'Invitation to joko@gmail.com canceled.',
  );
  await view.unmount();
});

test('Cancel invitation: re-auth failure toasts and keeps the row', async () => {
  const { view } = await openInvitationMenu({
    [`DELETE /api/platform/account-invitations/${INV}`]: () =>
      failure('AUTH_REAUTH_REQUIRED', 403),
  });
  await click(item('Cancel invitation'));
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]')!;
  await click(byText(dialog as HTMLElement, 'button', 'Cancel invitation')!);
  await settleUntil(() => toastError.mock.calls.length > 0);
  expect(toastError).toHaveBeenCalledWith(
    'Confirm your identity in account security, then try again.',
  );
  expect(view.container.textContent).toContain('joko@gmail.com');
  await view.unmount();
});

// Brief item 2 (spec §13 entry 5): View account, Sign out everywhere, and
// Disable or Enable account; self rules apply; the record page's
// confirmations and toasts.
async function openAccountMenu(
  row: object,
  extra: Record<string, () => Response> = {},
) {
  byUrl({
    'GET /api/platform/accounts': () => json(page([account(row)])),
    ...extra,
  });
  const m = await mount();
  await settleUntil(() => !!m.view.container.querySelector('table'));
  const name = (account(row) as { name: string }).name;
  await click(byLabel(m.view.container, `Actions for ${name}`)!);
  await settle();
  return m;
}
const menuItems = () =>
  Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(
    (n) => n.textContent,
  );
const listCalls = () =>
  urls().filter((u) => u.startsWith('/api/platform/accounts?')).length;
const OTHER = { isPlatformAdministrator: false, name: 'Ayu Wardani' };

test('account row menu: View, a separator, Sign out everywhere, Disable last', async () => {
  const { view } = await openAccountMenu(OTHER);
  expect(menuItems()).toEqual([
    'View account',
    'Sign out everywhere',
    'Disable account',
  ]);
  const menu = document.body.querySelector('[role="menu"]')!;
  const children = Array.from(menu.children);
  const sep = children.findIndex((c) => c.getAttribute('role') === 'separator');
  expect(sep).toBe(1);
  expect(item('Disable account').getAttribute('data-variant')).toBe(
    'destructive',
  );
  await view.unmount();
});

test('row menu Disable asks with the record confirmation, then disables and refreshes', async () => {
  const { view } = await openAccountMenu(OTHER, {
    [`PATCH /api/platform/users/${ID}/disabled`]: () =>
      new Response(null, { status: 204 }),
  });
  await click(item('Disable account'));
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  expect(dialog).not.toBeNull();
  const confirm = byText(dialog, 'button', 'Disable account')!;
  expect(confirm.className).toContain('--lexon-destructive-fill');
  expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(
    false,
  );
  const before = listCalls();
  await click(confirm);
  await settleUntil(() => listCalls() >= before + 2);
  const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
  expect(JSON.parse(patch[1].body)).toEqual({ disabled: true });
  expect(toastSuccess).toHaveBeenCalledWith('Account disabled.');
  await view.unmount();
});

test('row menu Sign out everywhere asks first, then revokes and refreshes', async () => {
  const { view } = await openAccountMenu(OTHER, {
    [`POST /api/platform/accounts/${ID}/sessions/revoke`]: () =>
      new Response(null, { status: 204 }),
  });
  await click(item('Sign out everywhere'));
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  expect(dialog.textContent).toContain('Sign Ayu Wardani out everywhere?');
  expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  const before = listCalls();
  await click(byText(dialog, 'button', 'Sign out everywhere')!);
  await settleUntil(() => listCalls() >= before + 2);
  expect(urls()).toContain(`/api/platform/accounts/${ID}/sessions/revoke`);
  expect(toastSuccess).toHaveBeenCalledWith(
    'Ayu Wardani was signed out everywhere.',
  );
  await view.unmount();
});

test('row menu on a disabled account: Enable account, no confirmation', async () => {
  const { view } = await openAccountMenu(
    { ...OTHER, status: 'disabled' },
    {
      [`PATCH /api/platform/users/${ID}/disabled`]: () =>
        new Response(null, { status: 204 }),
    },
  );
  expect(menuItems()).toEqual(['View account', 'Enable account']);
  const before = listCalls();
  await click(item('Enable account'));
  await settleUntil(() => listCalls() >= before + 2);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
  expect(JSON.parse(patch[1].body)).toEqual({ disabled: false });
  expect(toastSuccess).toHaveBeenCalledWith('Account enabled.');
  await view.unmount();
});

test('row menu on an unverified account: View and Disable', async () => {
  const { view } = await openAccountMenu({ ...OTHER, status: 'unverified' });
  expect(menuItems()).toEqual(['View account', 'Disable account']);
  await view.unmount();
});

test('own row and unknown identity offer only View account', async () => {
  let m = await openAccountMenu({ id: ME.id });
  expect(menuItems()).toEqual(['View account']);
  await m.view.unmount();
  fetchMock.mockReset();
  ME.loaded = false;
  m = await openAccountMenu(OTHER);
  expect(menuItems()).toEqual(['View account']);
  await m.view.unmount();
});

test('row menu action failures toast the record page message', async () => {
  const { view } = await openAccountMenu(OTHER, {
    [`PATCH /api/platform/users/${ID}/disabled`]: () =>
      failure('PLATFORM_LAST_ADMINISTRATOR', 409),
  });
  await click(item('Disable account'));
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  await click(byText(dialog, 'button', 'Disable account')!);
  await settleUntil(() => toastError.mock.calls.length > 0);
  expect(toastError).toHaveBeenCalledWith(
    'This is the last platform administrator. Make another account an administrator first.',
  );
  await view.unmount();
});

test('row menu confirmations use the prototype copy without a session count', async () => {
  const { view } = await openAccountMenu(OTHER);
  await click(item('Sign out everywhere'));
  await settle();
  let dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  expect(
    dialog.querySelector('[data-slot="alert-dialog-title"]')!.textContent,
  ).toBe('Sign Ayu Wardani out everywhere?');
  expect(
    dialog.querySelector('[data-slot="alert-dialog-description"]')!.textContent,
  ).toBe(
    'All sessions end on every device, including apps signed in with a token. Ayu Wardani can sign in again.',
  );
  await click(byText(dialog, 'button', 'Cancel')!);
  await settle();
  await click(byLabel(view.container, 'Actions for Ayu Wardani')!);
  await settle();
  await click(item('Disable account'));
  await settle();
  dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  expect(
    dialog.querySelector('[data-slot="alert-dialog-title"]')!.textContent,
  ).toBe('Disable Ayu Wardani’s account?');
  expect(
    dialog.querySelector('[data-slot="alert-dialog-description"]')!.textContent,
  ).toBe(
    'Ayu Wardani is signed out everywhere and cannot sign in until you enable the account again. Their teams and content stay unchanged.',
  );
  await view.unmount();
});

// Spec §13 entry 7: relative last active, the absolute value in a title.
const lastActiveRows = () =>
  [
    ['admin', new Date(2026, 10, 14, 11, 0)],
    ['ayu', new Date(2026, 10, 14, 10, 42)],
    ['rizky', new Date(2026, 10, 13, 10, 0)],
    ['hendra', new Date(2026, 10, 12, 10, 0)],
    ['lina', new Date(2026, 9, 31, 10, 0)],
    ['old', new Date(2026, 8, 1, 10, 0)],
    ['bagus', null],
  ].map(([key, at], index) =>
    account({
      id: `0000000${index}-e2bb-4255-8caf-4136c566a962`,
      name: `Person ${String(key)}`,
      email: `${String(key)}@x.id`,
      isPlatformAdministrator: false,
      lastActiveAt: at ? (at as Date).toISOString() : null,
    }),
  );
const LABELS = [
  'Active now',
  'Today',
  'Yesterday',
  '2 days ago',
  '2 weeks ago',
  '1 Sep 2026',
  'Never',
];

test('Last active column is relative to the clock with the absolute title', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 14, 11, 0));
  try {
    const rows = lastActiveRows();
    reply(json(page(rows)));
    const { view } = await mount();
    await settleUntil(() => !!view.container.querySelector('table'));
    const lastActiveIndex = Array.from(
      view.container.querySelectorAll('th'),
    ).findIndex((th) => th.textContent === 'Last active');
    const cells = Array.from(view.container.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelectorAll('td')[lastActiveIndex]!,
    );
    expect(cells.map((c) => c.textContent)).toEqual(LABELS);
    rows.forEach((row, i) => {
      const value = (row as { lastActiveAt: string | null }).lastActiveAt;
      const titled = cells[i]!.querySelector('[title]');
      if (value)
        expect(titled!.getAttribute('title')).toBe(
          formatPlatformDateTime(value),
        );
      else expect(titled).toBeNull();
    });
    await view.unmount();
  } finally {
    vi.useRealTimers();
  }
});

test('mobile account rows end with the relative last active', async () => {
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 14, 11, 0));
  try {
    reply(json(page(lastActiveRows().slice(1, 3))));
    const { view } = await mount();
    await settleUntil(
      () => !!view.container.querySelector('[data-slot="data-mobile-row"]'),
    );
    const rows = Array.from(
      view.container.querySelectorAll('[data-slot="data-mobile-row"]'),
    );
    expect(rows.map((r) => r.textContent)).toEqual([
      'PAPerson ayuayu@x.idActiveTwo-step on · 0 teams · Today',
      'PRPerson rizkyrizky@x.idActiveTwo-step on · 0 teams · Yesterday',
    ]);
    await view.unmount();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', fetchMock);
  }
});

// Spec §13 entry 8: the prototype's mobile invitation rows.
test('mobile invitation rows: person, status, "Sent … · Expires …", row menu', async () => {
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
  try {
    nav.search = 'tab=invitations';
    const rina = invitation({
      id: '5b241101-e2bb-4255-8caf-4136c566a962',
      name: 'Rina Kusuma',
      email: 'rina@kusumalaw.co.id',
      status: 'pending',
      sentAt: '2026-11-19T03:00:00.000Z',
      expiresAt: '2026-11-26T03:00:00.000Z',
    });
    reply(json(page([rina, invitation()])));
    const { view } = await mount();
    await settleUntil(
      () => !!view.container.querySelector('[data-slot="data-mobile-row"]'),
    );
    const rows = Array.from(
      view.container.querySelectorAll('[data-slot="data-mobile-row"]'),
    );
    const d = formatPlatformDate;
    expect(rows.map((r) => r.textContent)).toEqual([
      `Rina Kusumarina@kusumalaw.co.idPendingSent ${d('2026-11-19T03:00:00.000Z')} · Expires ${d('2026-11-26T03:00:00.000Z')}`,
      `joko@gmail.comExpiredSent ${d('2026-11-02T03:00:00.000Z')} · Expires ${d('2026-11-09T03:00:00.000Z')}`,
    ]);
    expect(
      rows[1]!.querySelector('[aria-label="Actions for joko@gmail.com"]'),
    ).not.toBeNull();
    await view.unmount();
  } finally {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', fetchMock);
  }
});

// Facet choices made before the URL update lands (router.replace is a
// transition) must build on each other, not on the stale URL.
test('two facet toggles before the URL updates keep both choices', async () => {
  reply(json(page([account()])));
  const { view } = await mount();
  await settleUntil(() => !!view.container.querySelector('table'));
  const facet = (name: string) =>
    Array.from(
      view.container.querySelectorAll('[data-slot="dropdown-menu-trigger"]'),
    ).find((b) => b.textContent?.includes(name)) as HTMLElement;
  await click(facet('Status'));
  await settle();
  const option = (label: string) =>
    Array.from(
      document.body.querySelectorAll('[role="menuitemcheckbox"]'),
    ).find((n) => n.textContent === label) as HTMLElement;
  // The mocked router never changes the URL: both clicks see the old one.
  await act(async () => {
    option('Unverified').click();
    option('Disabled').click();
  });
  expect(nav.replace).toHaveBeenLastCalledWith(
    '/platform/accounts?status=unverified&status=disabled',
  );
  await act(async () =>
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  await settle();
  // A different facet chosen right after keeps the pending status choice.
  await click(facet('Two-step'));
  await settle();
  await act(async () => option('Off').click());
  expect(nav.replace).toHaveBeenLastCalledWith(
    '/platform/accounts?status=unverified&status=disabled&twoFactor=off',
  );
  await view.unmount();
});

// Prototype revision 16: mobile rows show the row menu unless the row sets
// `menu:false`; account rows never do.
function narrowCard() {
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
}

test('mobile account rows keep the row menu, self rules included', async () => {
  narrowCard();
  try {
    const rows = [
      account({ id: ME.id, name: 'Dimas Prasetyo' }),
      account({
        id: '11111111-e2bb-4255-8caf-4136c566a962',
        name: 'Ayu Wardani',
        email: 'ayu@x.id',
        isPlatformAdministrator: false,
      }),
      account({
        id: '22222222-e2bb-4255-8caf-4136c566a962',
        name: 'Lina Hartono',
        email: 'lina@x.id',
        status: 'disabled',
        isPlatformAdministrator: false,
      }),
    ];
    reply(json(page(rows)));
    const { view } = await mount();
    await settleUntil(
      () => !!view.container.querySelector('[data-slot="data-mobile-row"]'),
    );
    const expected: [string, string[]][] = [
      ['Dimas Prasetyo', ['View account']],
      [
        'Ayu Wardani',
        ['View account', 'Sign out everywhere', 'Disable account'],
      ],
      ['Lina Hartono', ['View account', 'Enable account']],
    ];
    const mobileRows = Array.from(
      view.container.querySelectorAll('[data-slot="data-mobile-row"]'),
    );
    for (const [index, [name, items]] of expected.entries()) {
      const trigger = mobileRows[index]!.querySelector(
        `[aria-label="Actions for ${name}"]`,
      ) as HTMLElement;
      expect(trigger, name).not.toBeNull();
      await click(trigger);
      await settle();
      expect(menuItems()).toEqual(items);
      // Opening the menu does not open the record.
      expect(nav.push).not.toHaveBeenCalled();
      await act(async () =>
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      await settle();
    }
    // A menu action stays in the list: Disable asks first.
    await click(
      mobileRows[1]!.querySelector(
        '[aria-label="Actions for Ayu Wardani"]',
      ) as HTMLElement,
    );
    await settle();
    await click(item('Disable account'));
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    // The row itself still opens the record.
    await click(mobileRows[1]!.querySelector('b')!);
    expect(nav.push).toHaveBeenCalledWith(
      '/platform/accounts/11111111-e2bb-4255-8caf-4136c566a962',
    );
    await view.unmount();
  } finally {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', fetchMock);
  }
});

// LEX-DS-001 §5.7, prototype revision 16 `.badge.warn`: red-text with a 45%
// red-text border, never amber.
const expectWarnBadge = (root: ParentNode, label: string) => {
  const badges = Array.from(root.querySelectorAll('span.rounded-full')).filter(
    (n) => n.textContent?.trim() === label,
  );
  expect(badges.length, label).toBeGreaterThan(0);
  for (const b of badges) {
    const classes = b.className.split(/\s+/);
    expect(classes, label).toContain('text-lexon-red-text');
    expect(classes, label).toContain('border-lexon-red-text/45');
    expect(
      classes.some((c) => c.includes('lexon-warning')),
      label,
    ).toBe(false);
  }
};

test('Unverified and Expired badges use the red-text warning badge', async () => {
  reply(json(page([account({ status: 'unverified' })])));
  const { view } = await mount();
  await settleUntil(() => !!view.container.querySelector('table'));
  expectWarnBadge(view.container, 'Unverified');
  await view.unmount();
  nav.search = 'tab=invitations';
  reply(json(page([invitation()])));
  const second = await mount();
  await settleUntil(() => !!second.view.container.querySelector('table'));
  expectWarnBadge(second.view.container, 'Expired');
  await second.view.unmount();
});

// Prototype revision 16 inviteDialog: `<label>Name <span class="opt">Optional
// </span></label>` with `.field label{display:flex;justify-content:
// space-between}` and `.opt{font-weight:400;color:var(--mfg);font-size:13px}`.
test('invite dialog shows Optional to the right of the Name label', async () => {
  const { view } = await openDialog();
  const label = byText(document.body, 'label', 'Name')!;
  expect(label).toBeDefined();
  const optional = byText(document.body, 'span', 'Optional')!;
  expect(optional).toBeDefined();
  const row = label.parentElement!;
  expect(optional.parentElement).toBe(row);
  const rowClasses = row.className.split(/\s+/);
  for (const c of ['flex', 'items-start', 'justify-between'])
    expect(rowClasses, c).toContain(c);
  const optClasses = optional.className.split(/\s+/);
  for (const c of ['text-[13px]', 'font-normal', 'text-muted-foreground'])
    expect(optClasses, c).toContain(c);
  const input = document.getElementById(label.getAttribute('for')!)!;
  expect(input.getAttribute('aria-describedby')).toContain(optional.id);
  // No hint line under the input any more.
  expect(byText(document.body, 'p', 'Optional')).toBeUndefined();
  await view.unmount();
});
