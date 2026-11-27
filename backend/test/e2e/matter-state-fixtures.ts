// Deterministic F6 Matters fixtures for the revision-18 visual states: the
// Kantor Hukum Adil world (Dewi Lestari owner, Andi Wijaya member — the
// prototype's signed-in identities), the five prototype matters, and route
// fixtures for /api/projects, /api/org/projects(+denies),
// /api/org/members/search, and /api/chats/:id/shares. The shell, auth, and
// organization are real; only the F6 payloads are fixed.
import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { prepareIdentity, sharedWorld } from './brand-visual-world.js';
import { prototypeNow } from './prototype-fixtures.js';

// The prototype's Kantor Hukum Adil cast (r18 "Fixtures shown").
export const adil = { name: 'Kantor Hukum Adil', slug: 'kantor-hukum-adil' };
export const dewi = {
  name: 'Dewi Lestari',
  email: 'dewi@kha.co.id',
  jobTitle: 'Partner',
  userId: '00000000-0000-4000-8000-000000000301',
};
export const andi = {
  name: 'Andi Wijaya',
  email: 'andi.wijaya@kha.co.id',
  jobTitle: 'Associate',
  userId: '00000000-0000-4000-8000-000000000302',
};
export const rina = {
  name: 'Rina Kusuma',
  email: 'rina@kha.co.id',
  userId: '00000000-0000-4000-8000-000000000303',
};
export const budi = {
  name: 'Budi Santoso',
  email: 'budi@kha.co.id',
  userId: '00000000-0000-4000-8000-000000000304',
};
export const citra = {
  name: 'Citra Ayu',
  email: 'citra@kha.co.id',
  userId: '00000000-0000-4000-8000-000000000305',
};
export const eko = {
  name: 'Eko Prasetyo',
  email: 'eko.prasetyo@kha.co.id',
  userId: '00000000-0000-4000-8000-000000000306',
};

export const worldPassword = 'Kantor-adil-review-42!';

// The five prototype matters (r18 settings-matters rows) plus the personal
// workspace matter "Kontrak sewa ruko Tebet".
export const sinarId = '00000000-0000-4000-8000-000000000201';
export const mergerId = '00000000-0000-4000-8000-000000000202';
export const kopiId = '00000000-0000-4000-8000-000000000203';
export const phkId = '00000000-0000-4000-8000-000000000204';
export const dueId = '00000000-0000-4000-8000-000000000205';
export const sewaId = '00000000-0000-4000-8000-000000000206';

const base = Date.parse(prototypeNow);
const at = (minusMs: number) => new Date(base - minusMs).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const matter = (
  id: string,
  name: string,
  matterNumber: string | null,
  practiceArea: string | null,
  owner: { userId: string; name: string; email?: string },
  memberCount: number,
  chatCount: number,
  activityMinusMs: number,
  myRole: 'owner' | 'editor' | 'viewer' = 'owner',
) => ({
  version: 1 as const,
  id,
  name,
  matterNumber,
  practiceArea,
  owner,
  myRole,
  memberCount,
  chatCount,
  lastActivityAt: at(activityMinusMs),
  createdAt: at(40 * DAY),
});

export const matterList = (myRole: 'owner' | 'editor' | 'viewer' = 'owner') => [
  matter(
    sinarId,
    'PT Sinar Abadi — wanprestasi',
    '045/LIT/2026',
    'Litigation',
    { userId: andi.userId, name: andi.name, email: andi.email },
    4,
    4,
    2 * HOUR,
    myRole,
  ),
  matter(
    mergerId,
    'Merger PT Nusantara Logistik',
    '112/CORP/2026',
    'Corporate',
    { userId: rina.userId, name: rina.name, email: rina.email },
    3,
    2,
    DAY,
    'viewer',
  ),
  matter(
    kopiId,
    'Sengketa merek "Kopi Senja"',
    '087/IP/2026',
    'Intellectual property',
    { userId: andi.userId, name: andi.name, email: andi.email },
    3,
    1,
    2 * DAY,
    myRole,
  ),
  matter(
    phkId,
    'PHK karyawan PT Maju Jaya',
    '019/EMP/2026',
    'Employment',
    { userId: budi.userId, name: budi.name, email: budi.email },
    5,
    3,
    3 * DAY,
    'viewer',
  ),
  matter(
    dueId,
    'Due diligence Bank Rakyat Mandiri',
    '130/CORP/2026',
    'Corporate',
    { userId: dewi.userId, name: dewi.name, email: dewi.email },
    4,
    5,
    5 * DAY,
    'viewer',
  ),
];

export const personalMatter = () => [
  matter(
    sewaId,
    'Kontrak sewa ruko Tebet',
    null,
    null,
    { userId: andi.userId, name: andi.name, email: andi.email },
    1,
    1,
    DAY,
    'owner',
  ),
];

export const matterInstructions =
  'Answer with references to the Indonesian Civil Code (KUHPerdata) and the Civil Procedure rules (HIR). Use Indonesian legal terms in italics. Keep answers short and list the documents we still need.';

// r18 MCHATS owners: Andi, Andi, Budi, Budi.
export const projectChatRows = [
  {
    id: '00000000-0000-4000-8000-000000000211',
    title: 'Syarat sah perjanjian (Pasal 1320)',
    ownerUserId: andi.userId,
    ownerName: andi.name,
    updatedAt: at(2 * HOUR),
  },
  {
    id: '00000000-0000-4000-8000-000000000212',
    title: 'Wanprestasi remedies and damages',
    ownerUserId: andi.userId,
    ownerName: andi.name,
    updatedAt: at(DAY),
  },
  {
    id: '00000000-0000-4000-8000-000000000213',
    title: 'Bukti surat dan saksi',
    ownerUserId: budi.userId,
    ownerName: budi.name,
    updatedAt: at(3 * DAY),
  },
  {
    id: '00000000-0000-4000-8000-000000000214',
    title: 'Strategi mediasi',
    ownerUserId: budi.userId,
    ownerName: budi.name,
    updatedAt: at(5 * DAY),
  },
];

const personalChatRows = [
  {
    id: '00000000-0000-4000-8000-000000000215',
    title: 'Klausul perpanjangan sewa',
    ownerUserId: andi.userId,
    ownerName: andi.name,
    updatedAt: at(DAY),
  },
  {
    id: '00000000-0000-4000-8000-000000000216',
    title: 'Deposit dan pengembalian',
    ownerUserId: andi.userId,
    ownerName: andi.name,
    updatedAt: at(4 * DAY),
  },
];

/**
 * Kantor Hukum Adil: Dewi Lestari creates the org (owner) and Andi Wijaya
 * joins as a member. The page ends signed in as Dewi; Andi states re-sign
 * with `signInAs(page, andi)`. Real auth/org; member-facing payloads are
 * fixtured by `installMatterFixtures`.
 */
export async function adilWorld(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
) {
  const stack = descriptor();
  return sharedWorld(page, 'adil', async () => {
    const { headers } = await prepareIdentity(
      page,
      { name: dewi.name, email: dewi.email, password: worldPassword },
      dewi.jobTitle,
    );
    const created = await page.request.post(
      stack.apiUrl + '/api/organizations',
      { headers, data: { name: adil.name, slug: adil.slug } },
    );
    expect(created.status()).toBe(201);
    const { id: orgId } = (await created.json()) as { id: string };
    expect(
      (
        await page.request.post(stack.apiUrl + '/api/organizations/active', {
          headers,
          data: { organizationId: orgId },
        })
      ).status(),
    ).toBe(200);
    for (const member of [
      { ...andi, role: 'member', jobTitle: 'Associate' },
      { ...rina, role: 'member', jobTitle: 'Senior Associate' },
      { ...citra, role: 'member', jobTitle: 'Associate' },
    ]) {
      const invitation = await page.request.post(
        stack.apiUrl + `/api/organizations/${orgId}/invitations`,
        { headers, data: { email: member.email, role: member.role } },
      );
      expect(invitation.status()).toBe(201);
      const { id: invitationId } = (await invitation.json()) as { id: string };
      const recipient = await playwright.request.newContext();
      try {
        const memberHeaders = await authenticateAs(recipient, member);
        expect(
          (
            await recipient.post(
              stack.apiUrl + `/api/invitations/${invitationId}/accept`,
              { headers: memberHeaders, data: {} },
            )
          ).status(),
        ).toBe(200);
        expect(
          (
            await recipient.patch(stack.apiUrl + '/api/identity/profile', {
              headers: memberHeaders,
              data: { name: member.name, jobTitle: member.jobTitle },
            })
          ).status(),
        ).toBe(200);
        expect(
          (
            await recipient.post(
              stack.apiUrl + '/api/identity/onboarding/complete',
              { headers: memberHeaders, data: {} },
            )
          ).status(),
        ).toBe(204);
      } finally {
        await recipient.dispose();
      }
    }
    return { orgId };
  });
}

/** Signs an already-registered fixture user in through the page's context. */
export async function signInAs(page: Page, user: { email: string }) {
  const stack = descriptor();
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/auth/sign-in/email', {
        headers: { origin: stack.frontendUrl },
        data: { email: user.email, password: worldPassword },
      })
    ).status(),
  ).toBe(200);
}

async function authenticateAs(
  request: import('@playwright/test').APIRequestContext,
  user: { name: string; email: string },
) {
  const { authenticateApi } = await import('./identity-support.js');
  return authenticateApi(request, {
    name: user.name,
    email: user.email,
    password: worldPassword,
  });
}

/**
 * The prototype's "6 members" org tile: the real org has two members, so the
 * identity payload's organizationMemberCount is rewritten to the fixture.
 */
export async function installAdilMemberCount(page: Page) {
  await page.route(/\/api\/identity$/, async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = (await response.json()) as {
      organizationMemberCount?: number | null;
    };
    return route.fulfill({
      response,
      json: { ...body, organizationMemberCount: 6 },
    });
  });
}

/**
 * Deterministic /api/projects, /api/org/projects(+denies),
 * /api/org/members/search and /api/chats/:id/shares payloads. `getState`
 * resolves the capture state so list/detail payload variants (empty,
 * personal, viewer) follow the spec's current state.
 */
export async function installMatterFixtures(
  page: Page,
  getState: () => string,
  options: {
    items?: (state: string) => ReturnType<typeof matterList>;
  } = {},
) {
  const items = (state: string) =>
    (options.items ?? (() => matterList()))(state);
  const detail = (id: string) => {
    const state = getState();
    const row = (
      state === 'matter-personal' ? personalMatter() : items(state)
    ).find((item) => item.id === id);
    if (!row) return undefined;
    return {
      ...row,
      instructions: state === 'matter-personal' ? null : matterInstructions,
    };
  };
  const listBody = () => {
    const state = getState();
    if (state === 'matters-empty') return { items: [] };
    if (state === 'matter-personal')
      return { items: personalMatter(), pageInfo: { nextCursor: null } };
    return { items: items(state), pageInfo: { nextCursor: null } };
  };
  await page.route(/\/api\/projects(?:\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (method === 'GET' && url.pathname === '/api/projects') {
      const body = listBody();
      return json(
        200,
        'items' in body && !('pageInfo' in body)
          ? { ...body, pageInfo: { nextCursor: null } }
          : body,
      );
    }
    const project = /^\/api\/projects\/([0-9a-f-]{36})(\/.*)?$/i.exec(
      url.pathname,
    );
    if (!project) return route.continue();
    const id = project[1]!;
    const rest = project[2] ?? '';
    if (method === 'GET' && rest === '') {
      const row = detail(id);
      return row ? json(200, row) : route.continue();
    }
    if (method === 'GET' && rest === '/chats')
      return json(200, {
        items: id === sewaId ? personalChatRows : projectChatRows,
      });
    if (method === 'GET' && rest === '/members')
      return json(200, {
        items: [
          {
            version: 1,
            memberId: budi.userId,
            userId: budi.userId,
            name: budi.name,
            email: budi.email,
            role: 'editor',
            createdAt: at(30 * DAY),
          },
          {
            version: 1,
            memberId: citra.userId,
            userId: citra.userId,
            name: citra.name,
            email: citra.email,
            role: 'viewer',
            createdAt: at(28 * DAY),
          },
        ],
      });
    if (method === 'GET' && rest === '/instructions')
      return json(200, { instructions: matterInstructions });
    if (method === 'DELETE') return route.fulfill({ status: 204 });
    if (method === 'POST' || method === 'PATCH')
      return json(200, detail(id) ?? {});
    return route.continue();
  });
  await page.route(/\/api\/org\/projects(?:\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (status: number, body?: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body ?? {}),
      });
    if (method === 'GET' && url.pathname === '/api/org/projects')
      return json(200, {
        // Org rows never carry the caller's role.
        items: matterList().map((row) => ({
          version: row.version,
          id: row.id,
          name: row.name,
          matterNumber: row.matterNumber,
          practiceArea: row.practiceArea,
          owner: row.owner,
          memberCount: row.memberCount,
          chatCount: row.chatCount,
          restrictedCount: row.id === sinarId ? 1 : 0,
          lastActivityAt: row.lastActivityAt,
          createdAt: row.createdAt,
        })),
        pageInfo: { nextCursor: null },
      });
    const denies = /^\/api\/org\/projects\/[0-9a-f-]{36}\/denies(\/.*)?$/i.exec(
      url.pathname,
    );
    if (denies) {
      if (method === 'GET')
        return json(200, {
          items: [
            {
              version: 1,
              userId: eko.userId,
              name: eko.name,
              email: eko.email,
              setByUserId: dewi.userId,
              setByName: dewi.name,
              createdAt: at(20 * DAY),
            },
          ],
        });
      if (method === 'POST') return json(201);
      if (method === 'DELETE') return route.fulfill({ status: 204 });
    }
    return route.continue();
  });
  await page.route(/\/api\/org\/members\/search/, async (route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const items = [
      { ...dewi, role: 'owner' },
      { ...andi, role: 'member' },
      { ...rina, role: 'member' },
      { ...budi, role: 'member' },
      { ...citra, role: 'member' },
      { ...eko, role: 'member' },
    ]
      .filter(
        (member) =>
          member.name.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q),
      )
      .map((member) => ({
        version: 1,
        userId: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
      }));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items }),
    });
  });
  await page.route(/\/api\/chats(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() !== 'GET' ||
      url.pathname !== '/api/chats' ||
      url.searchParams.get('scope') === 'shared'
    )
      return route.fallback();
    const state = getState();
    const rows =
      state === 'matter-personal' ? personalChatRows : projectChatRows;
    const projectName =
      state === 'matter-personal'
        ? 'Kontrak sewa ruko Tebet'
        : 'PT Sinar Abadi — wanprestasi';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          updatedAt: row.updatedAt,
          lastMessageAt: row.updatedAt,
          awaitingUser: false,
          projectName,
        })),
        pageInfo: { nextCursor: null },
      }),
    });
  });
  await page.route(
    /\/api\/chats\/[0-9a-f-]{36}\/shares(?:\/.*)?$/i,
    async (route) => {
      const method = route.request().method();
      if (method === 'GET')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              version: 1,
              userId: rina.userId,
              name: rina.name,
              email: rina.email,
              grantedByUserId: andi.userId,
              createdAt: at(2 * DAY),
            },
          ]),
        });
      if (method === 'POST')
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: '{}',
        });
      if (method === 'DELETE') return route.fulfill({ status: 204 });
      return route.continue();
    },
  );
}

/**
 * The shared-scope Chats list (chats-shared): the chat fixtures ignore query
 * params, so the scope=shared page gets its own rows.
 */
export async function installSharedChatsFixture(page: Page) {
  await page.route(/\/api\/chats(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() !== 'GET' ||
      url.pathname !== '/api/chats' ||
      url.searchParams.get('scope') !== 'shared'
    )
      return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: sharedChatRows(),
        pageInfo: { nextCursor: null },
      }),
    });
  });
}

/**
 * A reader-scope chat detail for the shared/matter read-only states: access
 * 'reader' with the sharer/owner names the backend emits for non-owners.
 */
export async function installChatDetail(
  page: Page,
  detail: Record<string, unknown>,
) {
  await page.route(
    new RegExp(`/api/chats/${String(detail.id)}$`),
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    },
  );
}

/**
 * Shared-scope chat list rows (chats-shared state): each row carries the
 * sharer's name; the reader detail payload belongs to the chat fixtures.
 */
export const sharedChatRows = () => [
  {
    id: '00000000-0000-4000-8000-000000000221',
    title: 'Due diligence checklist for PT acquisition',
    updatedAt: at(3 * HOUR),
    lastMessageAt: at(3 * HOUR),
    awaitingUser: false,
    ownerName: andi.name,
  },
  {
    id: '00000000-0000-4000-8000-000000000222',
    title: 'Force majeure clause, supply agreement',
    updatedAt: at(DAY),
    lastMessageAt: at(DAY),
    awaitingUser: false,
    ownerName: budi.name,
  },
  {
    id: '00000000-0000-4000-8000-000000000223',
    title: 'Data transfer under UU PDP Article 56',
    updatedAt: at(10 * DAY),
    lastMessageAt: at(10 * DAY),
    awaitingUser: false,
    ownerName: dewi.name,
  },
];
