import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  const storedProfile = (await (
    await page.request.get(stack.apiUrl + '/api/identity/profile')
  ).json()) as { name: string };
  expect(storedProfile.name).toBe('Checkpoint Preview');
  await page.goto(stack.frontendUrl + '/onboarding');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Lexon' }),
  ).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 900, formWidth: 320 },
    { width: 390, height: 844, formWidth: 320 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.locator('main').evaluate((main) =>
        Math.round(main.getBoundingClientRect().width),
      ),
    ).toBe(viewport.width);
    expect(
      await page.getByLabel('Display name').evaluate((input) =>
        Math.round(input.getBoundingClientRect().width),
      ),
    ).toBe(viewport.formWidth);
    await expect(page.getByLabel('Display name')).toHaveValue(
      'Checkpoint Preview',
    );
  }
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
    { name: 'forgot-password', path: '/forgot-password' },
    { name: 'reset-password', path: '/reset-password' },
    { name: 'verify-email', path: '/verify-email?state=pending' },
    { name: 'two-factor', path: '/two-factor' },
    {
      name: 'accept-invitation',
      path: '/accept-invitation?invitationId=invalid',
    },
    { name: 'admin-setup', path: '/admin-setup' },
  ];
  const reviewDirectory = resolve('.cache/f21-task3-secondary');
  await mkdir(reviewDirectory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const route of routes) {
    const response = await page.goto(base + route.path);
    expect(response?.status(), route.name).toBe(200);
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    const themeResponse = await page.reload();
    expect(themeResponse?.status(), route.name).toBe(200);
    await expect(page.locator('main'), route.name).toHaveCount(1);
    await expect(page.locator('h1'), route.name).toHaveCount(1);
    await expect(
      page.locator('[aria-hidden="true"].lg\\:block'),
      route.name,
    ).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await expect(page.locator('img[alt="Lexon"]:visible')).toHaveCount(1);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    await page.screenshot({
      path: resolve(reviewDirectory, route.name + '.png'),
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
  }
});
