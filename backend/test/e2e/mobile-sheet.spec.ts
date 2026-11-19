import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

// Item 30 (F4.2): a click on the overlay outside the 300px sheet closes it.
test('mobile sheet: a click outside the sheet closes it (390x844)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Sheet Overlay',
    email: `sheet-${randomUUID()}@example.test`,
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${stack.publicUrl}/workspace`);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const sheet = page.getByRole('dialog', { name: 'Sidebar' });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(300);
  await page.mouse.click(350, 400);
  await expect(sheet).toBeHidden();
});
