import { expect, test } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { captureBrandViews } from './brand-visual-support.js';
import { ayu, team, invitationToTeam } from './prototype-fixtures.js';
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
  // A link in hand shows the form; the token is read client side only.
  await visit(
    'reset-password',
    '/reset-password?token=visual-preview-token',
    'Choose a new password',
  );
  await captureBrandViews(page, 'reset-password');
  await visit('two-factor', '/two-factor');
  // Three digits typed; the fourth slot is the active one.
  await page.getByLabel('Authentication code').pressSequentially('481');
  await captureBrandViews(page, 'two-factor');
  // A well-formed invitation id; the page does not look the invitation up.
  await visit(
    'accept-invitation',
    '/accept-invitation?invitationId=00000000-0000-4000-8000-000000000001',
    'Accept invitation',
  );
  await captureBrandViews(page, 'accept-invitation');
});

test('verify-email after sign-up', async ({ page }) => {
  const base = descriptor().frontendUrl;
  await page.goto(base + '/sign-up');
  await page.getByLabel('Full name', { exact: true }).fill(ayu.name);
  await page.getByLabel('Work email', { exact: true }).fill(ayu.email);
  await page.getByLabel('Password', { exact: true }).fill('password12345');
  // The sign-up request is answered by a route, so no account is created.
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: null, user: null }),
    }),
  );
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Verify your email' }),
  ).toBeVisible();
  await captureBrandViews(page, 'verify-email');
});

test('forgot-password-sent', async ({ page }) => {
  const base = descriptor().frontendUrl;
  await page.goto(base + '/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(ayu.email);
  await page.route('**/api/auth/request-password-reset', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: true }),
    }),
  );
  await page
    .getByRole('button', { name: 'Send reset link', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();
  // The confirmation toast leaves on its own; the prototype state has none.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, {
    timeout: 15000,
  });
  await captureBrandViews(page, 'forgot-password-sent');
});

test('reset-password-invalid', async ({ page }) => {
  await page.goto(
    descriptor().frontendUrl + '/reset-password?error=INVALID_TOKEN',
  );
  await expect(
    page.getByRole('heading', { name: 'This link has expired' }),
  ).toBeVisible();
  await captureBrandViews(page, 'reset-password-invalid');
});

test('accept-invitation-unavailable', async ({ page }) => {
  await page.goto(
    descriptor().frontendUrl + '/accept-invitation?invitationId=invalid',
  );
  await expect(
    page.getByRole('heading', { name: 'Invitation unavailable' }),
  ).toBeVisible();
  await captureBrandViews(page, 'accept-invitation-unavailable');
});

test('admin-setup-unavailable', async ({ page }) => {
  await page.goto(descriptor().frontendUrl + '/admin-setup');
  await expect(
    page.getByRole('heading', { name: 'Setup link unavailable' }),
  ).toBeVisible();
  await captureBrandViews(page, 'admin-setup-unavailable');
});

test('admin-setup', async ({ page }) => {
  // The setup link redeems; the visitor has no session yet, so the page asks
  // for sign-in. The two API answers are routed, nothing is redeemed.
  await page.route('**/api/identity/admin-setup/redeem', (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route('**/api/identity/security', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'AUTH_REQUIRED', message: 'Sign in required' },
      }),
    }),
  );
  await page.goto(descriptor().frontendUrl + '/admin-setup?token=visual-setup');
  await expect(
    page.getByRole('heading', { name: 'Set up platform administration' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await captureBrandViews(page, 'admin-setup');
});

test('admin-setup-activate', async ({ page }) => {
  // A verified account with two-step verification: the page offers Activate.
  // The three API answers are routed, nothing is redeemed or activated.
  await page.route('**/api/identity/admin-setup/redeem', (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route('**/api/identity/security', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        twoFactorEnabled: true,
        mfaVerified: true,
        reauthenticationExpiresAt: null,
        recoveryCodesRemaining: 8,
        passwordChangedAt: null,
      }),
    }),
  );
  await page.route('**/api/identity/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        id: '00000000-0000-4000-8000-0000000000c1',
        email: 'dimas@hukum-nusantara.co.id',
        name: 'Dimas Prasetyo',
        emailVerified: true,
        twoFactorEnabled: true,
        jobTitle: null,
        onboardingCompleted: true,
      }),
    }),
  );
  await page.goto(descriptor().frontendUrl + '/admin-setup?token=visual-setup');
  await expect(
    page.getByRole('heading', { name: 'Activate administrator access' }),
  ).toBeVisible();
  await captureBrandViews(page, 'admin-setup-activate');
});

test('accept-invitation-declined', async ({ page }) => {
  const invitationId = '00000000-0000-4000-8000-000000000001';
  await page.route('**/api/**/invitations/*/decline', (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto(
    descriptor().frontendUrl +
      '/accept-invitation?invitationId=' +
      invitationId,
  );
  await page
    .getByRole('button', { name: 'Decline invitation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Invitation declined' }),
  ).toBeVisible();
  await captureBrandViews(page, 'accept-invitation-declined');
});

async function openOnboarding(page: import('@playwright/test').Page) {
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
}

test('onboarding for a real API-created identity', async ({ page }) => {
  await openOnboarding(page);
  await captureBrandViews(page, 'onboarding');
});

test('onboarding-invitations', async ({ page }) => {
  await openOnboarding(page);
  // The invitation list is answered by a route with the prototype invitation.
  await page.route('**/api/identity/invitations?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            version: 1,
            id: '00000000-0000-4000-8000-0000000000a1',
            organizationId: '00000000-0000-4000-8000-0000000000b1',
            organizationName: team.name,
            email: ayu.email,
            role: 'member',
            purpose: 'team',
            status: 'pending',
            createdAt: '2026-11-14T04:00:00.000Z',
            expiresAt: invitationToTeam.expiresAt,
          },
        ],
        pageInfo: { nextCursor: null },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pending invitations' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: team.name })).toBeVisible();
  await captureBrandViews(page, 'onboarding-invitations');
});

test('onboarding-team', async ({ page }) => {
  await openOnboarding(page);
  // Steps 1 and 2 are real: the profile is saved, the invitation list is empty.
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Pending invitations' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create a team, or start on your own' }),
  ).toBeVisible();
  await captureBrandViews(page, 'onboarding-team');
});
