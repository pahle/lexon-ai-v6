import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { totpForUri } from '../setup/totp.js';

// Layout, behavior, and accessibility assertions. They take no screenshots and
// do not depend on any visual baseline.
// Same browser context as the retired visual-review project, so geometry is
// measured after motion has settled.
test.use({ reducedMotion: 'reduce' });

test('auth frame cover follows the published 768px two-column boundary without overflow', async ({
  page,
}) => {
  await page.goto(descriptor().frontendUrl + '/sign-in');
  await page.setViewportSize({ width: 767, height: 900 });
  await expect(page.locator('[aria-hidden="true"].md\\:flex')).toBeHidden();
  expect(
    await page
      .locator('form')
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBeGreaterThan(0);
  expect(
    await page.locator('html').evaluate((node) => node.scrollWidth),
  ).toBeLessThanOrEqual(767);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator('[aria-hidden="true"].md\\:flex')).toBeVisible();
  expect(
    await page
      .locator('form')
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBeGreaterThan(0);
  expect(
    await page.locator('html').evaluate((node) => node.scrollWidth),
  ).toBeLessThanOrEqual(768);
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
      page.locator('[aria-hidden="true"].md\\:flex'),
      route.name,
    ).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await expect(page.locator('img[alt="Lexon"]:visible')).toHaveCount(1);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
  }
});

test('Task 7A Settings renders all Account sections, saved feedback, and narrow layouts', async ({
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
  const settle = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
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
        await expectAppearanceGeometry(page);
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
          .getByRole('dialog', { name: 'Settings' })
          .locator('aside')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      ).not.toBe('rgba(0, 0, 0, 0)');
      await settle();
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
        await settle();
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
      await expectAppearanceGeometry(page);
    }
    // Below md the dialog is master/detail: an open section hides the section
    // list and shows a back control instead.
    await expect(
      page.getByRole('button', { name: 'Back to sections' }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Settings sections' }),
    ).toBeHidden();
    await settle();
  }
  await page.setViewportSize({ width: 768, height: 900 });
  for (const section of sections) {
    await page.goto(stack.frontendUrl + '/workspace?settings=' + section);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expectAccountSectionReady(page, section);
    if (section === 'appearance') {
      await expectAppearanceGeometry(page);
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
        .getByRole('dialog', { name: 'Settings' })
        .locator('aside')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe('rgba(0, 0, 0, 0)');
    await settle();
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
    await expect(
      page
        .getByRole('list', { name: 'Signed-in sessions' })
        .getByText('This device', { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('recovery-codes')).toHaveCount(0);
    await settle();
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
  // DS v3.1 mobile: rows stack, nothing scrolls sideways.
  const tableViewport = membersTable.locator('xpath=..');
  const tableMetrics = await tableViewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(tableMetrics.scrollWidth).toBeLessThanOrEqual(
    tableMetrics.clientWidth,
  );
  const role = settings.getByRole('combobox', {
    name: 'Role for Alex Rivera',
  });
  const ownerRow = settings.getByRole('row').filter({ hasText: 'Alex Rivera' });
  await expect(role).toBeInViewport();
  await expect(ownerRow.getByText('Alex Rivera')).toBeInViewport({ ratio: 1 });
  await expect(
    ownerRow.getByRole('button', { name: 'More actions for Alex Rivera' }),
  ).toBeInViewport({ ratio: 1 });
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
    name: 'More actions for Alex Rivera',
  });
  await expect(remove).not.toHaveClass(/text-destructive/);
  await remove.click();
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
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
    await expect(page.getByLabel('Job title')).toBeVisible();
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

async function expectAppearanceGeometry(page: import('@playwright/test').Page) {
  const metrics = await page.getByRole('radiogroup').evaluate((group) => {
    const rects = Array.from(
      group.querySelectorAll<HTMLElement>('[data-slot="appearance-option"]'),
    ).map((option) => option.getBoundingClientRect());
    const styles = getComputedStyle(group);
    return {
      count: rects.length,
      widths: rects.map((rect) => rect.width),
      tops: rects.map((rect) => rect.top),
      gaps: rects
        .slice(1)
        .map((rect, index) => rect.left - rects[index]!.right),
      // The group fills the content column; the three fixed-width cards are
      // what must stay compact, so the span of the cards is measured.
      width: rects[rects.length - 1]!.right - rects[0]!.left,
      scrollWidth: group.scrollWidth,
      clientWidth: group.clientWidth,
      columnGap: Number.parseFloat(styles.columnGap),
    };
  });

  expect(metrics.count).toBe(3);
  expect(metrics.width).toBeLessThanOrEqual(576);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  // Prototype: 16px gap, 10px below the md breakpoint.
  const expectedGap = (page.viewportSize()?.width ?? 1280) < 768 ? 10 : 16;
  expect(metrics.columnGap).toBe(expectedGap);
  expect(metrics.tops[0]).toBeCloseTo(metrics.tops[1]!, 0);
  expect(metrics.tops[1]).toBeCloseTo(metrics.tops[2]!, 0);
  expect(metrics.gaps[0]).toBeCloseTo(expectedGap, 0);
  expect(metrics.gaps[1]).toBeCloseTo(expectedGap, 0);
  expect(Math.max(...metrics.widths)).toBeLessThanOrEqual(192);
  expect(Math.min(...metrics.widths)).toBeGreaterThanOrEqual(70);
}

test('F4 new-chat composer exposes its active input and no retired controls', async ({
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
  await expect(
    page.getByRole('textbox', { name: 'Message input' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeDisabled();
  const composer = page.locator('form').filter({
    has: page.getByRole('textbox', { name: 'Message input' }),
  });
  await expect(
    composer.getByRole('button', {
      name: /attachment|voice|audio|record|branch|sample|example/i,
    }),
  ).toHaveCount(0);
});
