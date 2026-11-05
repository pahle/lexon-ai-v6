import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { totpForUri } from '../setup/totp.js';
import {
  captureCheckpointCView,
  captureTask9ReviewView,
  installTask9SessionExpiryNormalization,
  installTask9InvitationExpiryNormalization,
  installTask9MemberOrderNormalization,
  captureShellReviewView,
  captureTask7BViewportReview,
  captureVisualView,
  type VisualTheme,
  type VisualViewport,
} from './visual-support.js';

async function captureTask9Variants(
  page: import('@playwright/test').Page,
  view: string,
  expectedText: string,
  loadedContent?: import('@playwright/test').Locator,
) {
  for (const viewport of ['desktop', 'mobile'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await captureTask9ReviewView(
        page,
        view,
        theme,
        viewport,
        expectedText,
        loadedContent ? { loadedContent } : {},
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

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
      await captureTask9ReviewView(
        page,
        'sign-in',
        theme,
        viewport,
        'Sign in to Lexon',
      );
    }
  }
  await page.goto(base + '/sign-up');
  for (const viewport of viewportPairs) {
    for (const theme of themes) {
      await captureVisualView(page, 'sign-up', theme, viewport);
      await captureTask9ReviewView(
        page,
        'sign-up',
        theme,
        viewport,
        'Create your account',
      );
    }
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
    for (const theme of ['light', 'dark'] as const) {
      await captureVisualView(page, 'onboarding', theme, viewport);
      await captureTask9ReviewView(
        page,
        'onboarding',
        theme,
        viewport,
        'Welcome to Lexon',
      );
    }
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

test('font and image assets load from the application origin with Inter available', async ({
  page,
}) => {
  const frontendUrl = descriptor().frontendUrl;
  const origin = new URL(frontendUrl).origin;
  const externalAssets: string[] = [];
  page.on('request', (request) => {
    if (
      (request.resourceType() === 'font' ||
        request.resourceType() === 'image') &&
      new URL(request.url()).origin !== origin
    ) {
      externalAssets.push(request.url());
    }
  });

  await page.goto(frontendUrl + '/sign-in');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('img[alt="Lexon"]:visible')).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      Array.from(document.fonts).some(
        (font) => font.family.includes('Inter') && font.status === 'loaded',
      ),
    ),
  ).toBe(true);
  expect(externalAssets).toEqual([]);
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
    if (route.name === 'forgot-password' || route.name === 'two-factor') {
      const expected = await page.locator('h1').innerText();
      await captureTask9Variants(page, route.name, expected);
    }
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
  await expect(mobileBreadcrumb).toContainText('Home');
  await expect(
    mobileBreadcrumb.getByRole('link', { name: 'Settings', exact: true }),
  ).toHaveCount(0);
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
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Settings sections' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'General', exact: true }),
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

test('Task 7B member role Select is a nested Settings layer and Escape restores its trigger', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  await page.setViewportSize({ width: 390, height: 844 });
  const password = 'Task-7B-Select-42!';
  const headers = await authenticateApi(page.request, {
    name: 'Task 7B Owner',
    password,
  });
  expect(
    (
      await page.request.post(
        stack.apiUrl + '/api/identity/onboarding/complete',
        { headers, data: {} },
      )
    ).status(),
  ).toBe(204);
  const created = await page.request.post(stack.apiUrl + '/api/organizations', {
    headers,
    data: { name: 'Task 7B Team', slug: 'task-7b-' + randomUUID().slice(0, 8) },
  });
  expect(created.status()).toBe(201);
  const organization = (await created.json()) as { id: string };
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/organizations/active', {
        headers,
        data: { organizationId: organization.id },
      })
    ).status(),
  ).toBe(200);

  const memberEmail = `alex.${randomUUID()}@example.test`;
  const invitationResponse = await page.request.post(
    stack.apiUrl + `/api/organizations/${organization.id}/invitations`,
    {
      headers,
      data: { email: memberEmail, role: 'member' },
    },
  );
  expect(invitationResponse.status()).toBe(201);
  const invitation = (await invitationResponse.json()) as { id: string };
  const memberRequest = await playwright.request.newContext();
  try {
    const memberHeaders = await authenticateApi(memberRequest, {
      name: 'Alex Rivera',
      email: memberEmail,
    });
    expect(
      (
        await memberRequest.post(
          stack.apiUrl + `/api/invitations/${invitation.id}/accept`,
          { headers: memberHeaders, data: {} },
        )
      ).status(),
    ).toBe(200);
  } finally {
    await memberRequest.dispose();
  }

  await page.goto(stack.frontendUrl + '/workspace?settings=members');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  const membersTable = settings.getByRole('table');
  await membersTable.scrollIntoViewIfNeeded();
  const tableViewport = membersTable.locator('xpath=..');
  const tableMetrics = await tableViewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(tableMetrics.scrollWidth).toBeGreaterThan(tableMetrics.clientWidth);
  await tableViewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const role = settings.getByRole('combobox', {
    name: 'Role for Alex Rivera',
  });
  const ownerRow = settings.getByRole('row').filter({ hasText: 'Alex Rivera' });
  await expect(role).toBeInViewport();
  await expect(
    ownerRow.getByRole('button', { name: 'Remove', exact: true }),
  ).toBeInViewport();
  expect(
    await page.locator('html').evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await role.focus();
  await role.press('Enter');
  await expect(
    page.getByRole('option', { name: 'Admin', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('option', { name: 'Admin', exact: true }),
  ).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect(role).toBeFocused();
  const remove = ownerRow.getByRole('button', {
    name: 'Remove',
    exact: true,
  });
  await expect(remove).toHaveClass(/text-destructive/);
  await remove.click();
  const confirmation = page.getByRole('alertdialog', {
    name: 'Remove Alex Rivera from Task 7B Team?',
  });
  await expect(confirmation).toBeVisible();
  const confirmRemove = confirmation.getByRole('button', {
    name: 'Remove member',
    exact: true,
  });
  await expect(confirmRemove).toBeVisible();
  await expect(confirmRemove).toBeEnabled();
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(remove).toBeFocused();
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

test('Task 7B Checkpoint C captures the indexed organization and settings states', async ({
  page,
  playwright,
}) => {
  test.setTimeout(120000);
  const stack = descriptor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(stack.frontendUrl + '/sign-in');
  await expect(
    page.getByRole('heading', { name: 'Sign in to Lexon' }),
  ).toBeVisible();
  const signInButton = page.locator('form button[type="submit"]');
  const idleButtonWidth = await signInButton.evaluate(
    (button) => button.getBoundingClientRect().width,
  );
  const labelCenterOffset = () =>
    signInButton.evaluate((button) => {
      const label = button.querySelector<HTMLElement>(
        ':scope > span > span:last-child',
      );
      if (!label) throw new Error('Sign-in button label was not rendered.');
      const buttonRect = button.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      return Math.abs(
        (buttonRect.left + buttonRect.right) / 2 -
          (labelRect.left + labelRect.right) / 2,
      );
    });
  expect(await labelCenterOffset()).toBeLessThanOrEqual(1);
  for (const theme of ['light', 'dark'] as const)
    await captureCheckpointCView(page, 'sign-in', theme);
  await captureTask9Variants(page, 'sign-in', 'Sign in to Lexon');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  for (const theme of ['light', 'dark'] as const)
    await captureCheckpointCView(page, 'sign-in-field-errors', theme);
  await captureTask9Variants(page, 'sign-in-field-errors', 'Sign in to Lexon');

  await page
    .getByLabel('Email', { exact: true })
    .fill('maya.chen@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Synthetic-review-password-42!');
  await page.getByRole('button', { name: 'Show password' }).click();
  let releaseRequest!: () => void;
  let startedRequest!: () => void;
  const requestStarted = new Promise<void>((resolveStarted) => {
    startedRequest = resolveStarted;
  });
  const requestGate = new Promise<void>((resolveGate) => {
    releaseRequest = resolveGate;
  });
  await page.route('**/api/auth/sign-in/email', async (route) => {
    startedRequest();
    await requestGate;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'AUTH_REQUIRED', message: 'Synthetic private detail' },
      }),
    });
  });
  try {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await requestStarted;
    await expect(
      page.getByRole('button', { name: 'Signing in…' }),
    ).toBeDisabled();
    expect(
      await signInButton.evaluate(
        (button) => button.getBoundingClientRect().width,
      ),
    ).toBe(idleButtonWidth);
    expect(await labelCenterOffset()).toBeLessThanOrEqual(1);
    for (const theme of ['light', 'dark'] as const)
      await captureCheckpointCView(
        page,
        'sign-in-password-shown-loading',
        theme,
      );
    await captureTask9Variants(
      page,
      'sign-in-password-shown-loading',
      'Sign in to Lexon',
    );
    releaseRequest();
    await expect(page.locator('[data-slot="alert"]')).toContainText(
      'Email or password is incorrect. Check them and try again.',
    );
    await expect(page.locator('body')).not.toContainText(
      'Synthetic private detail',
    );
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'type',
      'text',
    );
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    for (const theme of ['light', 'dark'] as const)
      await captureCheckpointCView(page, 'sign-in-form-error', theme);
    await captureTask9Variants(page, 'sign-in-form-error', 'Sign in to Lexon');
  } finally {
    releaseRequest();
    await page.unroute('**/api/auth/sign-in/email');
  }

  const headers = await authenticateApi(page.request, {
    name: 'Maya Chen',
    email: 'maya.chen@example.test',
    password: 'Maya-review-password-42!',
  });
  const onboarding = await page.request.post(
    stack.apiUrl + '/api/identity/onboarding/complete',
    {
      headers,
      data: {},
    },
  );
  expect(onboarding.status()).toBe(204);
  const teamResponse = await page.request.post(
    stack.apiUrl + '/api/organizations',
    {
      headers,
      data: {
        name: 'Harbor Legal',
        slug: 'harbor-legal-review',
      },
    },
  );
  expect(teamResponse.status()).toBe(201);
  const team = (await teamResponse.json()) as { id: string };
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/organizations/active', {
        headers,
        data: { organizationId: team.id },
      })
    ).status(),
  ).toBe(200);
  for (const invitee of [
    { name: 'Alex Rivera', email: 'alex.rivera@example.test', role: 'member' },
    { name: 'Jordan Lee', email: 'jordan.lee@example.test', role: 'admin' },
  ] as const) {
    const invitation = await page.request.post(
      stack.apiUrl + `/api/organizations/${team.id}/invitations`,
      {
        headers,
        data: { email: invitee.email, role: invitee.role },
      },
    );
    expect(invitation.status()).toBe(201);
    const { id } = (await invitation.json()) as { id: string };
    const recipient = await playwright.request.newContext();
    try {
      const recipientHeaders = await authenticateApi(recipient, {
        name: invitee.name,
        email: invitee.email,
      });
      expect(
        (
          await recipient.post(stack.apiUrl + `/api/invitations/${id}/accept`, {
            headers: recipientHeaders,
            data: {},
          })
        ).status(),
      ).toBe(200);
    } finally {
      await recipient.dispose();
    }
  }
  const pending = await page.request.post(
    stack.apiUrl + `/api/organizations/${team.id}/invitations`,
    {
      headers,
      data: { email: 'sam.taylor@example.test', role: 'member' },
    },
  );
  expect(pending.status()).toBe(201);

  await page.goto(stack.frontendUrl + '/workspace?settings=security');
  await page
    .getByRole('button', { name: 'Set up authenticator', exact: true })
    .click();
  await page
    .getByLabel('Enrollment password', { exact: true })
    .fill('Maya-review-password-42!');
  await page
    .getByRole('button', { name: 'Set up authenticator', exact: true })
    .click();
  const authenticatorUri = await page
    .getByTestId('authenticator-uri')
    .textContent();
  expect(authenticatorUri).toBeTruthy();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totpForUri(authenticatorUri!));
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
  await expect(
    page.getByRole('heading', { name: 'Two-factor authentication' }),
  ).toBeVisible();
  const secondOwnerContext = await page.context().browser()!.newContext();
  try {
    const secondOwnerPage = await secondOwnerContext.newPage();
    await secondOwnerPage.goto(stack.frontendUrl + '/sign-in');
    await secondOwnerPage
      .getByLabel('Email', { exact: true })
      .fill('maya.chen@example.test');
    await secondOwnerPage
      .getByLabel('Password', { exact: true })
      .fill('Maya-review-password-42!');
    await secondOwnerPage
      .getByRole('button', { name: 'Sign in', exact: true })
      .click();
    await expect(secondOwnerPage).toHaveURL(/two-factor/);
    await secondOwnerPage
      .getByLabel('Authenticator code', { exact: true })
      .fill(totpForUri(authenticatorUri!));
    await secondOwnerPage
      .getByRole('button', { name: 'Verify authenticator', exact: true })
      .click();
    await expect(secondOwnerPage).toHaveURL(/workspace/);
    await expect(
      secondOwnerPage.getByRole('heading', { name: 'Home' }),
    ).toBeVisible();
    expect(
      await secondOwnerPage.evaluate(
        async () => (await fetch('/api/identity')).status,
      ),
    ).toBe(200);
  } finally {
    await secondOwnerContext.close();
  }
  await page.goto(stack.frontendUrl + '/workspace?settings=security');
  await expect(
    page.getByRole('heading', { name: 'Two-factor authentication' }),
  ).toBeVisible();
  const sessionsTable = page.getByRole('table', { name: 'Signed-in sessions' });
  await expect(sessionsTable).toBeVisible();
  await expect(sessionsTable.getByRole('row')).toHaveCount(3);
  await expect(
    sessionsTable.getByRole('button', { name: /Revoke browser session/ }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Sign out other sessions', exact: true }),
  ).toBeVisible();
  const authenticatedIdentity = await page.evaluate(async () => {
    const response = await fetch('/api/identity');
    return { status: response.status, body: await response.json() };
  });
  expect(authenticatedIdentity.status).toBe(200);
  const activeTeam = await page.evaluate(async (organizationId) => {
    const response = await fetch('/api/organizations/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
    return response.status;
  }, team.id);
  expect(activeTeam).toBe(200);
  const requireTwoFactor = await page.evaluate(async (organizationId) => {
    const response = await fetch(
      `/api/organizations/${organizationId}/settings`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ require2fa: true }),
      },
    );
    return response.status;
  }, team.id);
  expect(requireTwoFactor).toBe(200);

  await page.goto(stack.frontendUrl + '/workspace');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  for (const theme of ['light', 'dark'] as const)
    await captureCheckpointCView(page, 'home', theme);
  await captureTask9Variants(page, 'home', 'Home');
  for (const viewport of ['desktop', 'mobile'] as const) {
    if (viewport === 'mobile') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
    } else await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ['light', 'dark'] as const)
      await captureTask9ReviewView(
        page,
        'sidebar-header-expanded',
        theme,
        viewport,
        'Home',
      );
    if (viewport === 'mobile') await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  for (const theme of ['light', 'dark'] as const)
    await captureTask9ReviewView(
      page,
      'sidebar-header-collapsed-desktop',
      theme,
      'desktop',
      'Home',
    );
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible();
  for (const theme of ['light', 'dark'] as const)
    await captureCheckpointCView(page, 'sidebar-collapsed', theme);
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(
    page.getByRole('button', { name: 'Collapse sidebar' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Organization: Harbor Legal/ })
    .click();
  await expect(page.getByTestId('organization-popup')).toBeVisible();
  const selectedOrganization = page.getByRole('menuitem', {
    name: /Harbor Legal/,
  });
  await expect(selectedOrganization).toHaveAttribute('aria-current', 'true');
  await expect(selectedOrganization).not.toHaveAttribute('data-disabled');
  await expect(selectedOrganization).toHaveCSS('opacity', '1');
  let selectedOrganizationSwitches = 0;
  const countSelectedSwitch = (request: import('@playwright/test').Request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/api/organizations/active')
    )
      selectedOrganizationSwitches++;
  };
  page.on('request', countSelectedSwitch);
  await selectedOrganization.click();
  await expect(page.getByTestId('organization-popup')).toBeVisible();
  expect(selectedOrganizationSwitches).toBe(0);
  page.off('request', countSelectedSwitch);
  for (const theme of ['light', 'dark'] as const)
    await captureCheckpointCView(page, 'organization-switcher-open', theme);
  await captureTask9Variants(
    page,
    'organization-switcher-open',
    'Harbor Legal',
  );
  await page.keyboard.press('Escape');
  await page
    .locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]')
    .click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  // The indexed User menu state includes Platform navigation and is captured
  // only by the real operator/MFA flow in platform-identity.spec.ts.
  await page.keyboard.press('Escape');

  const sections = [
    'profile',
    'appearance',
    'security',
    'members',
    'invitations',
    'general',
  ] as const;
  for (const section of sections) {
    const invitationCapture =
      section === 'invitations'
        ? await installTask9InvitationExpiryNormalization(page, team.id)
        : undefined;
    const memberCapture =
      section === 'members'
        ? await installTask9MemberOrderNormalization(page, team.id)
        : undefined;
    let releaseSessions!: () => void;
    let sessionRequestStarted!: () => void;
    let sessionCapture:
      | Awaited<ReturnType<typeof installTask9SessionExpiryNormalization>>
      | undefined;
    if (section === 'security') {
      const heldSessionResponse = new Promise<void>((resolve) => {
        releaseSessions = resolve;
      });
      const sessionRequest = new Promise<void>((resolve) => {
        sessionRequestStarted = resolve;
      });
      sessionCapture = await installTask9SessionExpiryNormalization(page, {
        hold: heldSessionResponse,
        onRequest: sessionRequestStarted,
      });
      const securityCapturePath = resolve(
        'docs/references/F2.1-visual/review/security-desktop-light.png',
      );
      const securityBaselinePath = resolve(
        'docs/references/F2.1-visual/baseline/security-desktop-light.png',
      );
      const approvedSecurityReview = existsSync(securityCapturePath)
        ? readFileSync(securityCapturePath)
        : undefined;
      const securityBaselineBefore = existsSync(securityBaselinePath)
        ? readFileSync(securityBaselinePath)
        : undefined;
      expect(approvedSecurityReview).toBeDefined();
      try {
        await page.goto(`${stack.frontendUrl}/workspace?settings=${section}`);
        await sessionRequest;
        await expect(
          page.getByRole('status', { name: 'Loading sessions' }),
        ).toBeVisible();
        const sessionsTable = page.getByRole('table', {
          name: 'Signed-in sessions',
        });
        const incompleteCapture = captureTask9ReviewView(
          page,
          'security',
          'light',
          'desktop',
          'Settings',
          {
            loadedContent: sessionsTable,
            loadedContentTimeoutMs: 250,
          },
        );
        await expect(incompleteCapture).rejects.toThrow();
        expect(existsSync(securityCapturePath)).toBe(true);
        expect(readFileSync(securityCapturePath)).toEqual(
          approvedSecurityReview,
        );
        expect(existsSync(securityBaselinePath)).toBe(
          securityBaselineBefore !== undefined,
        );
        if (securityBaselineBefore) {
          expect(readFileSync(securityBaselinePath)).toEqual(
            securityBaselineBefore,
          );
        }
        releaseSessions();
        await captureTask9ReviewView(
          page,
          'security',
          'light',
          'desktop',
          'Settings',
          {
            loadedContent: sessionsTable,
          },
        );
        await sessionCapture.drain();
      } finally {
        releaseSessions();
        await sessionCapture.drain().catch(() => undefined);
        await sessionCapture.remove();
      }
    } else {
      await page.goto(`${stack.frontendUrl}/workspace?settings=${section}`);
    }
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    if (section === 'profile')
      await expect(
        page.getByLabel('Display name', { exact: true }),
      ).toHaveValue('Maya Chen');
    if (section === 'appearance')
      await expect(
        page.getByRole('radio', { name: 'Light', exact: true }),
      ).toBeVisible();
    if (section === 'security')
      await expect(
        page.getByRole('heading', { name: 'Two-factor authentication' }),
      ).toBeVisible();
    if (section === 'members') {
      const membersTable = page.getByRole('table');
      await expect(membersTable).toBeVisible();
      const currentMember = membersTable.getByRole('row').nth(1);
      await expect(currentMember).toContainText('Maya Chen (you)');
      await expect(currentMember.getByRole('combobox')).toHaveCount(0);
      await expect(
        currentMember.getByRole('button', { name: 'Remove', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText('Alex Rivera', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Jordan Lee', { exact: true })).toBeVisible();
    }
    if (section === 'invitations') {
      await expect(page.getByRole('table')).toBeVisible();
      await expect(
        page.getByText('sam.taylor@example.test', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Cancel', exact: true }),
      ).toHaveClass(/text-destructive/);
    }
    if (section === 'general') {
      await expect(
        page.getByLabel('Organization name', { exact: true }),
      ).toHaveValue('Harbor Legal');
      await expect(
        page.getByRole('switch', { name: 'Require two-factor authentication' }),
      ).toBeChecked();
    }
    for (const theme of ['light', 'dark'] as const) {
      if (section === 'security') {
        const sessionsTable = page.getByRole('table', {
          name: 'Signed-in sessions',
        });
        await expect(sessionsTable).toBeVisible();
        await expect(sessionsTable.getByRole('row')).toHaveCount(3);
        await expect(
          sessionsTable.getByRole('button', {
            name: /Revoke browser session/,
          }),
        ).toHaveCount(1);
        await expect(
          page.getByRole('button', {
            name: 'Sign out other sessions',
            exact: true,
          }),
        ).toBeVisible();
      }
      await captureCheckpointCView(page, section, theme);
      await captureTask9Variants(
        page,
        section,
        'Settings',
        section === 'security'
          ? page.getByRole('table', { name: 'Signed-in sessions' })
          : undefined,
      );
    }
    if (
      section === 'members' ||
      section === 'invitations' ||
      section === 'general'
    ) {
      for (const width of [390, 768] as const) {
        for (const theme of ['light', 'dark'] as const) {
          await captureTask7BViewportReview(
            page,
            `${section}-populated`,
            width,
            theme,
          );
          if (width === 390 && section !== 'general') {
            await page.setViewportSize({ width: 390, height: 844 });
            const settings = page.getByRole('region', {
              name: `${section} settings`,
            });
            const table = settings.getByRole('table');
            await table.scrollIntoViewIfNeeded();
            const horizontalScroll = table.locator('xpath=..');
            const tableWidth = await horizontalScroll.evaluate((element) => ({
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            }));
            expect(tableWidth.scrollWidth).toBeGreaterThan(
              tableWidth.clientWidth,
            );
            await horizontalScroll.evaluate((element) => {
              element.scrollLeft = element.scrollWidth;
            });
            if (section === 'members') {
              const ownerRow = settings
                .getByRole('row')
                .filter({ hasText: 'Alex Rivera' });
              await expect(
                ownerRow.getByRole('combobox', {
                  name: 'Role for Alex Rivera',
                }),
              ).toBeInViewport();
              await expect(
                ownerRow.getByRole('button', { name: 'Remove', exact: true }),
              ).toBeInViewport();
            } else {
              const pendingRow = settings
                .getByRole('row')
                .filter({ hasText: 'sam.taylor@example.test' });
              await expect(
                pendingRow.getByRole('button', { name: 'Resend', exact: true }),
              ).toBeInViewport();
              await expect(
                pendingRow.getByRole('button', { name: 'Cancel', exact: true }),
              ).toBeInViewport();
            }
            const documentWidth = await page
              .locator('html')
              .evaluate((element) => element.scrollWidth);
            expect(documentWidth).toBeLessThanOrEqual(390);
            await captureTask7BViewportReview(
              page,
              `${section}-actions-right`,
              390,
              theme,
            );
            await horizontalScroll.evaluate((element) => {
              element.scrollLeft = 0;
            });
          }
        }
      }
    }
    await invitationCapture?.remove();
    await memberCapture?.remove();
  }

  const captureResponsiveState = async (name: string) => {
    const target =
      name === 'general-error'
        ? null
        : name.endsWith('-loading')
          ? page.getByRole('status', {
              name: name.startsWith('invitations-')
                ? 'Loading invitations'
                : 'Loading members',
            })
          : name.endsWith('-empty')
            ? page.getByText(
                name.startsWith('invitations-')
                  ? 'No pending invitations'
                  : 'No members yet',
                { exact: true },
              )
            : name.endsWith('-error')
              ? page.getByRole('status').filter({
                  hasText: 'Service temporarily unavailable. Please try again.',
                })
              : null;
    for (const width of [390, 768] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 720,
        });
        if (target) {
          await target.evaluate((element) => {
            const settingsPane = element.closest<HTMLElement>(
              'section[aria-label$=" settings"]',
            );
            if (!settingsPane)
              throw new Error(
                'Expected the state inside the Settings content pane.',
              );
            settingsPane.scrollTop = settingsPane.scrollHeight;
          });
          await expect(target).toBeInViewport();
        }
        await captureTask7BViewportReview(page, name, width, theme);
        if (target) await expect(target).toBeInViewport();
      }
    }
  };
  const memberListUrl = (url: URL) =>
    url.pathname === `/api/organizations/${team.id}/members`;
  let releaseMembers!: () => void;
  let memberRequestStarted!: () => void;
  let memberResponseFinished!: () => void;
  const membersGate = new Promise<void>((resolveGate) => {
    releaseMembers = resolveGate;
  });
  const membersStarted = new Promise<void>((resolveStarted) => {
    memberRequestStarted = resolveStarted;
  });
  const membersResponseFinished = new Promise<void>((resolveFinished) => {
    memberResponseFinished = resolveFinished;
  });
  await page.route(memberListUrl, async (route) => {
    memberRequestStarted();
    try {
      await membersGate;
      const response = await route.fetch();
      await route.fulfill({ response });
    } finally {
      memberResponseFinished();
    }
  });
  try {
    await page.goto(`${stack.frontendUrl}/workspace?settings=members`);
    await membersStarted;
    await expect(
      page.getByRole('status', { name: 'Loading members' }),
    ).toBeVisible();
    await captureResponsiveState('members-loading');
  } finally {
    releaseMembers();
    await membersResponseFinished;
    await page.unroute(memberListUrl);
  }
  await expect(page.getByRole('table')).toBeVisible();

  await page.route(memberListUrl, async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as {
      items: unknown[];
      [key: string]: unknown;
    };
    await route.fulfill({ response, json: { ...data, items: [] } });
  });
  try {
    await page.goto(`${stack.frontendUrl}/workspace?settings=members`);
    await expect(
      page.getByText('No members yet', { exact: true }),
    ).toBeVisible();
    await captureResponsiveState('members-empty');
  } finally {
    await page.unroute(memberListUrl);
  }

  await page.route(memberListUrl, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"message":"private test detail"}',
    }),
  );
  try {
    await page.goto(`${stack.frontendUrl}/workspace?settings=members`);
    await expect(page.getByRole('status')).toContainText(
      'Service temporarily unavailable. Please try again.',
    );
    await expect(page.locator('body')).not.toContainText('private test detail');
    await captureResponsiveState('members-error');
  } finally {
    await page.unroute(memberListUrl);
  }

  const invitationListUrl = (url: URL) =>
    url.pathname === `/api/organizations/${team.id}/invitations`;
  let releaseInvitations!: () => void;
  let invitationRequestStarted!: () => void;
  let invitationResponseFinished!: () => void;
  const invitationsGate = new Promise<void>((resolveGate) => {
    releaseInvitations = resolveGate;
  });
  const invitationsStarted = new Promise<void>((resolveStarted) => {
    invitationRequestStarted = resolveStarted;
  });
  const invitationsResponseFinished = new Promise<void>((resolveFinished) => {
    invitationResponseFinished = resolveFinished;
  });
  await page.route(invitationListUrl, async (route) => {
    invitationRequestStarted();
    try {
      await invitationsGate;
      const response = await route.fetch();
      await route.fulfill({ response });
    } finally {
      invitationResponseFinished();
    }
  });
  try {
    await page.goto(`${stack.frontendUrl}/workspace?settings=invitations`);
    await invitationsStarted;
    await expect(
      page.getByRole('status', { name: 'Loading invitations' }),
    ).toBeVisible();
    await captureResponsiveState('invitations-loading');
  } finally {
    releaseInvitations();
    await invitationsResponseFinished;
    await page.unroute(invitationListUrl);
  }
  await expect(page.getByRole('table')).toBeVisible();

  await page.route(invitationListUrl, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"message":"private test detail"}',
    }),
  );
  try {
    await page.goto(`${stack.frontendUrl}/workspace?settings=invitations`);
    await expect(page.getByRole('status')).toContainText(
      'Service temporarily unavailable. Please try again.',
    );
    await expect(page.locator('body')).not.toContainText('private test detail');
    await captureResponsiveState('invitations-error');
  } finally {
    await page.unroute(invitationListUrl);
  }

  await page.route(invitationListUrl, async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as {
      items: unknown[];
      [key: string]: unknown;
    };
    await route.fulfill({ response, json: { ...data, items: [] } });
  });
  try {
    await page.goto(`${stack.frontendUrl}/workspace?settings=invitations`);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(
      page.getByText('No pending invitations', { exact: true }),
    ).toBeVisible();
    await captureResponsiveState('invitations-empty');
  } finally {
    await page.unroute(invitationListUrl);
  }

  await page.goto(`${stack.frontendUrl}/workspace?settings=general`);
  const settingsUpdateUrl = (url: URL) =>
    url.pathname === `/api/organizations/${team.id}/settings`;
  await page.route(settingsUpdateUrl, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"message":"private test detail"}',
    }),
  );
  try {
    await page
      .getByRole('switch', { name: 'Require two-factor authentication' })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('private test detail');
    await captureResponsiveState('general-error');
  } finally {
    await page.unroute(settingsUpdateUrl);
  }

  await page.goto(stack.frontendUrl + '/workspace?settings=profile');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page
    .getByLabel('Display name', { exact: true })
    .fill('Maya Chen Updated');
  const profileSave = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/identity/profile' &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await profileSave).status()).toBe(200);
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const)
    await captureCheckpointCView(page, 'settings-saved-toast', theme);
  await captureTask9Variants(page, 'settings-saved-toast', 'Changes saved.');
});
