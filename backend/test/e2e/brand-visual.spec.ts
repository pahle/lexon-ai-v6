import { expect, test } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { captureBrandViews } from './brand-visual-support.js';

// The F4.1 visual set. Every state is captured in light and dark at
// 1440×900 and 390×844; docs/references/F4.1-visual/index.json lists them.

test('sign-in states', async ({ page }) => {
  const base = descriptor().frontendUrl;
  await page.goto(base + '/sign-in');
  await expect(
    page.getByRole('heading', { name: 'Sign in to Lexon' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await captureBrandViews(page, 'sign-in');

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

  await page
    .getByLabel('Email', { exact: true })
    .fill('synthetic-review@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Synthetic-review-password-42!');
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
