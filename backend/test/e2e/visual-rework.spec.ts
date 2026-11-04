import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { totpForUri } from '../setup/totp.js';
import {
  captureShellReviewView,
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
  await page.goto(stack.frontendUrl + '/workspace');
  await expect(page.locator('main')).toHaveCount(1);
  await expect(
    page.getByRole('complementary', { name: 'Workspace navigation' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', {
        name: 'Settings',
      }),
  ).toHaveCount(0);
  await capture('sidebar-desktop-expanded-light');

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible();
  await capture('sidebar-desktop-collapsed-light');
  await page.getByRole('button', { name: 'Organization: Personal' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Create a team' }),
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
  await page.goto(stack.frontendUrl + '/workspace');
  const mobileBreadcrumb = page.getByRole('navigation', {
    name: 'breadcrumb',
  });
  await expect(
    mobileBreadcrumb.getByRole('link', { name: 'Settings', exact: true }),
  ).toBeHidden();
  await expect(
    mobileBreadcrumb.getByRole('link', { name: 'Profile', exact: true }),
  ).toBeVisible();
  await expect(
    mobileBreadcrumb.locator('[data-slot="breadcrumb-separator"]'),
  ).toBeHidden();
  await capture('sidebar-mobile-closed-light');
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
  await page.goto(`${stack.frontendUrl}/workspace?settings=general`);
  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar' });
  if (await expandSidebar.isVisible()) await expandSidebar.click();
  await expect(
    page.getByRole('button', { name: 'Collapse sidebar' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Organization settings' }),
  ).toBeVisible();
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

test('Task 7A Settings captures all Account sections, saved feedback, and narrow layouts', async ({
  page,
}) => {
  const stack = descriptor();
  const password = 'Task-7A-Synthetic-42!';
  const headers = await authenticateApi(page.request, {
    name: 'Task 7A Preview',
    password,
  });
  const onboarding = await page.request.post(
    stack.apiUrl + '/api/identity/onboarding/complete',
    { headers, data: {} },
  );
  expect(onboarding.status()).toBe(204);
  const directory = resolve('.cache/f21-task7A');
  await mkdir(directory, { recursive: true });
  const capture = async (name: string) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    await page.screenshot({
      path: resolve(directory, name + '.png'),
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
  };
  const sections = ['profile', 'appearance', 'security'] as const;
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(stack.frontendUrl + '/workspace');
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    for (const section of sections) {
      await page.goto(stack.frontendUrl + '/workspace?settings=' + section);
      await expect(
        page.getByRole('dialog', { name: 'Settings' }),
      ).toBeVisible();
      await expectAccountSectionReady(page, section);
      if (section === 'appearance') {
        await expectAppearanceGeometry(page, 1440);
      }
      await expect(page.locator('main')).toHaveCount(1);
      const navBox = await page
        .getByRole('navigation', { name: 'Settings sections' })
        .boundingBox();
      const asideBox = await page
        .getByRole('dialog', { name: 'Settings' })
        .locator('aside')
        .boundingBox();
      expect(navBox).not.toBeNull();
      expect(asideBox).not.toBeNull();
      expect(navBox!.height).toBeGreaterThanOrEqual(asideBox!.height - 1);
      expect(
        await page
          .getByRole('navigation', { name: 'Settings sections' })
          .locator('[data-slot="sidebar"]')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      ).not.toBe('rgba(0, 0, 0, 0)');
      await capture('01-settings-' + section + '-' + theme + '-desktop');
      if (section === 'profile') {
        await page.getByLabel('Display name').fill('Task 7A saved profile');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(
          page
            .getByRole('region', { name: 'Notifications alt+T' })
            .getByText('Changes saved.', { exact: true }),
        ).toBeVisible();
        await expect(page.getByLabel('Display name')).toHaveValue(
          'Task 7A saved profile',
        );
        await capture('02-settings-saved-toast-' + theme + '-desktop');
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(stack.frontendUrl + '/workspace');
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  for (const section of sections) {
    await page.goto(stack.frontendUrl + '/workspace?settings=' + section);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expectAccountSectionReady(page, section);
    if (section === 'appearance') {
      await expectAppearanceGeometry(page, 390);
    }
    await expect(
      page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', {
          name: {
            profile: 'Profile',
            appearance: 'Appearance',
            security: 'Security',
          }[section],
        }),
    ).toBeVisible();
    await capture('03-settings-' + section + '-light-390');
  }
  await page.setViewportSize({ width: 768, height: 900 });
  for (const section of sections) {
    await page.goto(stack.frontendUrl + '/workspace?settings=' + section);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expectAccountSectionReady(page, section);
    if (section === 'appearance') {
      await expectAppearanceGeometry(page, 768);
    }
    const navBox = await page
      .getByRole('navigation', { name: 'Settings sections' })
      .boundingBox();
    const asideBox = await page
      .getByRole('dialog', { name: 'Settings' })
      .locator('aside')
      .boundingBox();
    expect(navBox).not.toBeNull();
    expect(asideBox).not.toBeNull();
    expect(navBox!.height).toBeGreaterThanOrEqual(asideBox!.height - 1);
    expect(
      await page
        .getByRole('navigation', { name: 'Settings sections' })
        .locator('[data-slot="sidebar"]')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe('rgba(0, 0, 0, 0)');
    await capture('04-settings-' + section + '-light-768');
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(stack.frontendUrl + '/workspace');
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.goto(stack.frontendUrl + '/workspace?settings=security');
  const setup = page.getByRole('button', {
    name: 'Set up authenticator',
    exact: true,
  });
  try {
    await expect(setup).toBeVisible();
  } catch {
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const buttons = await dialog.getByRole('button').allTextContents();
    const headings = await dialog.locator('h1,h2,h3').allTextContents();
    const status = await dialog
      .locator('[role="status"], [role="alert"]')
      .allTextContents();
    throw new Error(JSON.stringify({ buttons, headings, status }));
  }
  await setup.click();
  await page.getByLabel('Enrollment password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Set up authenticator', exact: true })
    .click();
  const uri = await page.getByTestId('authenticator-uri').textContent();
  expect(uri).toBeTruthy();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totpForUri(uri!));
  await page
    .getByRole('button', { name: 'Verify authenticator', exact: true })
    .click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  await page
    .getByRole('button', { name: 'I saved my recovery codes', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Back to security', exact: true })
    .click();
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') {
      await page.evaluate(() => localStorage.setItem('theme', 'dark'));
      await page.reload();
      await page.goto(stack.frontendUrl + '/workspace?settings=security');
    }
    await expect(page.getByText('On', { exact: true })).toBeVisible();
    await expect(page.getByText(/recovery codes left/)).toBeVisible();
    await expect(page.getByText('Browser', { exact: true })).toBeVisible();
    await expect(page.getByTestId('recovery-codes')).toHaveCount(0);
    await capture('05-settings-security-2fa-enabled-' + theme + '-desktop');
  }
});

async function expectAccountSectionReady(
  page: import('@playwright/test').Page,
  section: 'profile' | 'appearance' | 'security',
) {
  if (section === 'profile') {
    await expect(page.getByLabel('Display name')).toBeVisible();
    await expect(page.getByText('Email', { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'profile settings' })
        .getByText('Personal', { exact: true }),
    ).toBeVisible();
  } else if (section === 'appearance') {
    await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'System' })).toBeVisible();
  } else {
    await expect(
      page.getByRole('heading', { name: 'Where you are signed in' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Set up authenticator' }),
    ).toBeVisible();
    await expect(
      page.getByRole('status', { name: 'Loading sessions' }),
    ).toHaveCount(0);
  }
}

async function expectAppearanceGeometry(
  page: import('@playwright/test').Page,
  viewportWidth: number,
) {
  const metrics = await page.getByRole('radiogroup').evaluate((group) => {
    const rects = Array.from(
      group.querySelectorAll<HTMLElement>('[data-slot="appearance-option"]'),
    ).map((option) => option.getBoundingClientRect());
    const bounds = group.getBoundingClientRect();
    const styles = getComputedStyle(group);
    return {
      count: rects.length,
      widths: rects.map((rect) => rect.width),
      tops: rects.map((rect) => rect.top),
      gaps: rects
        .slice(1)
        .map((rect, index) => rect.left - rects[index]!.right),
      width: bounds.width,
      scrollWidth: group.scrollWidth,
      clientWidth: group.clientWidth,
      columnGap: Number.parseFloat(styles.columnGap),
    };
  });

  expect(metrics.count).toBe(3);
  expect(metrics.width).toBeLessThanOrEqual(572);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  if (viewportWidth >= 768) {
    expect(metrics.columnGap).toBe(16);
    expect(metrics.tops[0]).toBeCloseTo(metrics.tops[1]!, 0);
    expect(metrics.tops[1]).toBeCloseTo(metrics.tops[2]!, 0);
    expect(metrics.gaps[0]).toBeCloseTo(16, 0);
    expect(metrics.gaps[1]).toBeCloseTo(16, 0);
    expect(Math.max(...metrics.widths)).toBeLessThanOrEqual(181);
    expect(Math.min(...metrics.widths)).toBeGreaterThanOrEqual(
      viewportWidth === 1440 ? 170 : 100,
    );
  } else {
    expect(metrics.tops[0]).toBeLessThan(metrics.tops[1]!);
    expect(metrics.tops[1]).toBeLessThan(metrics.tops[2]!);
  }
}

test('real API-authenticated Home captures Task 6A shell states', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Checkpoint Preview',
    email: 'checkpoint-b@example.test',
  });
  const onboarding = await page.request.post(
    stack.apiUrl + '/api/identity/onboarding/complete',
    { headers, data: {} },
  );
  expect(onboarding.status()).toBe(204);

  const teamResponse = await page.request.post(
    stack.apiUrl + '/api/organizations',
    {
      headers,
      data: {
        name: 'Task 6A Team',
        slug: 'task-6a-' + randomUUID().slice(0, 8),
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

  const response = await page.goto(stack.frontendUrl + '/workspace');
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Welcome, Checkpoint Preview' }),
  ).toBeAttached();
  for (const view of [
    'home',
    'sidebar-expanded',
    'organization-switcher-open',
    'user-menu-open',
  ] as const) {
    for (const viewport of ['desktop', 'mobile'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await captureShellReviewView(page, view, theme, viewport);
      }
    }
  }
  for (const theme of ['light', 'dark'] as const) {
    await captureShellReviewView(page, 'sidebar-collapsed', theme, 'desktop');
  }
});

test('inert Home composer controls render the published disabled opacity while remaining focusable', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  const onboarding = await page.request.post(
    stack.apiUrl + '/api/identity/onboarding/complete',
    { headers, data: {} },
  );
  expect(onboarding.status()).toBe(204);
  await page.goto(stack.frontendUrl + '/workspace');
  for (const selector of [
    '.aui-composer-add-attachment',
    '.aui-composer-send',
  ]) {
    const control = page.locator(selector);
    await expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(
      await control.evaluate((node) => getComputedStyle(node).opacity),
    ).toBe('0.5');
    expect(
      await control.evaluate((node) => (node as HTMLElement).tabIndex),
    ).toBeGreaterThanOrEqual(0);
    expect(
      await control.evaluate((node) => getComputedStyle(node).display),
    ).not.toBe('none');
  }
});

test('Task 6B auth state captures cover sign-in and secondary flows', async ({
  page,
}) => {
  const reviewDirectory = resolve('.cache/f21-task6B');
  await mkdir(reviewDirectory, { recursive: true });
  const base = descriptor().frontendUrl;
  const viewports = {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
  } as const;
  const capture = async (
    state: string,
    theme: 'light' | 'dark',
    viewport: keyof typeof viewports,
  ) => {
    await page.setViewportSize(viewports[viewport]);
    await page.evaluate((value) => {
      document.documentElement.classList.toggle('dark', value === 'dark');
    }, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    const suffix = viewport === 'mobile' ? '-mobile' : '';
    await page.screenshot({
      path: resolve(reviewDirectory, `${state}-${theme}${suffix}.png`),
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
  };

  await page.setViewportSize(viewports.desktop);
  await page.goto(base + '/sign-in');
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Sign in to Lexon' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show password' }).click();
  await page.getByRole('button', { name: 'Hide password' }).click();
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of ['desktop', 'mobile'] as const) {
      await capture('01-sign-in-default', theme, viewport);
    }
  }

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of ['desktop', 'mobile'] as const) {
      await capture('03-sign-in-field-errors', theme, viewport);
    }
  }

  await page
    .getByLabel('Email', { exact: true })
    .fill('synthetic-review@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Synthetic-review-password-42!');
  await page.getByRole('button', { name: 'Show password' }).click();
  let releaseSignIn!: () => void;
  let markSignInStarted!: () => void;
  const signInStarted = new Promise<void>((resolveStarted) => {
    markSignInStarted = resolveStarted;
  });
  const signInGate = new Promise<void>((resolveGate) => {
    releaseSignIn = resolveGate;
  });
  await page.route('**/api/auth/sign-in/email', async (route) => {
    markSignInStarted();
    await signInGate;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Synthetic private server detail',
        },
      }),
    });
  });
  try {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await signInStarted;
    await expect(
      page.getByRole('button', { name: 'Signing in…' }),
    ).toBeDisabled();
    for (const theme of ['light', 'dark'] as const) {
      for (const viewport of ['desktop', 'mobile'] as const) {
        await capture('04-sign-in-password-shown-pending', theme, viewport);
      }
    }
    releaseSignIn();
    await expect(page.locator('[data-slot="alert"]')).toContainText(
      'Email or password is incorrect. Check them and try again.',
    );
    await expect(page.locator('body')).not.toContainText(
      'Synthetic private server detail',
    );
    await page.getByRole('button', { name: 'Hide password' }).click();
    for (const theme of ['light', 'dark'] as const) {
      for (const viewport of ['desktop', 'mobile'] as const) {
        await capture('05-sign-in-form-error', theme, viewport);
      }
    }
  } finally {
    releaseSignIn();
    await page.unroute('**/api/auth/sign-in/email');
  }

  await page.goto(base + '/sign-up');
  await expect(
    page.getByRole('heading', { name: 'Create your account' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show password' }).click();
  await page.getByRole('button', { name: 'Hide password' }).click();
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of ['desktop', 'mobile'] as const) {
      await capture('06-sign-up-default', theme, viewport);
    }
  }

  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Task 6B onboarding preview',
  });
  const profile = await page.request.patch(
    stack.apiUrl + '/api/identity/profile',
    {
      headers,
      data: { name: 'Task 6B onboarding preview' },
    },
  );
  expect(profile.status()).toBe(200);
  await page.goto(base + '/onboarding');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Lexon' }),
  ).toBeVisible();
  const displayName = page.getByLabel('Display name', { exact: true });
  await displayName.fill('');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(displayName).toHaveAttribute('aria-invalid', 'true');
  await displayName.fill('Task 6B onboarding preview');
  await expect(displayName).not.toHaveAttribute('aria-invalid', 'true');
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of ['desktop', 'mobile'] as const) {
      await capture('07-onboarding-profile', theme, viewport);
    }
  }
});
