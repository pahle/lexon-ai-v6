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

async function enrollAdministrator(page: Page, email: string) {
  const stack = descriptor();
  {
    const setup = await operatorSetup(email, true);
    expect(setup.status).toBe('created');
    await page.goto(setup.mail!.actionUrl);
    await page
      .getByRole('button', { name: 'Create setup account', exact: true })
      .click();
    await page.getByLabel('Full name', { exact: true }).fill(platformAdmin.name);
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
    await page
      .getByLabel('Enrollment password', { exact: true })
      .fill(password);
    await page
      .getByRole('button', { name: 'Set up authenticator', exact: true })
      .click();
    const uri = await page.getByTestId('authenticator-uri').textContent();
    await page
      .getByLabel('Authenticator code', { exact: true })
      .fill(totpForUri(uri!));
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
}

/**
 * Signs the page's context in as the platform administrator and resolves with
 * the id of Harbor Legal Partners (the organization shown on the detail page).
 * The first caller on a stack builds the world; later callers reuse it.
 */
export async function platformWorld(page: Page) {
  const stack = descriptor();
  return sharedWorld(page, 'platform', async () => {
    // The prototype shows no address for the administrator. The address is
    // unique to this world, so an administrator that an earlier run left on
    // the stack (its authenticator secret is gone) cannot block it.
    await enrollAdministrator(
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
    return { harborId: ids.get(provisioningOrganizations[0].slug)! };
  });
}
