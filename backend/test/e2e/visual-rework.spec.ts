import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
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
      await page
        .locator('main')
        .evaluate((main) => Math.round(main.getBoundingClientRect().width)),
    ).toBe(viewport.width);
    expect(
      await page
        .getByLabel('Display name')
        .evaluate((input) => Math.round(input.getBoundingClientRect().width)),
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

test('real API-authenticated workspace shell renders Task 4 review captures', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  const onboarding = await page.request.post(
    stack.apiUrl + '/api/identity/onboarding/complete',
    { headers, data: {} },
  );
  expect(onboarding.status()).toBe(204);

  const reviewDirectory = resolve('.cache/f21-task4-shell');
  await mkdir(reviewDirectory, { recursive: true });
  const capture = async (name: string) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    await page.screenshot({
      path: resolve(reviewDirectory, name + '.png'),
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(stack.frontendUrl + '/settings/profile');
  await expect(page.locator('main')).toHaveCount(1);
  await expect(
    page.getByRole('complementary', { name: 'Workspace navigation' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Profile', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await capture('sidebar-desktop-expanded-light');

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible();
  await capture('sidebar-desktop-collapsed-light');
  await page.getByRole('button', { name: 'Organization: Personal' }).click();
  await expect(
    page.getByRole('button', { name: 'Create a team' }),
  ).toBeVisible();
  await capture('sidebar-desktop-organization-menu-light');
  await page.keyboard.press('Escape');
  await page
    .locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]')
    .click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await capture('sidebar-desktop-user-menu-light');
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(
    page.getByRole('button', { name: 'Collapse sidebar' }),
  ).toBeVisible();
  await capture('sidebar-desktop-expanded-dark');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.goto(stack.frontendUrl + '/settings/profile');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
  await capture('sidebar-mobile-expanded-light');
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
  await capture('sidebar-mobile-expanded-dark');

  const teamResponse = await page.request.post(
    stack.apiUrl + '/api/organizations',
    {
      headers,
      data: {
        name: 'Task 4 panel review team',
        slug: 'f21-task4-' + randomUUID().slice(0, 8),
      },
    },
  );
  expect(teamResponse.status()).toBe(201);
  const { id } = (await teamResponse.json()) as { id: string };
  const selected = await page.request.post(
    stack.apiUrl + '/api/organizations/active',
    { headers, data: { organizationId: id } },
  );
  expect(selected.status()).toBe(200);
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.setViewportSize({ width: 768, height: 720 });
  await page.goto(`${stack.frontendUrl}/organizations/${id}/settings/general`);
  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar' });
  if (await expandSidebar.isVisible()) await expandSidebar.click();
  await expect(
    page.getByRole('button', { name: 'Collapse sidebar' }),
  ).toBeVisible();
  await expect(page.locator('h1')).toHaveText('Organization settings');
  await page.locator('[data-panel-host]').evaluate((host) => {
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', 'Details');
    panel.className =
      'flex min-h-0 w-[var(--right-panel-width)] shrink-0 flex-col border-l border-border bg-surface';
    panel.style.width = 'var(--right-panel-width)';
    panel.innerHTML =
      '<header class="flex min-h-14 items-center px-4"><h2>Details</h2></header><div class="p-4">Panel host preview</div>';
    host.append(panel);
  });
  await capture('sidebar-desktop-panel-host-light');
});
