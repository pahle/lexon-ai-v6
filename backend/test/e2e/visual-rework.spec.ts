import { expect, test } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import {
  captureVisualView,
  type VisualTheme,
  type VisualViewport,
} from './visual-support.js';

test('sign-in and sign-up have the published frame and indexed checkpoint captures', async ({
  page,
}) => {
  const stack = descriptor();
  const base = stack.frontendUrl;
  const viewportPairs: VisualViewport[] = ['desktop', 'mobile'];
  const themes: VisualTheme[] = ['light', 'dark'];

  const response = await page.goto(base + '/sign-in');
  const body = await page.locator('body').innerText();
  expect(
    response?.status(),
    `auth route returned ${response?.status()}: ${body}`,
  ).toBe(200);
  await expect(page.locator('main'), body).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('a[href="#main"]')).toHaveCount(1);
  for (const viewport of viewportPairs) {
    for (const theme of themes) {
      await captureVisualView(page, 'sign-in', theme, viewport);
    }
  }
  await page.goto(base + '/sign-up');
  for (const viewport of viewportPairs) {
    for (const theme of themes)
      await captureVisualView(page, 'sign-up', theme, viewport);
  }

});

test('a real API-authenticated incomplete identity renders onboarding checkpoints', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  const profile = await page.request.patch(
    stack.apiUrl + '/api/identity/profile',
    { headers, data: { name: 'Checkpoint Preview' } },
  );
  expect(profile.status()).toBe(200);
  await page.goto(stack.frontendUrl + '/onboarding');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Lexon' }),
  ).toBeVisible();
  for (const viewport of ['desktop', 'mobile'] as const) {
    for (const theme of ['light', 'dark'] as const)
      await captureVisualView(page, 'onboarding', theme, viewport);
  }
});

test('auth frame cover follows the published 1024px desktop boundary without overflow', async ({
  page,
}) => {
  await page.goto(descriptor().frontendUrl + '/sign-in');
  await page.setViewportSize({ width: 1023, height: 900 });
  await expect(page.locator('[aria-hidden="true"].lg\\:block')).toBeHidden();
  expect(
    await page
      .locator('form')
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBeGreaterThan(0);
  expect(
    await page.locator('html').evaluate((node) => node.scrollWidth),
  ).toBeLessThanOrEqual(1023);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator('[aria-hidden="true"].lg\\:block')).toBeVisible();
  expect(
    await page
      .locator('form')
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBeGreaterThan(0);
  expect(
    await page.locator('html').evaluate((node) => node.scrollWidth),
  ).toBeLessThanOrEqual(1024);
});

test('secondary account flows render inside the shared auth frame', async ({
  page,
}) => {
  const base = descriptor().frontendUrl;
  const routes = [
    '/forgot-password',
    '/reset-password',
    '/verify-email?state=pending',
    '/two-factor',
    '/accept-invitation?invitationId=invalid',
    '/admin-setup',
  ];
  for (const route of routes) {
    const response = await page.goto(base + route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator('main'), route).toHaveCount(1);
    await expect(page.locator('h1'), route).toHaveCount(1);
    await expect(
      page.locator('[aria-hidden="true"].lg\\:block'),
      route,
    ).toHaveCount(1);
  }
});
