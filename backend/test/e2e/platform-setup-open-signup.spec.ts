import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { readCapturedMail, waitForHydration } from './identity-support.js';
import {
  currentSignupMode,
  operatorSetup,
  signupMode,
} from './setup-support.js';
import { totpForUri } from '../setup/totp.js';

// Administrator setup while sign-up is OPEN: the setup token is only a
// registration proof and the single-use key to platform rights. Open sign-up
// must neither skip any activation step nor hand platform rights to anyone else.
//
// The stack is shared and a first administrator can only be provisioned once
// (platform-identity.spec.ts does that with a plain operatorSetup). This file is
// named to sort after it, and it provisions with `additional` so it works
// whether or not an administrator already exists.
test.setTimeout(180000);
test.beforeAll(async () => {
  if (!(await currentSignupMode())) await signupMode(true);
});

async function signInThroughForm(page: Page, email: string, password: string) {
  await waitForHydration(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  );
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === '/api/auth/sign-in/email' &&
      candidate.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(200);
}

test('open sign-up: the setup link creates a platform administrator exactly once and an ordinary sign-up never gets platform rights', async ({
  page,
  browser,
}) => {
  const stack = descriptor();
  const password = 'Platform-open-signup-42!';
  const email = randomUUID() + '@example.test';
  const setup = await operatorSetup(email, true);
  expect(setup.status).toBe('created');
  const actionUrl = setup.mail!.actionUrl;
  const token = new URL(actionUrl).searchParams.get('token')!;
  expect(token).toBeTruthy();

  // Setup link -> Create setup account -> sign-up form (sign-up is open).
  await page.goto(actionUrl);
  await page
    .getByRole('button', { name: 'Create setup account', exact: true })
    .click();
  await waitForHydration(
    page.getByRole('button', { name: 'Create account', exact: true }),
  );
  await page.getByLabel('Full name', { exact: true }).fill('Open operator');
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Verify your email' }),
  ).toBeVisible();

  // Verify the address, sign in, return to setup.
  await page.goto(
    (await readCapturedMail(stack.project, email, 'verification')).actionUrl,
  );
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await signInThroughForm(page, email, password);
  await expect(page).toHaveURL(/admin-setup/);

  // Activation is impossible before the authenticator is enrolled.
  await expect(
    page.getByRole('button', {
      name: 'Activate platform administrator',
      exact: true,
    }),
  ).toHaveCount(0);
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

  // The new administrator reaches the platform API.
  const platform = await page.request.get(
    stack.apiUrl + '/api/platform/provisioning',
    { headers: { origin: stack.frontendUrl } },
  );
  expect(platform.status()).toBe(200);

  // The same token cannot be redeemed or completed a second time.
  for (const action of ['redeem', 'complete']) {
    const again = await page.request.post(
      stack.apiUrl + '/api/identity/admin-setup/' + action,
      { headers: { origin: stack.frontendUrl }, data: { token } },
    );
    expect(again.ok()).toBe(false);
  }
  const visitor = await browser.newContext();
  try {
    const stale = await visitor.newPage();
    await stale.goto(actionUrl);
    await expect(
      stale.getByRole('heading', { name: 'Setup link unavailable' }),
    ).toBeVisible();
  } finally {
    await visitor.close();
  }

  // An ordinary open sign-up without a token never gets platform rights.
  const ordinaryEmail = randomUUID() + '@example.test';
  const ordinary = await browser.newContext();
  try {
    const ordinaryPage = await ordinary.newPage();
    const created = await ordinary.request.post(
      stack.apiUrl + '/api/auth/sign-up/email',
      {
        headers: { origin: stack.frontendUrl },
        data: {
          name: 'Ordinary user',
          email: ordinaryEmail,
          password,
          callbackURL: stack.frontendUrl + '/verify-email?state=confirmed',
        },
      },
    );
    expect(created.ok()).toBe(true);
    await ordinaryPage.goto(
      (await readCapturedMail(stack.project, ordinaryEmail, 'verification'))
        .actionUrl,
    );
    await ordinaryPage.goto(stack.frontendUrl + '/sign-in');
    await signInThroughForm(ordinaryPage, ordinaryEmail, password);
    // signInThroughForm resolves on the sign-in response; wait for the
    // resulting navigation to commit before the next page.goto.
    await expect(ordinaryPage).toHaveURL(/\/(workspace|onboarding)/);
    const denied = await ordinary.request.get(
      stack.apiUrl + '/api/platform/provisioning',
      { headers: { origin: stack.frontendUrl } },
    );
    // An authenticated, verified non-administrator on a platform route is
    // refused with the identity contract's 403 ORG_FORBIDDEN (spec §4.2).
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: 'ORG_FORBIDDEN' },
    });
    await ordinaryPage.goto(stack.frontendUrl + '/platform/provisioning');
    await expect(ordinaryPage).toHaveURL(
      /\/platform\/organizations\?state=provisioning$/,
    );
    await expect(ordinaryPage.locator('section[role="alert"]')).toContainText(
      'You do not have access',
    );
  } finally {
    await ordinary.close();
  }
});
