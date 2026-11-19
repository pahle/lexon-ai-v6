import type { Page } from '@playwright/test';

/**
 * Fixes the browser clock at 09:00 local time on 2026-11-16 so the new-chat
 * greeting is "Good morning, <first name>" whatever the host time zone is.
 * Call it before the first navigation; the fixed time survives reloads.
 */
export async function freezeMorningClock(page: Page) {
  const nineLocal = await page.evaluate(() =>
    new Date(2026, 10, 16, 9, 0, 0).getTime(),
  );
  await page.clock.setFixedTime(nineLocal);
}
