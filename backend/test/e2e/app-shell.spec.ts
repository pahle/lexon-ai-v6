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
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
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

test('F2 shell and optional panel compose without overlap at 768px', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  const created = await page.request.post(stack.apiUrl + '/api/organizations', {
    headers,
    data: {
      name: 'F2 layout team',
      slug: 'f2-layout-' + randomUUID().slice(0, 8),
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.request.post(stack.apiUrl + '/api/organizations/active', {
    headers,
    data: { organizationId: id },
  });
  await page.setViewportSize({ width: 768, height: 720 });
  await page.goto(`${stack.frontendUrl}/organizations/${id}/settings/general`);
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Organization settings');
  // This test-only structural aside mirrors RightPanel's desktop host markup;
  // the host and all layout CSS come from the live production page.
  await page.locator('[data-panel-host]').evaluate((host) => {
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', 'Details');
    panel.className =
      'flex min-h-0 w-[var(--right-panel-width)] shrink-0 flex-col border-l border-border bg-surface';
    panel.style.width = 'var(--right-panel-width)';
    panel.innerHTML = '<h2>Panel</h2>';
    host.append(panel);
  });
  const geometry = await page.evaluate(() => {
    const sidebar = document
      .querySelector('aside[aria-label="Workspace navigation"]')!
      .getBoundingClientRect();
    const main = document.querySelector('main#main')!.getBoundingClientRect();
    const headingElement = document.querySelector('main#main h1')!;
    const heading = headingElement.getBoundingClientRect();
    const textRange = document.createRange();
    textRange.selectNodeContents(headingElement);
    const textRight = Math.max(
      ...[...textRange.getClientRects()].map((rect) => rect.right),
    );
    const panel = document
      .querySelector('[data-panel-host] aside')!
      .getBoundingClientRect();
    return {
      sidebarWidth: sidebar.width,
      mainRight: main.right,
      headingRight: heading.right,
      textRight,
      panelLeft: panel.left,
      panelWidth: panel.width,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.sidebarWidth).toBe(256);
  expect(geometry.panelWidth).toBe(320);
  expect(geometry.headingRight).toBeLessThanOrEqual(geometry.panelLeft);
  expect(geometry.textRight).toBeLessThanOrEqual(geometry.panelLeft);
  expect(geometry.documentWidth).toBeLessThanOrEqual(768);
  expect(geometry.mainRight).toBeLessThanOrEqual(geometry.panelLeft);
});

test('F2 organization popup scrolls 20 choices and keeps paging and creation reachable', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  for (let index = 0; index < 20; index++) {
    const created = await page.request.post(
      stack.apiUrl + '/api/organizations',
      {
        headers,
        data: {
          name: `F2 popup team ${String(index).padStart(2, '0')}`,
          slug: `f2-popup-${randomUUID().slice(0, 8)}`,
        },
      },
    );
    expect(created.status()).toBe(201);
  }

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1024, height: 460 },
  ]) {
    await page.setViewportSize(viewport);
    const organizationList = page.waitForResponse(
      (response) =>
        response.url().includes('/api/organizations?limit=20') &&
        response.request().method() === 'GET',
    );
    await page.goto(stack.frontendUrl + '/workspace');
    expect((await organizationList).status()).toBe(200);
    if (viewport.width < 768) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    const organization = page.getByRole('button', {
      name: 'Organization: Personal',
    });
    await organization.focus();
    await page.keyboard.press('Enter');
    const popup = page.getByTestId('organization-popup');
    await expect(popup).toBeVisible();
    await expect(
      popup.getByRole('button', { name: /^F2 popup team/ }),
    ).toHaveCount(19);
    const firstChoice = popup
      .getByRole('button', { name: /^F2 popup team/ })
      .first();
    await expect(firstChoice).toBeFocused();
    const dimensions = await popup.evaluate((element) => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      maxHeight: getComputedStyle(element).maxHeight,
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);
    expect(dimensions.maxHeight).not.toBe('none');
    expect(dimensions.top).toBeGreaterThanOrEqual(0);
    expect(dimensions.bottom).toBeLessThanOrEqual(viewport.height);
    const lastChoice = popup
      .getByRole('button', { name: /^F2 popup team/ })
      .last();
    await lastChoice.scrollIntoViewIfNeeded();
    await expect(lastChoice).toBeVisible();
    // Start the paging assertion from the last in-popup row so keyboard Tab
    // proves the next control is reachable without depending on popup autofocus.
    await lastChoice.focus();
    const next = popup.getByRole('button', { name: 'Next page' });
    for (let index = 0; index < 4; index++) {
      if (await next.evaluate((element) => element === document.activeElement))
        break;
      await page.keyboard.press('Tab');
      const focusState = await page.evaluate(() => ({
        active: document.activeElement?.textContent?.trim(),
        insidePopup: !!document.activeElement?.closest(
          '[data-testid="organization-popup"]',
        ),
      }));
      if (!focusState.insidePopup) {
        throw new Error(
          `Tab left organization popup before Next page (active: ${focusState.active})`,
        );
      }
    }
    await expect(next).toBeFocused();
    const nextRect = await next.boundingBox();
    expect(nextRect).not.toBeNull();
    expect(nextRect!.y + nextRect!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Enter');
    await expect(
      popup.getByRole('button', { name: /^F2 popup team/ }),
    ).toHaveCount(1);
    const create = popup.getByRole('button', { name: 'Create a team' });
    await popup.getByRole('button', { name: 'First page' }).focus();
    await page.keyboard.press('Tab');
    await expect(create).toBeFocused();
    const createRect = await create.boundingBox();
    expect(createRect).not.toBeNull();
    expect(createRect!.y + createRect!.height).toBeLessThanOrEqual(
      viewport.height,
    );
    await page.keyboard.press('Escape');
  }
});
