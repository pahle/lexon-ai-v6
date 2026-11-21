import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountRecord } from '../../src/components/platform-console/account-record';
import { render, settle, settleUntil } from '../render';
import { byText, click } from '../data-views/helpers';

const ME = vi.hoisted(() => ({
  id: 'aaaaaaaa-e2bb-4255-8caf-4136c566a962',
  loaded: true,
}));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock('../../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: ME.loaded ? { user: { id: ME.id } } : null,
  }),
}));

const ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const detail = (over: object = {}) => ({
  id: ID,
  name: 'Ayu Wardani',
  email: 'ayu@hukum-nusantara.co.id',
  status: 'active',
  twoFactorEnabled: true,
  isPlatformAdministrator: false,
  teamCount: 2,
  createdAt: '2026-09-02T03:00:00.000Z',
  lastActiveAt: '2026-11-20T03:00:00.000Z',
  emailVerified: true,
  activeSessionCount: 3,
  teams: [
    {
      organizationId: '1b241101-e2bb-4255-8caf-4136c566a962',
      name: 'Hukum Nusantara',
      slug: 'hukum-nusantara',
      role: 'owner',
    },
    {
      organizationId: '2b241101-e2bb-4255-8caf-4136c566a962',
      name: 'Pro Bono Clinic',
      slug: 'pro-bono-clinic',
      role: 'member',
    },
  ],
  ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const failure = (code: string, status: number) =>
  json({ error: { code, message: 'x' } }, status);
const none = () => new Response(null, { status: 204 });

const fetchMock = vi.fn();
type Routes = Record<string, () => Response>;
const routes = (r: Routes) =>
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string }) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const hit = Object.entries(r).find(([k]) => key.startsWith(k));
      return hit ? hit[1]() : json({}, 500);
    },
  );
const GET = `GET /api/platform/accounts/${ID}`;
const calls = (prefix: string) =>
  fetchMock.mock.calls.filter((c) =>
    `${c[1]?.method ?? 'GET'} ${c[0]}`.startsWith(prefix),
  ).length;

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  ME.loaded = true;
  fetchMock.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
  document.body.innerHTML = '';
});

async function mount(userId = ID) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <AccountRecord userId={userId} />
    </QueryClientProvider>,
  );
  await settleUntil(
    () =>
      !view.container.querySelector('[aria-busy="true"]') &&
      view.container.textContent!.length > 0,
  );
  return view;
}
const text = (v: { container: HTMLElement }) => v.container.textContent!;
const button = (label: string) =>
  Array.from(document.body.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLElement | undefined;

test('active account: header, stat tiles, details, teams, actions', async () => {
  routes({ [GET]: () => json(detail()) });
  const v = await mount();
  const t = text(v);
  expect(t).toContain('Ayu Wardani');
  expect(t).toContain('Active');
  expect(t).toContain('ayu@hukum-nusantara.co.id');
  expect(t).toContain('Joined 2 Sep 2026');
  expect(t).toContain('Last active 20 Nov 2026');
  for (const s of ['Teams', 'Active sessions', 'Two-step verification'])
    expect(t).toContain(s);
  expect(t).toContain('On');
  expect(t).toContain('Email verified');
  expect(t).toContain('Account ID');
  expect(t).toContain(ID);
  expect(t).toContain('Hukum Nusantara');
  expect(t).toContain('Pro Bono Clinic');
  expect(t).toContain('Owner');
  expect(button('Sign out everywhere')).toBeDefined();
  expect(button('Disable account')).toBeDefined();
  expect(button('Resend verification email')).toBeUndefined();
  await v.unmount();
});

test('teams empty state', async () => {
  routes({ [GET]: () => json(detail({ teams: [], teamCount: 0 })) });
  const v = await mount();
  expect(text(v)).toContain('No teams yet');
  expect(text(v)).toContain('This account is not a member of any team.');
  await v.unmount();
});

test('unverified shows Resend verification email; 409 and 429 toast', async () => {
  for (const [code, status, msg] of [
    [
      'PLATFORM_ALREADY_VERIFIED',
      409,
      'This email address is already verified.',
    ],
    [
      'AUTH_RATE_LIMITED',
      429,
      'Too many requests. Wait a moment and try again.',
    ],
  ] as const) {
    toastError.mockClear();
    routes({
      [GET]: () =>
        json(
          detail({
            status: 'unverified',
            emailVerified: false,
            activeSessionCount: 0,
          }),
        ),
      [`POST /api/platform/accounts/${ID}/verification-email`]: () =>
        failure(code, status),
    });
    const v = await mount();
    expect(text(v)).toContain('Unverified');
    await click(button('Resend verification email')!);
    await settleUntil(() => toastError.mock.calls.length > 0);
    expect(toastError).toHaveBeenCalledWith(msg);
    await v.unmount();
  }
});

test('Resend verification email success toasts', async () => {
  routes({
    [GET]: () => json(detail({ status: 'unverified', emailVerified: false })),
    [`POST /api/platform/accounts/${ID}/verification-email`]: none,
  });
  const v = await mount();
  await click(button('Resend verification email')!);
  expect(toastSuccess).toHaveBeenCalledWith(
    'Verification email sent to ayu@hukum-nusantara.co.id.',
  );
  await v.unmount();
});

test('disabled shows Enable account, zero sessions, no Disable', async () => {
  routes({
    [GET]: () => json(detail({ status: 'disabled', activeSessionCount: 0 })),
    [`PATCH /api/platform/users/${ID}/disabled`]: none,
  });
  const v = await mount();
  expect(text(v)).toContain('Disabled');
  expect(text(v)).toContain('Signed out when disabled');
  expect(button('Disable account')).toBeUndefined();
  expect(button('Sign out everywhere')).toBeUndefined();
  const before = calls(GET);
  await click(button('Enable account')!);
  await settleUntil(() => calls(GET) > before);
  const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
  expect(JSON.parse(patch[1].body)).toEqual({ disabled: false });
  expect(toastSuccess).toHaveBeenCalledWith('Account enabled.');
  await v.unmount();
});

test('Disable confirmation names the person, uses the destructive fill, then disables', async () => {
  routes({
    [GET]: () => json(detail()),
    [`PATCH /api/platform/users/${ID}/disabled`]: none,
  });
  const v = await mount();
  await click(button('Disable account')!);
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain('Disable Ayu Wardani?');
  const confirm = byText(dialog as HTMLElement, 'button', 'Disable account')!;
  expect(confirm.className).toContain('--lexon-destructive-fill');
  expect(calls('PATCH')).toBe(0);
  const before = calls(GET);
  await click(confirm);
  await settleUntil(() => calls(GET) > before);
  const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
  expect(JSON.parse(patch[1].body)).toEqual({ disabled: true });
  expect(toastSuccess).toHaveBeenCalledWith('Account disabled.');
  await v.unmount();
});

test('Sign out everywhere asks first, then revokes sessions', async () => {
  routes({
    [GET]: () => json(detail()),
    [`POST /api/platform/accounts/${ID}/sessions/revoke`]: none,
  });
  const v = await mount();
  await click(button('Sign out everywhere')!);
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain('Sign Ayu Wardani out everywhere?');
  expect(calls('POST')).toBe(0);
  await click(byText(dialog as HTMLElement, 'button', 'Sign out everywhere')!);
  await settleUntil(() => calls('POST') > 0);
  expect(toastSuccess).toHaveBeenCalledWith(
    'Ayu Wardani was signed out everywhere.',
  );
  await v.unmount();
});

test('self, last administrator, and re-auth failures explain themselves', async () => {
  for (const [code, status, msg] of [
    ['PLATFORM_SELF_ACTION', 409, 'You cannot do that to your own account.'],
    [
      'PLATFORM_LAST_ADMINISTRATOR',
      409,
      'This is the last platform administrator. Make another account an administrator first.',
    ],
    [
      'AUTH_REAUTH_REQUIRED',
      403,
      'Confirm your identity in account security, then try again.',
    ],
  ] as const) {
    toastError.mockClear();
    routes({
      [GET]: () => json(detail()),
      [`PATCH /api/platform/users/${ID}/disabled`]: () => failure(code, status),
    });
    const v = await mount();
    await click(button('Disable account')!);
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    await click(byText(dialog as HTMLElement, 'button', 'Disable account')!);
    await settleUntil(() => toastError.mock.calls.length > 0);
    expect(toastError).toHaveBeenCalledWith(msg);
    await v.unmount();
  }
});

test('own detail offers neither Disable nor Sign out everywhere', async () => {
  routes({
    [`GET /api/platform/accounts/${ME.id}`]: () =>
      json(detail({ id: ME.id, isPlatformAdministrator: true })),
  });
  const v = await mount(ME.id);
  expect(text(v)).toContain('Platform administrator');
  expect(button('Disable account')).toBeUndefined();
  expect(button('Sign out everywhere')).toBeUndefined();
  await v.unmount();
});

test('loading, not found, and failure', async () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient();
  const v = await render(
    <QueryClientProvider client={client}>
      <AccountRecord userId={ID} />
    </QueryClientProvider>,
  );
  expect(v.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  await v.unmount();

  routes({ [GET]: () => failure('NOT_FOUND', 404) });
  let m = await mount();
  expect(text(m)).toContain('Account not found');
  expect(text(m)).not.toContain('We could not load');
  await m.unmount();

  routes({ [GET]: () => failure('AUTH_UNAVAILABLE', 500) });
  m = await mount();
  expect(text(m)).toContain('We could not load this account.');
  expect(text(m)).not.toContain('Account not found');
  await m.unmount();
});

test('no account actions while identity has not loaded', async () => {
  ME.loaded = false;
  routes({ [GET]: () => json(detail()) });
  const v = await mount();
  expect(text(v)).toContain('Ayu Wardani');
  expect(button('Disable account')).toBeUndefined();
  expect(button('Sign out everywhere')).toBeUndefined();
  await v.unmount();

  routes({
    [GET]: () => json(detail({ status: 'unverified', emailVerified: false })),
  });
  const u = await mount();
  expect(text(u)).toContain('Unverified');
  expect(button('Resend verification email')).toBeUndefined();
  expect(button('Disable account')).toBeUndefined();
  await u.unmount();
});
