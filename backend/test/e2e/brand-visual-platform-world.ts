// The platform world of the F4.1 visual set: Dimas Prasetyo (platform
// administrator, authenticator enrolled) and the three provisioning
// organizations of the prototype. Built once per stack and cached (lock plus
// session cookies in os.tmpdir(), see sharedWorld), so the platform group can
// run again on a long-lived stack.
import { expect, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { readCapturedMail } from './identity-support.js';
import { operatorSetup } from './setup-support.js';
import { totpForUri } from '../setup/totp.js';
import { sharedWorld } from './brand-visual-world.js';
import {
  platformAdmin,
  provisioningOrganizations,
} from './prototype-fixtures.js';

const password = 'Brand-operator-42!';

async function enrollAdministrator(page: Page, email: string): Promise<string> {
  const stack = descriptor();
  let uri = '';
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
  return uri;
}
/**
 * Platform routes need a fresh sign-in (300 s). The cached session ages, so
 * the administrator confirms the password and authenticator code again.
 */
export async function reauthenticatePlatform(
  page: Page,
  world: { totpUri: string },
) {
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
    if (response.ok()) return;
    last = response.status() + ' ' + (await response.text()).slice(0, 160);
    // The same code cannot be used twice in one 30 s window.
    await new Promise((done) => setTimeout(done, 31_000));
  }
  throw new Error('Platform administrator could not reauthenticate: ' + last);
}

export async function platformWorld(page: Page) {
  const stack = descriptor();
  const world = await sharedWorld(page, 'platform', async () => {
    // The prototype shows no address for the administrator. The address is
    // unique to this world, so an administrator that an earlier run left on
    // the stack (its authenticator secret is gone) cannot block it.
    const totpUri = await enrollAdministrator(
      page,
      platformAdmin.email.replace('.bv@', `.${Date.now().toString(36)}@`),
    );
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
    expect(ids.has(provisioningOrganizations[0].slug)).toBe(true);
    return { harborId: ids.get(provisioningOrganizations[0].slug)!, totpUri };
  });
  await reauthenticatePlatform(page, world);
  return world;
}
