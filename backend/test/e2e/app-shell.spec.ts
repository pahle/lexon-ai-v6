import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';

test('F2 shell keeps Home framed, collapses across reload, and renders scoped not-found routes', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  const chatRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/api/chat')) {
      chatRequests.push(request.url());
    }
  });
  await page.goto(stack.frontendUrl + '/workspace');
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(
    page.getByRole('link', { name: 'Home', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Chat message')).toBeDisabled();
  await expect(page.getByText('Chat is not available yet.')).toBeVisible();
  await expect(page.getByText('No conversations yet.')).toBeVisible();

  const sidebarContainer = page.locator(
    '[data-slot="sidebar-container"]:visible',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(
    await sidebarContainer.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe('0.4s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await sidebarContainer.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe('0s');

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(
    page.getByRole('button', { name: 'Collapse sidebar' }),
  ).toBeVisible();

  const org = await page.request.post(stack.apiUrl + '/api/organizations', {
    headers,
    data: { name: 'F2 route team', slug: 'f2-' + randomUUID().slice(0, 8) },
  });
  expect(org.status()).toBe(201);
  const { id } = (await org.json()) as { id: string };
  for (const path of [
    '/organizations',
    `/organizations/${id}`,
    `/organizations/${id}/x/y`,
  ]) {
    await page.goto(stack.frontendUrl + path);
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Return to workspace' }),
    ).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(
      page.getByRole('complementary', { name: 'Workspace navigation' }),
    ).toBeVisible();
  }
  for (const path of [
    `/organizations/${id}/members`,
    `/organizations/${id}/invitations`,
  ]) {
    await page.goto(stack.frontendUrl + path);
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Workspace navigation' }),
    ).toBeVisible();
  }
  for (const path of ['/account/security', '/not-a-route']) {
    await page.goto(stack.frontendUrl + path);
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Workspace navigation' }),
    ).toHaveCount(0);
  }
  expect(chatRequests).toEqual([]);
});

test('F2 sidebar supports mobile Escape and closes after real navigation at 375px', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(stack.frontendUrl + '/workspace');
  const open = page.getByRole('button', { name: 'Open navigation' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Sidebar' });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }),
  ).toBeVisible();
  const tabbable = dialog.locator('a:visible, button:visible');
  const first = tabbable.first();
  const last = tabbable.last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }),
  ).toBeHidden();
  await expect(open).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 767, height: 900 });
  await expect(
    page.getByRole('button', { name: 'Open navigation' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(
    page.getByRole('button', { name: 'Collapse sidebar' }),
  ).toBeVisible();
});
