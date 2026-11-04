import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { readCapturedMail } from './identity-support.js';
import { waitForVisualAuthFormReady } from './visual-support.js';

test('F2 auth entry pages expose the shared skip target and responsive page landmarks', async ({
  page,
}) => {
  const base = descriptor().frontendUrl;
  for (const path of ['sign-in', 'sign-up', 'two-factor']) {
    await page.goto(base + '/' + path);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('a[href="#main"]')).toHaveCount(1);
    await expect(page).toHaveTitle(/\S/);
  }
});

test('scripts-blocked auth forms submit credentials by POST without sensitive query keys', async ({
  browser,
}) => {
  const base = descriptor().frontendUrl;
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route('**/*.js*', (route) => route.abort());
  try {
    const cases = [
      {
        path: '/sign-in',
        fill: async () => {
          await page
            .getByLabel('Email', { exact: true })
            .fill('synthetic@example.test');
          await page
            .getByLabel('Password', { exact: true })
            .fill('Synthetic-password-42!');
        },
      },
      {
        path: '/sign-up',
        fill: async () => {
          await page
            .getByLabel('Name', { exact: true })
            .fill('Synthetic identity');
          await page
            .getByLabel('Email', { exact: true })
            .fill('synthetic@example.test');
          await page
            .getByLabel('Password', { exact: true })
            .fill('Synthetic-password-42!');
        },
      },
      {
        path: '/two-factor',
        fill: async () => {
          await page
            .getByLabel('Authenticator code', { exact: true })
            .fill('123456');
        },
      },
    ];
    const recorded: Array<{ method: string; sensitiveKeyBooleans: boolean[] }> =
      [];
    for (const form of cases) {
      await page.goto(base + form.path);
      await form.fill();
      const navigation = page.waitForRequest((request) =>
        request.isNavigationRequest(),
      );
      await page
        .getByRole('button', {
          name: /Sign in|Create account|Verify authenticator/,
        })
        .click();
      const request = await navigation;
      const query = new URL(request.url()).searchParams;
      const sensitiveKeyBooleans = ['email', 'password', 'code'].map((key) =>
        query.has(key),
      );
      recorded.push({ method: request.method(), sensitiveKeyBooleans });
    }
    expect(recorded).toHaveLength(3);
    expect(recorded.every((entry) => entry.method === 'POST')).toBe(true);
    expect(
      recorded.every((entry) =>
        entry.sensitiveKeyBooleans.every((hasKey) => !hasKey),
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test('pending reset button reserves the longer pending label intrinsic width', async ({
  page,
}) => {
  await page.goto(descriptor().frontendUrl + '/forgot-password');
  const email = page.getByLabel('Email', { exact: true });
  const button = page.locator('form button[type="submit"]');
  await button.click();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await email.fill('synthetic@example.test');
  await expect(email).not.toHaveAttribute('aria-invalid', 'true');
  const label = button.locator('span.inline-grid:not([aria-hidden="true"])');
  const idleWidth = await label.evaluate(
    (node) => node.getBoundingClientRect().width,
  );
  let release!: () => void;
  let routeEntered = false;
  let routeHandled!: () => void;
  const routeSettled = new Promise<void>((resolveHandled) => {
    routeHandled = resolveHandled;
  });
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  await page.route('**/api/auth/request-password-reset', async (route) => {
    routeEntered = true;
    try {
      await gate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'AUTH_UNAVAILABLE', message: 'Private server detail' },
        }),
      });
    } finally {
      routeHandled();
    }
  });
  let observedRequest!: import('@playwright/test').Request;
  try {
    const requestStarted = page.waitForRequest((request) => {
      const path = new URL(request.url()).pathname;
      return (
        request.isNavigationRequest() ||
        path === '/api/auth/request-password-reset'
      );
    });
    await button.click();
    observedRequest = await requestStarted;
    const observedUrl = new URL(observedRequest.url());
    expect(observedRequest.isNavigationRequest()).toBe(false);
    expect(observedRequest.method()).toBe('POST');
    expect(observedUrl.pathname).toBe('/api/auth/request-password-reset');
    expect(
      ['email', 'password', 'code'].some((key) =>
        observedUrl.searchParams.has(key),
      ),
    ).toBe(false);
    await expect.poll(() => routeEntered).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Sending reset link…' }),
    ).toBeDisabled();
    const pendingWidth = await label.evaluate(
      (node) => node.getBoundingClientRect().width,
    );
    expect(pendingWidth).toBe(idleWidth);
  } finally {
    release();
    if (routeEntered) await routeSettled;
    if (!page.isClosed()) {
      await page.unroute('**/api/auth/request-password-reset');
    }
  }
  expect((await observedRequest.response())?.status()).toBe(503);
  await expect(page.locator('[data-slot="alert"]')).toContainText(
    'Service temporarily unavailable. Please try again.',
  );
  await expect(page.locator('body')).not.toContainText('Private server detail');
});

test('entry pages are accessible and validate without social entry points', async ({
  page,
}) => {
  for (const route of [
    'sign-in',
    'sign-up',
    'forgot-password',
    'reset-password',
    'verify-email',
  ]) {
    await page.goto(descriptor().frontendUrl + '/' + route);
    await expect(
      page.getByRole('button', { name: /Google|GitHub|Microsoft|Apple/ }),
    ).toHaveCount(0);
    await expect(page.locator('img[alt="Lexon"]:visible')).toHaveCount(1);
    await expect(page.locator('img[alt="Lexon"]:visible')).toHaveAttribute(
      'width',
      '128',
    );
    await expect(page.locator('img:not([alt="Lexon"])')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});
test('entry signup verifies email before authenticated continuation', async ({
  page,
}) => {
  const stack = descriptor();
  const email = randomUUID() + '@example.test';
  await page.goto(stack.frontendUrl + '/sign-up');
  await waitForVisualAuthFormReady(page);
  await page.getByLabel('Name', { exact: true }).fill('Browser identity');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Browser-password-42!');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();
  const mail = await readCapturedMail(stack.project, email, 'verification');
  await page.goto(mail.actionUrl);
  await expect(
    page.getByRole('heading', { name: 'Email verified' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await waitForVisualAuthFormReady(page);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Browser-password-42!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/(workspace|onboarding)/);
});
test('credential-checked unverified sign-in offers safe verification resend', async ({
  page,
}) => {
  const stack = descriptor();
  const email = randomUUID() + '@example.test';
  const password = 'Browser-password-42!';
  const returnTo = '/workspace';
  await page.goto(stack.frontendUrl + '/sign-up?returnTo=%2Fworkspace');
  await waitForVisualAuthFormReady(page);
  await page.getByLabel('Name', { exact: true }).fill('Pending identity');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();

  await page.goto(
    stack.frontendUrl + '/sign-in?returnTo=' + encodeURIComponent(returnTo),
  );
  await waitForVisualAuthFormReady(page);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const outcome = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/sign-in/email') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await outcome;
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({
    error: {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Verify your email address before signing in.',
    },
  });
  expect(response.headers()['set-cookie']).toBeUndefined();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
  await expect(
    page.getByRole('button', { name: 'Resend verification email' }),
  ).toBeVisible();
  expect(page.url()).not.toContain(email);
  const hrefs = await page
    .locator('a')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href),
    );
  expect(hrefs.join('\n')).not.toContain(email);
  await page.getByRole('button', { name: 'Resend verification email' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'If eligible, you will receive a verification link.',
  );
  const mail = await readCapturedMail(stack.project, email, 'verification');
  const callback = new URL(mail.actionUrl).searchParams.get('callbackURL');
  expect(callback).not.toBeNull();
  expect(new URL(callback!).searchParams.get('returnTo')).toBe(returnTo);
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('href', '/sign-in?returnTo=%2Fworkspace');
  await expect(page.locator('body')).not.toContainText(password);
});
test('entry failures never disclose account existence and dependency errors stay safe', async ({
  page,
}) => {
  const base = descriptor().frontendUrl;
  await page.goto(base + '/sign-in');
  await page
    .getByLabel('Email', { exact: true })
    .fill('absent-' + randomUUID() + '@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Wrong-password-42!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('[data-slot="alert"]')).toContainText(
    'Email or password is incorrect. Check them and try again.',
  );
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'AUTH_UNAVAILABLE', message: 'private-server-sentinel' },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('[data-slot="alert"]')).toContainText(
    'Service temporarily unavailable. Please try again.',
  );
  await expect(page.locator('body')).not.toContainText(
    'private-server-sentinel',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto(base + '/reset-password?error=INVALID_TOKEN');
  await expect(
    page.getByRole('link', { name: 'Request a new reset link' }),
  ).toBeVisible();
  await page.goto(base + '/verify-email?error=INVALID_TOKEN');
  await expect(
    page.getByRole('button', { name: 'Resend verification email' }),
  ).toBeVisible();
});
