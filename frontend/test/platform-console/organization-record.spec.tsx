import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationRecord } from '../../src/components/platform-console/organization-record';
import { organizationKey } from '../../src/components/platform-console/provisioning-actions';
import { render, settle, settleUntil } from '../render';
import { byLabel, byText, click, typeInto } from '../data-views/helpers';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const active = (over: object = {}) => ({
  id: ID,
  name: 'Hukum Nusantara',
  slug: 'hukum-nusantara',
  state: 'active',
  memberCount: 3,
  ownerEmail: 'ayu@hukum-nusantara.co.id',
  createdAt: '2026-09-02T03:00:00.000Z',
  requireTwoFactor: false,
  ...over,
});
const EXPIRES = '2026-11-21T04:00:00.000Z';
const provisioning = (over: object = {}) => ({
  version: 1,
  id: ID,
  name: 'Harbor Legal Partners',
  slug: 'harbor-legal-partners',
  kind: 'team',
  state: 'provisioning',
  createdAt: '2026-11-14T03:00:00.000Z',
  invitation: {
    id: '6b241101-e2bb-4255-8caf-4136c566a962',
    status: 'pending',
    expiresAt: EXPIRES,
  },
  memberCount: 0,
  ownerEmail: 'owner@harborlegal.co.id',
  ...over,
});
// The provisioning action routes answer today's strict ProvisioningSummary.
const summary = () => {
  const rest: Record<string, unknown> = { ...provisioning() };
  delete rest.memberCount;
  delete rest.ownerEmail;
  return rest;
};
const member = (name: string, email: string, role: string, n: number) => ({
  userId: `${n}b241101-e2bb-4255-8caf-4136c566a962`,
  name,
  email,
  role,
  joinedAt: '2026-09-03T03:00:00.000Z',
});
const MEMBERS = [
  member('Ayu Wardani', 'ayu@hukum-nusantara.co.id', 'owner', 5),
  member('Rizky Pratama', 'rizky@hukum-nusantara.co.id', 'admin', 7),
  member('Sari Wibowo', 'sari@hukum-nusantara.co.id', 'member', 8),
];
const membersPage = (items = MEMBERS, total = items.length, page = 1) => ({
  items,
  page,
  pageSize: 50,
  total,
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
type Routes = Record<string, () => Response | Promise<Response>>;
const routes = (r: Routes) =>
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string }) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      // Longest matching prefix wins, so the members route beats the detail.
      const hit = Object.entries(r)
        .filter(([k]) => key.startsWith(k))
        .sort((a, b) => b[0].length - a[0].length)[0];
      return hit ? hit[1]() : json({}, 500);
    },
  );
const GET = `GET /api/platform/organizations/${ID}`;
const MEMBERS_GET = `GET /api/platform/organizations/${ID}/members`;
const PROV = `/api/platform/provisioning/${ID}`;
const calls = (prefix: string) =>
  fetchMock.mock.calls.filter((c) =>
    `${c[1]?.method ?? 'GET'} ${c[0]}`.startsWith(prefix),
  );
const detailCalls = () =>
  calls(GET).filter((c) => !String(c[0]).includes('/members')).length;

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
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
      <OrganizationRecord organizationId={ID} />
    </QueryClientProvider>,
  );
  await settleUntil(
    () =>
      !view.container.querySelector('[aria-label="Loading organization"]') &&
      view.container.textContent!.length > 0,
  );
  return view;
}
const text = (v: { container: HTMLElement }) => v.container.textContent!;
const button = (label: string, root: ParentNode = document.body) =>
  Array.from(root.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
const tiles = (v: { container: HTMLElement }) =>
  Array.from(v.container.querySelectorAll('[data-slot="stat-tile"]')).map(
    (t) => t.textContent,
  );

test('active organization: header, stat tiles, details, members', async () => {
  routes({
    [GET]: () => json(active()),
    [MEMBERS_GET]: () => json(membersPage()),
  });
  const v = await mount();
  await settleUntil(() => text(v).includes('Rizky Pratama'));
  const t = text(v);
  expect(v.container.querySelector('h1')!.textContent).toBe('Hukum Nusantara');
  expect(byText(v.container, 'a', 'Organizations')!.getAttribute('href')).toBe(
    '/platform/organizations',
  );
  expect(
    v.container
      .querySelector('[data-slot="record-avatar"]')!
      .className.includes('rounded-[14px]'),
  ).toBe(true);
  expect(t).toContain('Active');
  expect(t).toContain('Created 2 Sep 2026');
  expect(t).toContain('3 members');
  expect(tiles(v)).toEqual([
    'Members3',
    'Two-step verificationNot required',
    'Created2 Sep 2026',
  ]);
  for (const s of [
    'Name',
    'Slug',
    'Owner email',
    'Organization ID',
    ID,
    'ayu@hukum-nusantara.co.id',
  ])
    expect(t).toContain(s);
  expect(t).toContain('Opening this list is recorded in the audit log.');
  expect(
    Array.from(v.container.querySelectorAll('thead th')).map((th) =>
      th.textContent!.trim(),
    ),
  ).toEqual(['Member', 'Role', 'Joined', 'Open']);
  const rows = Array.from(v.container.querySelectorAll('tbody tr')).map((r) =>
    Array.from(r.querySelectorAll('td'))
      .slice(0, 3)
      .map((td) => td.textContent),
  );
  expect(rows).toEqual([
    ['AWAyu Wardaniayu@hukum-nusantara.co.id', 'Owner', '3 Sep 2026'],
    ['RPRizky Pratamarizky@hukum-nusantara.co.id', 'Admin', '3 Sep 2026'],
    ['SWSari Wibowosari@hukum-nusantara.co.id', 'Member', '3 Sep 2026'],
  ]);
  expect(byLabel(v.container, 'Open Ayu Wardani')!.getAttribute('href')).toBe(
    `/platform/accounts/${MEMBERS[0]!.userId}`,
  );
  expect(calls(MEMBERS_GET).map((c) => c[0])).toEqual([
    `/api/platform/organizations/${ID}/members?page=1&pageSize=50`,
  ]);
  expect(button('Resend invitation')).toBeUndefined();
  expect(button('Cancel provisioning')).toBeUndefined();
  await v.unmount();
});

test('active organization that requires two-step verification', async () => {
  routes({
    [GET]: () => json(active({ requireTwoFactor: true, memberCount: 1 })),
    [MEMBERS_GET]: () => json(membersPage(MEMBERS.slice(0, 1))),
  });
  const v = await mount();
  expect(tiles(v)).toContain('Two-step verificationRequired');
  expect(text(v)).toContain('1 member');
  await v.unmount();
});

test('members on a narrow card: the prototype mobile rows, no menu', async () => {
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
  routes({
    [GET]: () => json(active()),
    [MEMBERS_GET]: () => json(membersPage()),
  });
  const v = await mount();
  await settleUntil(
    () => !!v.container.querySelector('[data-slot="data-mobile-row"]'),
  );
  const rows = Array.from(
    v.container.querySelectorAll('[data-slot="data-mobile-row"]'),
  );
  expect(rows[0]!.textContent).toBe(
    'AWAyu Wardaniayu@hukum-nusantara.co.idOwnerJoined 3 Sep 2026',
  );
  expect(rows[0]!.querySelector('a')).toBeNull();
  await v.unmount();
});

test('members loading, then failure with Try again, never the empty text', async () => {
  let fail = true;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  routes({
    [GET]: () => json(active()),
    [MEMBERS_GET]: async () => {
      await gate;
      return fail ? failure('AUTH_UNAVAILABLE', 500) : json(membersPage());
    },
  });
  const v = await mount();
  expect(
    v.container.querySelector('[aria-label="Loading members"]'),
  ).not.toBeNull();
  release();
  await settleUntil(() => text(v).includes('We could not load members.'));
  expect(text(v)).not.toContain('No members');
  const before = calls(MEMBERS_GET).length;
  fail = false;
  await click(byText(v.container, 'button', 'Try again')!);
  await settleUntil(() => text(v).includes('Rizky Pratama'));
  expect(calls(MEMBERS_GET).length).toBe(before + 1);
  await v.unmount();
});

test('members paging asks for page 2', async () => {
  routes({
    [GET]: () => json(active({ memberCount: 120 })),
    [MEMBERS_GET]: () => json(membersPage(MEMBERS, 120)),
  });
  const v = await mount();
  await settleUntil(() => text(v).includes('Rizky Pratama'));
  expect(text(v)).toContain('120 members');
  expect(text(v)).toContain('Page 1 of 3');
  await click(byLabel(v.container, 'Next page')!);
  await settleUntil(() => calls(MEMBERS_GET).length > 1);
  expect(calls(MEMBERS_GET).at(-1)![0]).toBe(
    `/api/platform/organizations/${ID}/members?page=2&pageSize=50`,
  );
  await v.unmount();
});

test('members page resets to 1 when the organization changes in place', async () => {
  const B = '4b241101-e2bb-4255-8caf-4136c566a962';
  const B_MEMBERS_GET = `GET /api/platform/organizations/${B}/members`;
  routes({
    [GET]: () => json(active({ memberCount: 120 })),
    [MEMBERS_GET]: () => json(membersPage(MEMBERS, 120)),
    [`GET /api/platform/organizations/${B}`]: () =>
      json(active({ id: B, name: 'Kantor Hukum Baru', memberCount: 3 })),
    [B_MEMBERS_GET]: () => json(membersPage()),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // B was visited before, so its detail is cached and the record body stays
  // mounted across the client-side navigation.
  await client.prefetchQuery({
    queryKey: organizationKey(B),
    queryFn: async () =>
      active({ id: B, name: 'Kantor Hukum Baru', memberCount: 3 }),
  });
  const tree = (id: string) => (
    <QueryClientProvider client={client}>
      <OrganizationRecord organizationId={id} />
    </QueryClientProvider>
  );
  const v = await render(tree(ID));
  await settleUntil(() => text(v).includes('Page 1 of 3'));
  await click(byLabel(v.container, 'Next page')!);
  await settleUntil(() => calls(MEMBERS_GET).length > 1);
  await v.rerender(tree(B));
  await settleUntil(() => calls(B_MEMBERS_GET).length > 0);
  expect(calls(B_MEMBERS_GET).map((c) => c[0])).toEqual([
    `/api/platform/organizations/${B}/members?page=1&pageSize=50`,
  ]);
  await v.unmount();
});

test('provisioning organization: invitation, expiry, details, no members request', async () => {
  routes({ [GET]: () => json(provisioning()) });
  const v = await mount();
  const t = text(v);
  expect(v.container.querySelector('h1')!.textContent).toBe(
    'Harbor Legal Partners',
  );
  expect(t).toContain('Provisioning');
  expect(t).toContain('harbor-legal-partners');
  expect(t).toContain('Provisioned 14 Nov 2026');
  const time = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(EXPIRES));
  expect(tiles(v)).toEqual([
    'Owner invitationPending',
    `Expires21 Nov 2026${time}`,
    'Members0Until the owner accepts',
  ]);
  for (const s of [
    'Owner email',
    'owner@harborlegal.co.id',
    'Provisioned',
    'Organization ID',
    ID,
    'Replace owner email',
    'Sends a new invitation to a different person. The current invitation stops working.',
  ])
    expect(t).toContain(s);
  expect(
    v.container
      .querySelector('input[name="email"]')!
      .getAttribute('placeholder'),
  ).toBe('owner@firm.co.id');
  expect(button('Resend invitation')).toBeDefined();
  expect(button('Cancel provisioning')!.className).toContain(
    'text-lexon-red-text',
  );
  expect(calls(MEMBERS_GET)).toHaveLength(0);
  await v.unmount();
});

test('expired owner invitation reads Expired', async () => {
  routes({
    [GET]: () =>
      json(
        provisioning({
          invitation: { ...provisioning().invitation, status: 'expired' },
        }),
      ),
  });
  const v = await mount();
  expect(tiles(v)[0]).toBe('Owner invitationExpired');
  await v.unmount();
});

test('Resend invitation calls the resend route, toasts, and refreshes', async () => {
  routes({
    [GET]: () => json(provisioning()),
    [`POST ${PROV}/resend`]: () => json(summary()),
  });
  const v = await mount();
  const before = detailCalls();
  await click(button('Resend invitation')!);
  await settleUntil(() => toastSuccess.mock.calls.length > 0);
  expect(calls(`POST ${PROV}/resend`)).toHaveLength(1);
  expect(toastSuccess).toHaveBeenCalledWith('Owner invitation resent.');
  await settleUntil(() => detailCalls() > before);
  await v.unmount();
});

test('Resend failure toasts the safe message', async () => {
  routes({
    [GET]: () => json(provisioning()),
    [`POST ${PROV}/resend`]: () => failure('AUTH_RATE_LIMITED', 429),
  });
  const v = await mount();
  await click(button('Resend invitation')!);
  await settleUntil(() => toastError.mock.calls.length > 0);
  expect(toastError).toHaveBeenCalledWith(
    'Unable to complete this action. Refresh and check your access.',
  );
  expect(toastSuccess).not.toHaveBeenCalled();
  await v.unmount();
});

test('Replace owner email sends the new address', async () => {
  routes({
    [GET]: () => json(provisioning()),
    [`PATCH ${PROV}/owner-email`]: () => json(summary()),
  });
  const v = await mount();
  const input = v.container.querySelector(
    'input[name="email"]',
  ) as HTMLInputElement;
  await typeInto(input, 'new-owner@harborlegal.co.id');
  await act(async () => {
    input.form!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  await settleUntil(() => toastSuccess.mock.calls.length > 0);
  const patch = calls(`PATCH ${PROV}/owner-email`);
  expect(patch).toHaveLength(1);
  expect(JSON.parse(patch[0]![1].body)).toEqual({
    ownerEmail: 'new-owner@harborlegal.co.id',
  });
  expect(toastSuccess).toHaveBeenCalledWith('Owner invitation updated.');
  await settle();
  expect(input.value).toBe('');
  await v.unmount();
});

test('Cancel provisioning asks first, names the organization, then cancels and goes back', async () => {
  routes({
    [GET]: () => json(provisioning()),
    [`DELETE ${PROV}`]: none,
  });
  const v = await mount();
  await click(button('Cancel provisioning')!);
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  expect(dialog.textContent).toContain(
    'Cancel provisioning for Harbor Legal Partners?',
  );
  expect(dialog.textContent).toContain(
    'This deletes the provisioning organization and invalidates its owner invitation.',
  );
  const confirm = button('Cancel provisioning', dialog)!;
  expect(confirm.className).toContain('--lexon-destructive-fill');
  expect(calls('DELETE')).toHaveLength(0);
  expect(nav.push).not.toHaveBeenCalled();
  const before = detailCalls();
  await click(confirm);
  await settleUntil(() => nav.push.mock.calls.length > 0);
  expect(calls(`DELETE ${PROV}`)).toHaveLength(1);
  expect(toastSuccess).toHaveBeenCalledWith('Provisioning cancelled.');
  expect(nav.push).toHaveBeenCalledWith('/platform/organizations');
  // The record no longer exists: it is not refetched into a 404.
  expect(detailCalls()).toBe(before);
  await v.unmount();
});

test('Cancel provisioning: dismissing the dialog makes no request; a failure toasts and stays', async () => {
  routes({
    [GET]: () => json(provisioning()),
    [`DELETE ${PROV}`]: () => failure('ORG_FORBIDDEN', 403),
  });
  const v = await mount();
  await click(button('Cancel provisioning')!);
  await settle();
  let dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  await click(button('Cancel', dialog)!);
  await settle();
  expect(calls('DELETE')).toHaveLength(0);
  await click(button('Cancel provisioning')!);
  await settle();
  dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  await click(button('Cancel provisioning', dialog)!);
  await settleUntil(() => toastError.mock.calls.length > 0);
  expect(toastError).toHaveBeenCalledWith(
    'Unable to complete this action. Refresh and check your access.',
  );
  expect(nav.push).not.toHaveBeenCalled();
  await v.unmount();
});

test('loading, not found, and failure (never empty)', async () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  const client = new QueryClient();
  const v = await render(
    <QueryClientProvider client={client}>
      <OrganizationRecord organizationId={ID} />
    </QueryClientProvider>,
  );
  expect(
    v.container.querySelector('[aria-label="Loading organization"]'),
  ).not.toBeNull();
  await v.unmount();

  routes({ [GET]: () => failure('NOT_FOUND', 404) });
  let m = await mount();
  expect(text(m)).toContain('Organization not found');
  expect(byText(m.container, 'a', 'Back to organizations')).toBeDefined();
  expect(text(m)).not.toContain('We could not load');
  await m.unmount();

  routes({ [GET]: () => failure('AUTH_UNAVAILABLE', 500) });
  m = await mount();
  expect(text(m)).toContain('We could not load this organization.');
  expect(text(m)).not.toContain('Organization not found');
  const before = detailCalls();
  routes({
    [GET]: () => json(active()),
    [MEMBERS_GET]: () => json(membersPage()),
  });
  await click(byText(m.container, 'button', 'Try again')!);
  await settleUntil(() => text(m).includes('Hukum Nusantara'));
  expect(detailCalls()).toBe(before + 1);
  await m.unmount();
});

// Ported from platform-identity.spec.tsx (retired provisioning detail): while
// the resend is in flight no other action can start, and every control
// unlocks again after a failure and after a success.
test('Resend in flight locks Cancel and Replace; failure and success unlock them', async () => {
  let rejectResend!: (error: Error) => void;
  let resolveResend!: (response: Response) => void;
  let pendingResend = new Promise<Response>((_resolve, reject) => {
    rejectResend = reject;
  });
  routes({
    [GET]: () => json(provisioning()),
    [`POST ${PROV}/resend`]: () => pendingResend,
  });
  const v = await mount();
  const resend = button('Resend invitation')!;
  const cancel = button('Cancel provisioning')!;
  const replace = v.container.querySelector(
    'form button[type="submit"]',
  ) as HTMLButtonElement;
  expect(replace.textContent).toContain('Replace and send');
  const email = v.container.querySelector(
    'input[name="email"]',
  ) as HTMLInputElement;
  const locked = () => [
    resend.disabled,
    cancel.disabled,
    replace.disabled,
    email.disabled,
  ];
  expect(locked()).toEqual([false, false, false, false]);

  await click(resend);
  expect(locked()).toEqual([true, true, true, true]);
  // Only the operation in flight would announce itself; Replace stays quiet.
  expect(replace.querySelector('[aria-live="polite"]')).toBeNull();
  expect(calls('DELETE')).toHaveLength(0);
  expect(calls('PATCH')).toHaveLength(0);

  await act(async () => rejectResend(new TypeError('network failure')));
  await settleUntil(() => toastError.mock.calls.length > 0);
  expect(toastError).toHaveBeenCalledWith(
    'Service temporarily unavailable. Please try again.',
  );
  await settle();
  expect(locked()).toEqual([false, false, false, false]);

  pendingResend = new Promise<Response>((resolve) => {
    resolveResend = resolve;
  });
  await click(resend);
  expect(locked()).toEqual([true, true, true, true]);
  await act(async () => resolveResend(json(summary())));
  await settleUntil(() => toastSuccess.mock.calls.length > 0);
  await settle();
  expect(locked()).toEqual([false, false, false, false]);
  expect(calls(`POST ${PROV}/resend`)).toHaveLength(2);
  expect(calls('DELETE')).toHaveLength(0);
  await v.unmount();
});

// Ported from platform-identity.spec.tsx: a failed cancel shows only the safe
// message, never the server's own text.
test('Cancel provisioning failure never shows the server message', async () => {
  routes({
    [GET]: () => json(provisioning()),
    [`DELETE ${PROV}`]: () =>
      json(
        { error: { code: 'ORG_FORBIDDEN', message: 'Private failure' } },
        403,
      ),
  });
  const v = await mount();
  await click(button('Cancel provisioning')!);
  await settle();
  const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
  await click(button('Cancel provisioning', dialog)!);
  await settleUntil(() => toastError.mock.calls.length > 0);
  expect(toastError).toHaveBeenCalledWith(
    'Unable to complete this action. Refresh and check your access.',
  );
  expect(JSON.stringify(toastError.mock.calls)).not.toContain(
    'Private failure',
  );
  expect(document.body.textContent).not.toContain('Private failure');
  expect(text(v)).toContain('Harbor Legal Partners');
  await v.unmount();
});

function expectOneColumnBody(container: HTMLElement, titles: string[]) {
  const tilesBlock = container.querySelector(
    '[data-slot="stat-tile"]',
  )!.parentElement!;
  const card = (title: string) =>
    Array.from(container.querySelectorAll('section h2'))
      .find((h) => h.textContent?.startsWith(title))!
      .closest('section')!;
  const body = [tilesBlock, ...titles.map(card)];
  const column = tilesBlock.parentElement!;
  for (const el of body) expect(el.parentElement).toBe(column);
  for (let i = 1; i < body.length; i++)
    expect(
      body[i - 1]!.compareDocumentPosition(body[i]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  expect(column.className).toContain('flex-col');
  expect(
    container.querySelector('[class*="grid-cols-[minmax(0,1fr)_360px]"]'),
  ).toBeNull();
}

test('active body is one column in LEX-DS-001 §5.7 order: stat tiles, Details, Members', async () => {
  routes({
    [GET]: () => json(active()),
    [MEMBERS_GET]: () => json(membersPage()),
  });
  const v = await mount();
  await settleUntil(() => text(v).includes('Rizky Pratama'));
  expectOneColumnBody(v.container, ['Details', 'Members']);
});

test('provisioning body is one column in LEX-DS-001 §5.7 order: stat tiles, Details, Replace owner email', async () => {
  routes({ [GET]: () => json(provisioning()) });
  const v = await mount();
  expectOneColumnBody(v.container, ['Details', 'Replace owner email']);
});

// LEX-DS-001 §5.7 and prototype revision 16 (platformOrgProvisioning `acts`):
// Resend invitation is outline; Cancel provisioning is `outline dtext`.
test('provisioning header actions are outline with icons; Cancel is red-text', async () => {
  routes({ [GET]: () => json(provisioning()) });
  const v = await mount();
  for (const [label, destructive] of [
    ['Resend invitation', false],
    ['Cancel provisioning', true],
  ] as const) {
    const b = button(label)!;
    const classes = b.className.split(/\s+/);
    expect(classes, label).toContain('border-input');
    expect(classes, label).not.toContain('bg-primary');
    expect(b.querySelector('svg'), label).not.toBeNull();
    expect(classes.includes('text-lexon-red-text'), label).toBe(destructive);
  }
  await v.unmount();
});

// Prototype revision 16 Replace owner email card: radius 12px, header
// 14px 16px mobile / 16px 20px desktop, body padding 0 20px 20px.
test('Replace owner email card follows the prototype spacing', async () => {
  routes({ [GET]: () => json(provisioning()) });
  const v = await mount();
  const card = v.container.querySelector(
    'section[aria-labelledby="replace-owner-email"]',
  )!;
  const has = (el: Element | null, tokens: string[]) => {
    const set = new Set((el?.getAttribute('class') ?? '').split(/\s+/));
    for (const t of tokens) expect(set.has(t), t).toBe(true);
  };
  has(card, ['rounded-[12px]', 'border']);
  has(card.querySelector('h2'), ['text-[15px]', 'leading-[normal]']);
  has(card.querySelector('h2')!.parentElement, [
    'px-4',
    'py-3.5',
    'md:px-5',
    'md:py-4',
  ]);
  has(card.querySelector('form'), ['px-5', 'pb-5', 'gap-3', 'items-end']);
  await v.unmount();
});
