// Shared helpers of the F4.1 visual group specs: signed-in identities, the
// Hukum Nusantara team world, and the shell openers. Content comes from
// prototype-fixtures.ts so captures read like the prototype.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { brandFixedTime, type BrandViewport } from './brand-visual-support.js';
import { openMenuReliably } from './visual-support.js';
import {
  ayu,
  otherOrganization,
  team,
  teamInvitations,
} from './prototype-fixtures.js';

export const userTrigger = (page: Page) =>
  page.locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]');
export const organizationTrigger = (page: Page) =>
  page.locator('[data-slot="sidebar-header"] button[aria-haspopup="menu"]');

/** Waits until the mobile sheet has moved focus inside, then drops it. */
export async function settleMobileSheet(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Sidebar' });
  await expect(sheet).toBeVisible();
  await expect
    .poll(() =>
      sheet.evaluate((dialog) => dialog.contains(document.activeElement)),
    )
    .toBe(true);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
}

export async function openMobileSheet(page: Page) {
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await settleMobileSheet(page);
}

export async function closeMobileSheet(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeHidden();
}

/**
 * A fresh signed-in identity. Its address is unique per call (the suite
 * shares one stack and an address can register once), so use it only where
 * the address is not on screen. Screens that show the address use teamWorld.
 */
export async function prepareIdentity(
  page: Page,
  fixture: { name: string; email?: string; password?: string },
  jobTitle: string,
) {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, fixture);
  const profile = await page.request.patch(
    stack.apiUrl + '/api/identity/profile',
    { headers, data: { name: fixture.name, jobTitle } },
  );
  expect(profile.status()).toBe(200);
  expect(
    (
      await page.request.post(
        stack.apiUrl + '/api/identity/onboarding/complete',
        { headers, data: {} },
      )
    ).status(),
  ).toBe(204);
  return { stack, headers };
}

export async function gotoWorkspace(page: Page, firstName: string) {
  const stack = descriptor();
  await page.clock.setFixedTime(brandFixedTime);
  const response = await page.goto(stack.frontendUrl + '/workspace');
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', {
      name: `Good morning, ${firstName}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
}

/** Resting page: desktop shows the expanded sidebar, mobile the closed one. */
export async function expectResting(page: Page, viewport: BrandViewport) {
  if (viewport === 'desktop')
    await expect(
      page.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeVisible();
  else
    await expect(
      page.getByRole('button', { name: 'Open navigation' }),
    ).toBeVisible();
}

export async function openUserMenu(page: Page, viewport: BrandViewport) {
  if (viewport === 'mobile') await openMobileSheet(page);
  await openMenuReliably(
    page,
    userTrigger(page),
    page.getByRole('menuitem', { name: 'Sign out' }),
    'user menu',
  );
}

export async function closeMenu(page: Page, viewport: BrandViewport) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  if (viewport === 'mobile') await closeMobileSheet(page);
}

/**
 * Holds every request matching `matches` until `release()` is called. The
 * route is removed by its own matcher, after every held request has finished,
 * so no other route is touched.
 */
export async function gateRequests(
  page: Page,
  matches: (url: URL, method: string) => boolean,
) {
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((done) => (markStarted = done));
  const gate = new Promise<void>((done) => (release = done));
  const held = new Set<Promise<void>>();
  const matcher = (url: URL) => matches(url, '');
  await page.route(matcher, (route) => {
    if (!matches(new URL(route.request().url()), route.request().method()))
      return route.fallback();
    markStarted();
    const request = (async () => {
      await gate;
      await route.continue();
    })();
    held.add(request);
    return request;
  });
  return {
    started,
    release,
    async finish() {
      release();
      await Promise.all([...held]);
      await page.unroute(matcher);
    },
  };
}

export const chatListRequest = (url: URL, method: string) =>
  url.pathname === '/api/chats' && (method === 'GET' || method === '');

type Cookie = Parameters<ReturnType<Page['context']>['addCookies']>[0][number];

/**
 * Builds a world once per stack and lets every group spec reuse it: some
 * screens show a real address (ayu@hukum-nusantara.co.id) that can register
 * only once. The first caller builds under a lock and stores the session
 * cookies; later callers (also in another worker process sharing the stack)
 * wait for them and sign the same session in.
 */
export async function sharedWorld<T extends object>(
  page: Page,
  key: string,
  build: () => Promise<T>,
): Promise<T> {
  const stack = descriptor();
  const base = resolve(tmpdir(), `${stack.project}-bv-${key}`);
  const file = `${base}.json`;
  const lock = `${base}.lock`;
  const reuse = async () => {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      cookies: Cookie[];
      data: T;
    };
    await page.context().addCookies(saved.cookies);
    return saved.data;
  };
  const deadline = Date.now() + 200_000;
  for (;;) {
    if (existsSync(file)) return reuse();
    try {
      mkdirSync(lock);
    } catch {
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for the ${key} world`);
      await new Promise((done) => setTimeout(done, 500));
      continue;
    }
    try {
      if (existsSync(file)) return reuse();
      const data = await build();
      const cookies = await page.context().cookies();
      writeFileSync(file, JSON.stringify({ cookies, data }));
      return data;
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }
}

export const teamPassword = 'Hukum-nusantara-review-42!';

/**
 * Ayu Wardani, owner of Hukum Nusantara with Rizky Pratama (admin) and Sari
 * Wibowo (member), three pending invitations, and Pro Bono Clinic, as in the
 * prototype. The page's context is signed in as Ayu with Hukum Nusantara
 * active. Resolves with the ids.
 */
export async function teamWorld(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
) {
  const stack = descriptor();
  return sharedWorld(page, 'team', async () => {
    const { headers } = await prepareIdentity(
      page,
      { name: ayu.name, email: ayu.email, password: teamPassword },
      ayu.jobTitle,
    );
    const create = async (name: string, slug: string) => {
      const response = await page.request.post(
        stack.apiUrl + '/api/organizations',
        { headers, data: { name, slug } },
      );
      expect(response.status()).toBe(201);
      return (await response.json()) as { id: string };
    };
    const createTeam = () => create(team.name, team.slug);
    const activate = async (organizationId: string) =>
      expect(
        (
          await page.request.post(stack.apiUrl + '/api/organizations/active', {
            headers,
            data: { organizationId },
          })
        ).status(),
      ).toBe(200);
    const created = await createTeam();
    await activate(created.id);
    for (const member of team.members.slice(1)) {
      const invitation = await page.request.post(
        stack.apiUrl + `/api/organizations/${created.id}/invitations`,
        { headers, data: { email: member.email, role: member.role } },
      );
      expect(invitation.status()).toBe(201);
      const { id } = (await invitation.json()) as { id: string };
      const recipient = await playwright.request.newContext();
      try {
        const recipientHeaders = await authenticateApi(recipient, {
          name: member.name,
          email: member.email,
        });
        expect(
          (
            await recipient.post(
              stack.apiUrl + `/api/invitations/${id}/accept`,
              { headers: recipientHeaders, data: {} },
            )
          ).status(),
        ).toBe(200);
      } finally {
        await recipient.dispose();
      }
    }
    for (const invitation of teamInvitations)
      expect(
        (
          await page.request.post(
            stack.apiUrl + `/api/organizations/${created.id}/invitations`,
            {
              headers,
              data: { email: invitation.email, role: invitation.role },
            },
          )
        ).status(),
      ).toBe(201);
    const other = await create(otherOrganization.name, otherOrganization.slug);
    await activate(created.id);
    return { teamId: created.id, otherId: other.id };
  });
}

/**
 * Rewrites the pending invitations to the prototype's per-row expiry (the
 * real API always expires an invitation seven days after the real clock).
 */
export async function installPrototypeInvitationExpiry(
  page: Page,
  teamId: string,
) {
  const matcher = (url: URL) =>
    url.pathname === `/api/organizations/${teamId}/invitations`;
  const pending = new Set<Promise<void>>();
  const handler = (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const work = (async () => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const body = (await response.json()) as {
        items: Array<{ email: string } & Record<string, unknown>>;
      };
      const items = teamInvitations.flatMap((invitation) => {
        const row = body.items.find((item) => item.email === invitation.email);
        return row ? [{ ...row, expiresAt: invitation.expiresAt }] : [];
      });
      expect(items, 'every prototype invitation is listed').toHaveLength(
        teamInvitations.length,
      );
      return route.fulfill({ response, json: { ...body, items } });
    })();
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    );
    return work;
  };
  await page.route(matcher, handler);
  return {
    async remove() {
      await page.unroute(matcher, handler);
      await Promise.all([...pending]);
    },
  };
}
