import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support';
import { readCapturedMail } from './identity-support';
import { totpForUri } from '../setup/totp';
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
  await page.goto(stack.frontendUrl + '/account/security');
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
  await expect(page.locator('[data-slot="field-error"]')).toHaveText(
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
});
