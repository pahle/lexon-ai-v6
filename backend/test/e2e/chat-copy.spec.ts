import { expect, test } from '@playwright/test';
import { openState, setupAnsweredChat } from './chat-state-fixtures.js';

// G1 (F4.2): the copy button reports a failed clipboard write and recovers.
// Chromium only; the clipboard permission model follows Playwright R6c.
const setup = (page: import('@playwright/test').Page) =>
  setupAnsweredChat(page, 'hukum-nusantara-copy');

test('copy succeeds with clipboard-write granted and shows Copied', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['clipboard-write', 'clipboard-read']);
  const stack = await setup(page);
  await openState(page, stack.publicUrl, 'answer-complete');
  await page.getByRole('button', { name: 'Copy answer' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test('copy failure shows the alert state, then the next click recovers', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stack = await setup(page);
  // A fresh context has no clipboard grant; the page-level stub makes the
  // rejection deterministic if Chromium still allows the write.
  await page.addInitScript(() => {
    let fail = true;
    Object.defineProperty(window, '__copyFails', {
      get: () => fail,
      set: (v: boolean) => {
        fail = v;
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () =>
          fail
            ? Promise.reject(new DOMException('denied', 'NotAllowedError'))
            : Promise.resolve(),
      },
    });
  });
  await openState(page, stack.publicUrl, 'answer-complete');
  await page.getByRole('button', { name: 'Copy answer' }).click();
  const failed = page.getByRole('button', {
    name: 'Could not copy. Try again',
  });
  await expect(failed).toBeVisible();
  await failed.hover();
  await expect(page.getByText('Could not copy', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __copyFails: boolean }).__copyFails = false;
  });
  await failed.click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});
