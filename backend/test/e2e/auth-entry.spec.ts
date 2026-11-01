import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support';
import { readCapturedMail } from './identity-support';
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
    await expect(page.locator('img')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});
test('entry signup verifies email before authenticated continuation', async ({
  page,
}) => {
  const stack = descriptor();
  const email = randomUUID() + '@example.test';
  await page.goto(stack.frontendUrl + '/sign-up');
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
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Browser-password-42!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/);
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
  await expect(page.locator('[data-slot="field-error"]')).toHaveText(
    'Unable to complete the request. Check your details or try again.',
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
  await expect(page.locator('[data-slot="field-error"]')).toHaveText(
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
