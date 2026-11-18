import { expect, test, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { readCapturedMail } from './identity-support.js';
import { operatorSetup, signupMode } from './setup-support.js';
import { totpForUri } from '../setup/totp.js';
import { brandFixedTime, captureBrandViews } from './brand-visual-support.js';
import { gateRequests } from './brand-visual-world.js';
import {
  platformAdmin,
  prototypeNow,
  provisioningOrganizations,
} from './prototype-fixtures.js';
import { hideDevOverlayOnLoad } from './brand-visual-support.js';

// F4.1 visual set, platform group: provisioning and account status for a
// real platform administrator.

/** The list shows each organization's prototype expiry and status. */
async function installProvisioningListNormalization(page: Page) {
  const matcher = (url: URL) =>
    url.pathname === '/api/platform/provisioning' &&
    url.searchParams.has('limit');
  const handler = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = (await response.json()) as {
      items: Array<{
        slug: string;
        createdAt: string;
        invitation: { status: string; expiresAt: string };
      }>;
    };
    const items = provisioningOrganizations.flatMap((organization) => {
      const row = body.items.find((item) => item.slug === organization.slug);
      return row
        ? [
            {
              ...row,
              createdAt: prototypeNow,
              invitation: {
                ...row.invitation,
                status:
                  organization.status === 'Expired' ? 'expired' : 'pending',
                expiresAt: organization.expiresAt,
              },
            },
          ]
        : [];
    });
    return route.fulfill({ response, json: { ...body, items } });
  };
  await page.route(matcher, handler);
  return { remove: () => page.unroute(matcher, handler) };
}

// Platform, errors, and UI patterns.

let restoreSignupModeAfterTest = false;
test.afterEach(async () => {
  if (!restoreSignupModeAfterTest) return;
  restoreSignupModeAfterTest = false;
  await signupMode(true);
});
test.beforeEach(({ page }) => hideDevOverlayOnLoad(page));

test('Platform pages for a real platform administrator', async ({ page }) => {
  test.setTimeout(230_000);
  const stack = descriptor();
  const email = platformAdmin.email;
  const password = 'Brand-operator-42!';
  await signupMode(false);
  restoreSignupModeAfterTest = true;
  const setup = await operatorSetup(email, true);
  expect(setup.status).toBe('created');
  await page.goto(setup.mail!.actionUrl);
  await page
    .getByRole('button', { name: 'Create setup account', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill(platformAdmin.name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
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
  await page.getByLabel('Enrollment password', { exact: true }).fill(password);
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
  expect(
    (
      await page.request.post(
        stack.apiUrl + '/api/identity/onboarding/complete',
        { headers: { origin: stack.frontendUrl }, data: {} },
      )
    ).status(),
  ).toBe(204);
  await page.clock.setFixedTime(brandFixedTime);

  const listUrl = (url: URL, method: string) =>
    url.pathname === '/api/platform/provisioning' &&
    url.searchParams.has('limit') &&
    (method === 'GET' || method === '');
  const provisioning = stack.frontendUrl + '/platform/provisioning';

  // The empty list: nothing has been provisioned yet.
  await page.goto(provisioning);
  await expect(page.locator('h1')).toHaveText('Organization provisioning');
  await expect(
    page.getByText('No provisioning organizations', { exact: true }),
  ).toBeVisible();
  await captureBrandViews(page, 'platform-provisioning-empty');

  // The list request is held by a gated route, then released.
  const list = await gateRequests(page, listUrl);
  try {
    await page.reload();
    await list.started;
    await expect(
      page.getByRole('status', { name: 'Checking platform access' }),
    ).toBeVisible();
    await captureBrandViews(page, 'platform-provisioning-loading');
  } finally {
    await list.finish();
  }

  const failingList = (url: URL) => listUrl(url, 'GET');
  await page.route(failingList, (route) =>
    route.request().method() !== 'GET'
      ? route.fallback()
      : route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"private platform detail"}',
        }),
  );
  try {
    await expect(async () => {
      await page.reload();
      await expect(
        page.getByText('Service temporarily unavailable. Please try again.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await expect(page.locator('body')).not.toContainText(
      'private platform detail',
    );
    await captureBrandViews(page, 'platform-provisioning-error');
  } finally {
    await page.unroute(failingList);
  }

  const created = await page.request.post(
    stack.apiUrl + '/api/platform/provisioning',
    {
      headers: { origin: stack.frontendUrl },
      data: {
        name: provisioningOrganizations[0].name,
        slug: provisioningOrganizations[0].slug,
        ownerEmail: provisioningOrganizations[0].ownerEmail,
      },
    },
  );
  expect(created.status()).toBe(201);
  for (const other of provisioningOrganizations.slice(1))
    expect(
      (
        await page.request.post(stack.apiUrl + '/api/platform/provisioning', {
          headers: { origin: stack.frontendUrl },
          data: {
            name: other.name,
            slug: other.slug,
            ownerEmail: other.ownerEmail,
          },
        })
      ).status(),
    ).toBe(201);
  // The list shows the prototype dates and the expired invitation.
  const normalized = await installProvisioningListNormalization(page);
  const organization = (await created.json()) as { id: string };
  await page.goto(provisioning);
  await expect(
    page.getByRole('link', { name: 'Harbor Legal Partners', exact: true }),
  ).toBeVisible();
  await captureBrandViews(page, 'platform-provisioning-populated');
  await normalized.remove();

  // The invitation expiry is the only time-dependent value on the detail page.
  const detailPath = `/api/platform/provisioning/${organization.id}`;
  const detailUrl = (url: URL) => url.pathname === detailPath;
  await page.route(detailUrl, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as {
      invitation: { expiresAt: string };
    };
    body.invitation.expiresAt = '2026-11-21T04:00:00.000Z';
    return route.fulfill({ response, json: body });
  });
  try {
    await page
      .getByRole('link', { name: 'Harbor Legal Partners', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Resend owner invitation' }),
    ).toBeVisible();
    await expect(
      page.getByText('Nov 21, 2026', { exact: false }),
    ).toBeVisible();
    await captureBrandViews(page, 'platform-provisioning-detail');
  } finally {
    await page.unroute(detailUrl);
  }

  await page.goto(stack.frontendUrl + '/platform/accounts');
  await expect(page.getByLabel('User ID')).toBeVisible();
  await captureBrandViews(page, 'platform-accounts');
});
