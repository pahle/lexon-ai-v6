import { test, expect } from '@playwright/test';
const descriptor = (): { frontendUrl: string } =>
  JSON.parse(process.env.LEXON_E2E_DESCRIPTOR ?? '{}');
test('SSR and browser same-origin health agree; validation sends only valid UUID', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') calls.push(request.url());
  });
  const health = page.waitForResponse(
    (response) => response.url() === descriptor().frontendUrl + '/api/health',
  );
  await page.goto(descriptor().frontendUrl);
  expect((await health).status()).toBe(200);
  const main = page.locator('main');
  const serverVersion = await main.getAttribute('data-server-version');
  expect(serverVersion).toBeTruthy();
  await expect(
    page.getByText('Backend version ' + serverVersion),
  ).toBeVisible();
  await expect(
    page.getByText('Backend available', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Probe ID').fill('invalid');
  await page.getByRole('button', { name: 'Validate request' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Enter a valid UUID.' }),
  ).toHaveText('Enter a valid UUID.');
  expect(calls).toHaveLength(0);
  const id = crypto.randomUUID();
  await page.getByLabel('Probe ID').fill(id);
  const submitted = page.waitForRequest(
    (request) => request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Validate request' }).click();
  const request = await submitted;
  expect(request.url()).toBe(
    descriptor().frontendUrl + '/api/diagnostics/validation',
  );
  expect(request.postDataJSON()).toEqual({ probeId: id });
  await expect(
    page.getByText('Validation accepted', { exact: true }),
  ).toBeVisible();
});
