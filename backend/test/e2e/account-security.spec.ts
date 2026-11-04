import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { readCapturedMail } from './identity-support.js';
import { totpForUri } from '../setup/totp.js';

test('settings deep links, shortcut, draft reset, and nested destructive focus stay in the workspace', async ({
  page,
}) => {
  const stack = descriptor();
  const email = `security-${randomUUID()}@example.test`;
  const password = 'Security-review-42!';
  const headers = await (
    await import('./identity-support.js')
  ).authenticateApi(page.request, { email, password });
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/auth/sign-in/email', {
        headers: { origin: stack.frontendUrl },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);

  await page.goto(stack.frontendUrl + '/workspace?filter=recent#cases');
  await page.keyboard.press('Control+,');
  await expect(page).toHaveURL(
    /\/workspace\?filter=recent&settings=profile#cases$/,
  );
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole('heading', { name: 'Settings', exact: true }),
  ).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Close settings', exact: true }),
  ).toBeFocused();
  const name = page.getByLabel('Display name');
  await expect(name).toBeVisible();
  const savedName = await name.inputValue();
  await name.fill('Unsaved review draft');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await page.goto(
    stack.frontendUrl + '/workspace?filter=recent&settings=profile#cases',
  );
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue(savedName);
  await dialog
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'Security', exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/workspace\?filter=recent&settings=security#cases$/,
  );
  const revoke = page.getByRole('button', {
    name: 'Revoke browser session',
    exact: true,
  });
  await expect(revoke).toBeVisible();
  await expect(revoke).toHaveClass(/text-destructive/);
  await revoke.click();
  const confirmation = page.getByRole('alertdialog', {
    name: 'Revoke this session?',
  });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(revoke).toBeFocused();
});

test('F2 appearance preference persists in this browser without changing security page behavior', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await (
    await import('./identity-support.js')
  ).authenticateApi(page.request);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  await page.goto(stack.frontendUrl + '/workspace?settings=appearance');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(42, 21, 25)',
  );
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.goto(stack.frontendUrl + '/workspace?settings=security');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('main')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
});

test('security TOTP enrollment challenge and recovery are accessible and remain ephemeral', async ({
  page,
}) => {
  const stack = descriptor();
  const email = randomUUID() + '@example.test';
  const password = 'Security-browser-42!';
  const headers = { origin: stack.frontendUrl };
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/auth/sign-up/email', {
        headers,
        data: { name: 'Security browser', email, password },
      })
    ).status(),
  ).toBe(200);
  const url = new URL(
    (await readCapturedMail(stack.project, email, 'verification')).actionUrl,
  );
  url.searchParams.delete('callbackURL');
  expect(
    (await page.request.get(stack.apiUrl + url.pathname + url.search)).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/auth/sign-in/email', {
        headers,
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  await page.goto(stack.frontendUrl + '/workspace?settings=security');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Set up authenticator', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('textarea[aria-label="Message input"]'),
  ).toHaveCount(0);
  expect(
    (
      await page.request.post(
        stack.apiUrl + '/api/identity/onboarding/complete',
        {
          headers,
          data: {},
        },
      )
    ).status(),
  ).toBe(204);
  await page.goto(stack.frontendUrl + '/workspace?settings=security');
  await page
    .getByRole('button', { name: 'Set up authenticator', exact: true })
    .click();
  await page.getByLabel('Enrollment password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Set up authenticator', exact: true })
    .click();
  const uri = await page.getByTestId('authenticator-uri').textContent();
  expect(!!uri).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const validCodes = new Set(
    [-30000, 0, 30000].map((offset) => totpForUri(uri!, Date.now() + offset)),
  );
  const invalidCode = ['000000', '000001', '000002', '000003'].find(
    (code) => !validCodes.has(code),
  )!;
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(invalidCode);
  await page
    .getByRole('button', { name: 'Verify authenticator', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Unable to verify this code. Please try again.',
  );
  await expect(
    page.getByLabel('Authenticator code', { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totpForUri(uri!));
  await page
    .getByRole('button', { name: 'Verify authenticator', exact: true })
    .click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  const recovery = (await page
    .getByTestId('recovery-codes')
    .locator('li')
    .first()
    .textContent())!;
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole('button', { name: 'I saved my recovery codes', exact: true })
    .click();
  await expect(page.getByTestId('recovery-codes')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Back to security', exact: true })
    .click();
  await expect(page.getByText('Browser', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).length + Object.keys(sessionStorage).length,
    ),
  ).toBe(0);
  await page.goto('about:blank');
  await page.request.post(stack.frontendUrl + '/api/auth/sign-out', {
    headers,
    data: {},
  });
  await page.goto(stack.frontendUrl + '/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/two-factor/);
  expect(
    (await page.request.get(stack.frontendUrl + '/api/identity')).status(),
  ).toBe(401);
  await page
    .getByRole('button', { name: 'Use a recovery code', exact: true })
    .click();
  await page.getByLabel('Recovery code', { exact: true }).fill(recovery);
  await page
    .getByRole('button', { name: 'Verify recovery code', exact: true })
    .click();
  await expect(page).toHaveURL(/\/(workspace|onboarding)/);
  expect(
    (await page.request.get(stack.frontendUrl + '/api/identity')).status(),
  ).toBe(200);

  await page.goto(stack.frontendUrl + '/workspace?settings=security');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  const manageForm = page.getByLabel('Security password', { exact: true });
  await manageForm.fill(password);
  const accountOperationRequests: string[] = [];
  const captureAccountOperation = (
    request: import('@playwright/test').Request,
  ) => {
    if (request.url().includes('/api/auth/two-factor/'))
      accountOperationRequests.push(new URL(request.url()).pathname);
  };
  page.on('request', captureAccountOperation);
  await manageForm.press('Enter');
  const disableDialog = page.getByRole('alertdialog', {
    name: 'Disable two-factor authentication?',
  });
  await expect(disableDialog).toBeVisible();
  expect(accountOperationRequests).toEqual([]);
  await disableDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(disableDialog).toBeHidden();
  expect(accountOperationRequests).toEqual([]);
  await page
    .getByRole('button', { name: 'Disable two-factor authentication' })
    .click();
  await expect(disableDialog).toBeVisible();
  const disableResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/two-factor/disable' &&
      response.request().method() === 'POST',
  );
  await disableDialog
    .getByRole('button', { name: 'Disable two-factor authentication' })
    .click();
  expect((await disableResponse).status()).toBe(200);
  expect(accountOperationRequests).toEqual(['/api/auth/two-factor/disable']);
  page.off('request', captureAccountOperation);
});
test('expired security session preserves its safe return intent', async ({
  page,
  context,
}) => {
  const stack = descriptor();
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: 'expired-security-session',
      url: stack.frontendUrl,
    },
  ]);
  await page.goto(stack.frontendUrl + '/workspace?settings=security');
  await expect(page).toHaveURL(/\/sign-in/);
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(
    '/workspace?settings=security',
  );
});
