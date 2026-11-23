// The platform world of the F4.1 visual set: Dimas Prasetyo (platform
// administrator, authenticator enrolled), the three provisioning
// organizations of the prototype, and the accounts and team organizations
// the revision 16 console captures open. Built once per stack and cached (lock plus
// session cookies in os.tmpdir(), see sharedWorld), so the platform group can
// run again on a long-lived stack.
import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { descriptor } from './runtime-support.js';
import {
  authenticateApi,
  readCapturedMail,
  waitForHydration,
} from './identity-support.js';
import { operatorSetup } from './setup-support.js';
import { totpForUri } from '../setup/totp.js';
import { sharedWorld, teamWorld } from './brand-visual-world.js';
import {
  ayu,
  platformAdmin,
  provisioningOrganizations,
} from './prototype-fixtures.js';

const password = 'Brand-operator-42!';

export async function enrollAdministrator(
  page: Page,
  email: string,
): Promise<string> {
  const stack = descriptor();
  let uri: string | undefined;
  const seen: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error')
      seen.push('console: ' + message.text().slice(0, 160));
  });
  page.on('pageerror', (error) =>
    seen.push('pageerror: ' + error.message.slice(0, 160)),
  );
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname === '/api/identity/security')
      seen.push(
        'security body: ' +
          (await response.text().catch(() => '?')).slice(0, 300),
      );
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/'))
      seen.push(
        `${response.status()} ${response.request().method()} ${url.pathname}`,
      );
  });
  {
    const setup = await operatorSetup(email, true);
    expect(setup.status).toBe('created');
    await page.goto(setup.mail!.actionUrl);
    await page
      .getByRole('button', { name: 'Create setup account', exact: true })
      .click();
    await waitForHydration(
      page.getByRole('button', { name: 'Create account', exact: true }),
    );
    await page
      .getByLabel('Full name', { exact: true })
      .fill(platformAdmin.name);
    await page.getByLabel('Work email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page
      .getByRole('button', { name: 'Create account', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Verify your email' }),
    ).toBeVisible();
    await page.goto(
      (await readCapturedMail(stack.project, email, 'verification')).actionUrl,
    );
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const signedIn = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/sign-in/email' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await signedIn).status()).toBe(200);
    await expect(page).toHaveURL(/admin-setup/);
    const enrollment = page.getByLabel('Enrollment password', { exact: true });
    try {
      await enrollment.waitFor({ timeout: 30_000 });
    } catch {
      throw new Error(
        'Administrator setup did not reach enrollment at ' +
          page.url() +
          ': ' +
          (await page.locator('body').innerText()).slice(0, 200) +
          ' | api: ' +
          seen.slice(-24).join('; '),
      );
    }
    await enrollment.fill(password);
    await page
      .getByRole('button', { name: 'Set up authenticator', exact: true })
      .click();
    uri = (await page.getByTestId('authenticator-uri').textContent())!;
    await page
      .getByLabel('Authenticator code', { exact: true })
      .fill(totpForUri(uri));
    await page
      .getByRole('button', { name: 'Verify authenticator', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'I saved my recovery codes', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Activate platform administrator',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Administrator setup complete' }),
    ).toBeVisible();
  }
  expect(
    (
      await page.request.post(
        stack.apiUrl + '/api/identity/onboarding/complete',
        { headers: { origin: stack.frontendUrl }, data: {} },
      )
    ).status(),
  ).toBe(204);
  // The sidebar subtitle shows the job title; without one it falls back to
  // the generated address.
  expect(
    (
      await page.request.patch(stack.apiUrl + '/api/identity/profile', {
        headers: { origin: stack.frontendUrl },
        data: { name: platformAdmin.name, jobTitle: 'Platform administrator' },
      })
    ).status(),
  ).toBe(200);
  return uri!;
}
/**
 * When the shared administrator session last proved a fresh sign-in, kept
 * next to the world cache so every spec on the stack sees it.
 */
const freshAtFile = () =>
  resolve(tmpdir(), `${descriptor().project}-bv-platform-fresh-at`);
const markFresh = () => writeFileSync(freshAtFile(), String(Date.now()));
const freshAge = () =>
  existsSync(freshAtFile())
    ? Date.now() - Number(readFileSync(freshAtFile(), 'utf8'))
    : Infinity;
/** A session younger than this keeps at least 180 s of the 300 s window. */
const reuseFreshMs = 120_000;

/**
 * Platform routes need a fresh sign-in (300 s). The cached session ages, so
 * the administrator confirms the password and authenticator code again,
 * unless the session was made fresh in the last two minutes: authenticator
 * codes are limited to five per account in 300 s (AUTH rate rule `totp`),
 * and the platform specs of one shard share this administrator.
 */
export async function reauthenticatePlatform(
  page: Page,
  world: { totpUri: string },
) {
  if (freshAge() < reuseFreshMs) return;
  const stack = descriptor();
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await page.request.post(
      stack.apiUrl + '/api/identity/security/reauthenticate',
      {
        headers: { origin: stack.frontendUrl },
        data: { password, totp: totpForUri(world.totpUri) },
      },
    );
    if (response.ok()) {
      markFresh();
      return;
    }
    last = response.status() + ' ' + (await response.text()).slice(0, 160);
    // The same code cannot be used twice in one 30 s window.
    await new Promise((done) => setTimeout(done, 31_000));
  }
  throw new Error('Platform administrator could not reauthenticate: ' + last);
}

export type PlatformWorld = {
  totpUri: string;
  /** Real account ids, keyed like platformAccounts (prototype-fixtures.ts). */
  accounts: Record<'admin' | 'ayu' | 'unverified' | 'disabled', string>;
  /** Real organization ids, keyed like platformOrganizations. */
  organizations: Record<string, string>;
  harborId: string;
};

/** The id of the one account the platform search finds for an address. */
async function accountId(page: Page, email: string) {
  const stack = descriptor();
  const listed = await page.request.get(
    stack.apiUrl +
      '/api/platform/accounts?pageSize=10&query=' +
      encodeURIComponent(email),
  );
  expect(listed.status()).toBe(200);
  const items = (
    (await listed.json()) as {
      items: Array<{ id: string; email: string }>;
    }
  ).items.filter((item) => item.email === email);
  expect(items, `one account for ${email}`).toHaveLength(1);
  return items[0]!.id;
}

/**
 * The platform world of revision 16: the administrator, the three
 * provisioning organizations, an unverified and a disabled account (unique
 * addresses; the console shows the prototype's names and addresses through
 * the normalizations in brand-visual-platform-normalizations.ts), and the
 * team world (Ayu Wardani, Hukum Nusantara with its three members, Pro Bono
 * Clinic), built in a separate browser context so this page stays signed in
 * as the administrator.
 */
export async function platformWorld(
  page: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<PlatformWorld> {
  const stack = descriptor();
  const world = await sharedWorld(page, 'platform-r16', async () => {
    // The prototype shows no address for the administrator. The address is
    // unique to this world, so an administrator that an earlier run left on
    // the stack (its authenticator secret is gone) cannot block it.
    const adminEmail = platformAdmin.email.replace(
      '.bv@',
      `.${Date.now().toString(36)}@`,
    );
    const totpUri = await enrollAdministrator(page, adminEmail);
    // Enrolment ends with a fresh sign-in.
    markFresh();
    const ids = new Map<string, string>();
    for (const organization of provisioningOrganizations) {
      const created = await page.request.post(
        stack.apiUrl + '/api/platform/provisioning',
        {
          headers: { origin: stack.frontendUrl },
          data: {
            name: organization.name,
            slug: organization.slug,
            ownerEmail: organization.ownerEmail,
          },
        },
      );
      // A non-201 means an earlier run already provisioned the slug on this
      // stack (the API answers a duplicate with an error); it is found below.
      if (created.status() === 201)
        ids.set(
          organization.slug,
          ((await created.json()) as { id: string }).id,
        );
    }
    if (ids.size < provisioningOrganizations.length) {
      const listed = await page.request.get(
        stack.apiUrl + '/api/platform/provisioning?limit=50',
      );
      expect(listed.status()).toBe(200);
      for (const item of (
        (await listed.json()) as {
          items: Array<{ id: string; slug: string }>;
        }
      ).items)
        if (!ids.has(item.slug)) ids.set(item.slug, item.id);
    }
    for (const organization of provisioningOrganizations)
      expect(ids.has(organization.slug), organization.slug).toBe(true);

    // Bagus Santoso signs up and never verifies; Lina Hartono is verified
    // and then disabled by the administrator. Both statuses are real.
    const suffix = Date.now().toString(36);
    const unverifiedEmail = `bagus.santoso.${suffix}.bv@example.test`;
    const disabledEmail = `lina.hartono.${suffix}.bv@example.test`;
    const outsider = await playwright.request.newContext();
    try {
      expect(
        (
          await outsider.post(stack.apiUrl + '/api/auth/sign-up/email', {
            headers: { origin: stack.frontendUrl },
            data: {
              name: 'Bagus Santoso',
              email: unverifiedEmail,
              password: 'Brand-unverified-42!',
            },
          })
        ).status(),
      ).toBe(200);
      await authenticateApi(outsider, {
        name: 'Lina Hartono',
        email: disabledEmail,
      });
    } finally {
      await outsider.dispose();
    }
    const disabledId = await accountId(page, disabledEmail);
    expect(
      (
        await page.request.patch(
          stack.apiUrl + `/api/platform/users/${disabledId}/disabled`,
          { headers: { origin: stack.frontendUrl }, data: { disabled: true } },
        )
      ).status(),
    ).toBe(204);

    // The team world signs its own context in as Ayu Wardani.
    const browser = page.context().browser();
    if (!browser) throw new Error('The platform world needs a browser');
    const teamContext = await browser.newContext();
    let team: { teamId: string; otherId: string };
    try {
      team = await teamWorld(await teamContext.newPage(), playwright);
    } finally {
      await teamContext.close();
    }
    return {
      totpUri,
      accounts: {
        admin: await accountId(page, adminEmail),
        ayu: await accountId(page, ayu.email),
        unverified: await accountId(page, unverifiedEmail),
        disabled: disabledId,
      },
      organizations: {
        team: team.teamId,
        other: team.otherId,
        ...Object.fromEntries(ids),
      },
      harborId: ids.get(provisioningOrganizations[0].slug)!,
    };
  });
  await reauthenticatePlatform(page, world);
  return world;
}
