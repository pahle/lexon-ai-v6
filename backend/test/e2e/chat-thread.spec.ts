import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

test('new chat accepts a prompt, navigates to a stable thread, and renders the scripted answer', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Task 14 Preview',
    email: `task-14-${randomUUID()}@example.test`,
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    {
      headers,
      data: {},
    },
  );
  expect(onboarded.status()).toBe(204);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${stack.publicUrl}/workspace`);
  const composer = page.getByRole('textbox', { name: 'Message input' });
  await expect(composer).toBeVisible();
  const deepThinking = page.getByRole('button', { name: 'Deep thinking' });
  await deepThinking.click();
  await expect(deepThinking).toHaveAttribute('aria-pressed', 'true');
  await composer.fill('Review this clause');
  await expect(composer).toBeFocused();
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/i);
  await expect(
    page.getByText('Scripted answer: Review this clause'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('button', { name: 'Deep thinking' }),
  ).toHaveAttribute('aria-pressed', 'false');

  await mkdir('test-results/f4-chat', { recursive: true });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-thread-desktop-light.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-thread-desktop-dark.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/f4-chat/task-14-thread-mobile-dark.png',
    fullPage: true,
  });
});
