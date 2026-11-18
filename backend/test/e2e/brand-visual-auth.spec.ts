import { expect, test } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { captureBrandViews } from './brand-visual-support.js';
import { ayu } from './prototype-fixtures.js';
import { hideDevOverlayOnLoad } from './brand-visual-support.js';

// F4.1 visual set, auth group: the pages before sign-in and onboarding.
// Every state is captured in light and dark at 1440x900 and 390x844;
// docs/references/F4.1-visual/index.json lists them.

test.beforeEach(({ page }) => hideDevOverlayOnLoad(page));

test('sign-in states', async ({ page }) => {
  const base = descriptor().frontendUrl;
  await page.goto(base + '/sign-in');
  await expect(
    page.getByRole('heading', { name: 'Sign in to Lexon' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await captureBrandViews(page, 'sign-in');

  await page.getByLabel('Email', { exact: true }).fill('ayu@');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await captureBrandViews(page, 'sign-in-field-errors');

  await page.getByLabel('Email', { exact: true }).fill(ayu.email);
  await page.getByLabel('Password', { exact: true }).fill('password12345');
  // The sign-in request is held by a gated route, so the pending state is
  // open for as long as the captures need and never depends on a timer.
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((done) => (markStarted = done));
  const gate = new Promise<void>((done) => (release = done));
  await page.route('**/api/auth/sign-in/email', async (route) => {
    markStarted();
    await gate;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'AUTH_REQUIRED', message: 'Synthetic server detail' },
      }),
    });
  });
  try {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await started;
    await expect(
      page.getByRole('button', { name: 'Signing in…' }),
    ).toBeDisabled();
    await captureBrandViews(page, 'sign-in-pending');
    release();
    await expect(page.locator('[data-slot="alert"]')).toContainText(
      'Email or password is incorrect. Check them and try again.',
    );
    await expect(page.locator('body')).not.toContainText(
      'Synthetic server detail',
    );
    await captureBrandViews(page, 'sign-in-form-alert');
  } finally {
    release();
    await page.unroute('**/api/auth/sign-in/email');
  }
});

test('sign-up and secondary account flows', async ({ page }) => {
  const base = descriptor().frontendUrl;
  const visit = async (state: string, path: string, heading?: string) => {
    const response = await page.goto(base + path);
    expect(response?.status(), state).toBe(200);
    await expect(page.locator('main'), state).toHaveCount(1);
    await expect(page.locator('h1'), state).toHaveCount(1);
    if (heading)
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  };
  await visit('sign-up', '/sign-up', 'Create your account');
  await captureBrandViews(page, 'sign-up');
  await visit('forgot-password', '/forgot-password');
  await captureBrandViews(page, 'forgot-password');
  await visit('reset-password', '/reset-password');
  await captureBrandViews(page, 'reset-password');
  await visit('verify-email', '/verify-email?state=pending');
  await captureBrandViews(page, 'verify-email');
  await visit('two-factor', '/two-factor');
  await captureBrandViews(page, 'two-factor');
  await visit('accept-invitation', '/accept-invitation?invitationId=invalid');
  await captureBrandViews(page, 'accept-invitation');
  await visit('admin-setup', '/admin-setup');
  await captureBrandViews(page, 'admin-setup');
});

test('onboarding for a real API-created identity', async ({ page }) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Brand Preview',
  });
  const profile = await page.request.patch(
    stack.apiUrl + '/api/identity/profile',
    { headers, data: { name: 'Brand Preview' } },
  );
  expect(profile.status()).toBe(200);
  await page.goto(stack.frontendUrl + '/onboarding');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Lexon' }),
  ).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Brand Preview');
  await captureBrandViews(page, 'onboarding');
});

// TODO(W2): implement this capture (Forgot password, link sent); the prototype state is
// `forgot-password-sent`. The index already lists the four variants.
test.fixme('forgot-password-sent', async ({ page }) => {
  await captureBrandViews(page, 'forgot-password-sent');
});

// TODO(W2): implement this capture (Reset password, invalid or expired link); the prototype state is
// `reset-password-invalid`. The index already lists the four variants.
test.fixme('reset-password-invalid', async ({ page }) => {
  await captureBrandViews(page, 'reset-password-invalid');
});

// TODO(W2): implement this capture (Accept invitation, unavailable); the prototype state is
// `accept-invitation-unavailable`. The index already lists the four variants.
test.fixme('accept-invitation-unavailable', async ({ page }) => {
  await captureBrandViews(page, 'accept-invitation-unavailable');
});

// TODO(W2): implement this capture (Administrator setup, unavailable); the prototype state is
// `admin-setup-unavailable`. The index already lists the four variants.
test.fixme('admin-setup-unavailable', async ({ page }) => {
  await captureBrandViews(page, 'admin-setup-unavailable');
});

// TODO(W2): implement this capture (Onboarding, pending invitations); the prototype state is
// `onboarding-invitations`. The index already lists the four variants.
test.fixme('onboarding-invitations', async ({ page }) => {
  await captureBrandViews(page, 'onboarding-invitations');
});
