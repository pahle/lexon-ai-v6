import { test, expect, type Locator, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';

test('F2 shell keeps Home framed, collapses across reload, and renders scoped not-found routes', async ({
  page,
}) => {
  const stack = descriptor();
  const assetPaths = [
    '/LEXON-wordmark-compact-ink.svg',
    '/LEXON-wordmark-compact-cream.svg',
  ];
  for (const path of assetPaths) {
    const response = await page.request.get(stack.frontendUrl + path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
  }
  const manifestResponse = await page.request.get(
    stack.frontendUrl + '/manifest.webmanifest',
  );
  expect(manifestResponse.status()).toBe(200);
  const manifest = (await manifestResponse.json()) as {
    icons: Array<{ src: string }>;
  };
  const manifestIconPaths = manifest.icons.map((icon) => icon.src);
  expect(manifestIconPaths).toEqual([
    '/android-chrome-192x192.png',
    '/android-chrome-512x512.png',
  ]);
  for (const path of manifestIconPaths) {
    const response = await page.request.get(stack.frontendUrl + path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
  }
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
  const decodedAssetWidths = await page.evaluate(
    async (paths) => {
      const results: number[] = [];
      for (const path of paths) {
        const image = new Image();
        image.src = path;
        await image.decode();
        results.push(image.naturalWidth);
      }
      return results;
    },
    [...assetPaths, ...manifestIconPaths],
  );
  expect(decodedAssetWidths.every((width) => width > 0)).toBe(true);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(
    page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Home', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  const message = page.getByRole('textbox', { name: 'Message input' });
  await expect(message).toBeEnabled();
  await expect(page.getByText('Welcome, ', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Add Attachment' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /voice|audio|record/i }),
  ).toHaveCount(0);
  await message.fill('Draft legal question');
  await expect(message).toHaveValue('Draft legal question');
  await expect(page.locator('[data-role="user"]')).toHaveCount(0);
  expect(chatRequests).toEqual([]);

  const sidebarContainer = page.locator(
    '[data-slot="sidebar-container"]:visible',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(
    await sidebarContainer.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).not.toBe('0s');
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
    '/settings/profile',
    '/settings/security',
    '/settings/appearance',
    `/organizations/${id}/settings/members`,
    `/organizations/${id}/settings/invitations`,
    `/organizations/${id}/settings/general`,
  ]) {
    await page.goto(stack.frontendUrl + path);
    await expect(page).toHaveURL(stack.frontendUrl + path);
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Return to workspace' }),
    ).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    if (path.startsWith('/organizations/')) {
      await expect(
        page.getByRole('complementary', { name: 'Workspace navigation' }),
      ).toBeVisible();
    }
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
  await dialog
    .getByRole('button', { name: 'Close navigation', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) => !element.hasAttribute('data-starting-style'),
      ),
    )
    .toBe(true);
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  const mobileOrganization = dialog.getByRole('button', {
    name: 'Organization: Personal',
  });
  await mobileOrganization.click();
  await expect(page.getByTestId('organization-popup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) => !element.hasAttribute('data-starting-style'),
      ),
    )
    .toBe(true);
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  const mobileUser = dialog.locator(
    '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
  );
  await mobileUser.focus();
  await expect(mobileUser).toBeFocused();
  await page.keyboard.press('Enter');
  const settingsMenuItem = page.getByRole('menuitem', {
    name: /^Settings/,
  });
  await expect(settingsMenuItem).toBeVisible();
  await expect(settingsMenuItem).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(mobileUser).toBeFocused();
  await mobileUser.click();
  await expect(settingsMenuItem).toBeVisible();
  await settingsMenuItem.click();
  await expect(page).toHaveURL(/\/workspace\?settings=profile$/);
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }),
  ).toBeHidden();
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(settingsDialog).toBeVisible();
  await expect
    .poll(() =>
      settingsDialog.evaluate(
        (element) => !element.hasAttribute('data-starting-style'),
      ),
    )
    .toBe(true);
  await settingsDialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await page.keyboard.press('Escape');
  await expect(settingsDialog).toBeHidden();
  await expect(open).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const workspaceDialog = page.getByRole('dialog', { name: 'Sidebar' });
  await workspaceDialog
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await workspaceDialog
    .locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]')
    .click();
  await page.getByRole('menuitem', { name: /^Settings/ }).click();
  await expect(page).toHaveURL(/\/workspace\?settings=profile$/);
  await expect(settingsDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsDialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
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

test('Task 6A Home shell keeps switcher and user menu complete and keyboard reachable', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Task Preview',
    email: `task-6a-${randomUUID()}@example.test`,
  });
  const onboarding = await page.request.post(
    stack.apiUrl + '/api/identity/onboarding/complete',
    { headers, data: {} },
  );
  expect(onboarding.status()).toBe(204);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(stack.frontendUrl + '/workspace');
  await expect(
    page.locator('textarea[aria-label="Message input"]'),
  ).toHaveAttribute(
    'placeholder',
    'Ask Lexon about a contract, a regulation, or a case...',
  );
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(
    nav.getByRole('link', { name: 'Home', exact: true }),
  ).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(
    nav.getByRole('link', { name: 'Organization settings' }),
  ).toHaveCount(0);

  const organization = page.getByRole('button', {
    name: 'Organization: Personal',
  });
  await organization.focus();
  await page.keyboard.press('Enter');
  const createTeam = page.getByRole('menuitem', { name: 'Create a team' });
  await expect(createTeam).toBeVisible();
  await page.keyboard.press('End');
  await expect(createTeam).toBeFocused();
  await expect(organization).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  const createTeamDialog = page.getByRole('dialog', { name: 'Create a team' });
  await expect(createTeamDialog).toBeVisible();
  await expect(createTeamDialog.getByLabel('Team name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(createTeamDialog).toBeHidden();
  await expect(organization).toBeFocused();

  const user = page.locator(
    '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
  );
  await expect(user).toContainText('Task Preview');
  await expect(user).toContainText(/task-6a-.*@example\.test/);
  await expect(user.locator('[data-slot="avatar-initials"]')).toHaveText('TP');
  await expect(user.locator('svg.lucide-chevrons-up-down')).toHaveCount(1);
  await user.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  const collapsedOrganization = page.getByRole('button', {
    name: 'Organization: Personal',
  });
  const tile = collapsedOrganization.locator('img[alt="Lexon"]');
  await expect(tile).toHaveAttribute('src', /LEXON-mark-tile-seal-micro\.svg$/);
  const tileBounds = await tile.boundingBox();
  expect(tileBounds?.width).toBe(32);
  expect(tileBounds?.height).toBe(32);
  await collapsedOrganization.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('menuitem', { name: 'Create a team' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
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
  await page.goto(`${stack.frontendUrl}/workspace`);
  await expect(page.getByRole('heading', { name: /^Welcome, / })).toBeVisible();
  const composerInput = page.getByRole('textbox', { name: 'Message input' });
  const send = page.getByRole('button', {
    name: 'Send message',
    exact: true,
  });
  await expect(composerInput).toBeVisible();
  await expect(send).toBeVisible();
  await expect(send).toBeDisabled();
  // This test-only structural aside checks desktop layout around RightPanel's
  // host; frontend/test/right-panel.spec.tsx verifies its actual mobile modal.
  await page.locator('[data-panel-host]').evaluate((host) => {
    if (!host.isConnected || host.querySelectorAll('aside').length !== 0) {
      throw new Error('Expected one connected, empty panel host');
    }
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', 'Details');
    panel.className =
      'flex min-h-0 w-[var(--right-panel-width)] shrink-0 flex-col border-l border-border bg-surface';
    panel.style.width = 'var(--right-panel-width)';
    panel.innerHTML = '<h2>Panel</h2>';
    host.append(panel);
  });
  const readGeometry = () =>
    composerInput.evaluate((composer) => {
      const rect = (element: Element, label: string) => {
        if (!element.isConnected) throw new Error(`${label} is disconnected`);
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          bounds.width === 0 ||
          bounds.height === 0
        ) {
          throw new Error(`${label} is not visibly measurable`);
        }
        return {
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
        };
      };
      const one = (selector: string, label: string) => {
        const matches = document.querySelectorAll(selector);
        if (matches.length !== 1) {
          throw new Error(`Expected one ${label}, found ${matches.length}`);
        }
        return matches[0]!;
      };
      const sidebar = rect(
        one(
          '[role="complementary"][aria-label="Workspace navigation"]',
          'workspace sidebar',
        ),
        'workspace sidebar',
      );
      const main = rect(one('main#main', 'main'), 'main');
      const content = rect(
        one(
          'main#main > div.flex.min-h-0.flex-1 > div.flex.min-w-0.flex-1',
          'main content',
        ),
        'main content',
      );
      const headingElement = one('main#main h2', 'page headline');
      const heading = rect(headingElement, 'page heading');
      const textRange = document.createRange();
      textRange.selectNodeContents(headingElement);
      const textRects = [...textRange.getClientRects()];
      if (textRects.length === 0)
        throw new Error('Heading text is not visible');
      const panelHost = one('[data-panel-host]', 'panel host');
      const panel = rect(
        one('[data-panel-host] aside[aria-label="Details"]', 'test panel'),
        'test panel',
      );
      const send = rect(
        one('button[aria-label="Send message"]', 'send action'),
        'send action',
      );
      return {
        sidebarWidth: sidebar.width,
        mainRight: main.right,
        contentRight: content.right,
        headingRight: heading.right,
        textRight: Math.max(...textRects.map((textRect) => textRect.right)),
        panelLeft: panel.left,
        panelWidth: panel.width,
        documentWidth: document.documentElement.scrollWidth,
        composer: rect(composer, 'message input'),
        send,
        panelCount: panelHost.querySelectorAll('aside').length,
      };
    });
  const geometry = await readGeometry();
  const assertGeometry = (
    snapshot: Awaited<ReturnType<typeof readGeometry>>,
  ) => {
    expect(snapshot.sidebarWidth).toBe(256);
    expect(snapshot.panelWidth).toBe(320);
    expect(snapshot.headingRight).toBeLessThanOrEqual(snapshot.panelLeft);
    expect(snapshot.textRight).toBeLessThanOrEqual(snapshot.panelLeft);
    expect(snapshot.documentWidth).toBeLessThanOrEqual(768);
    expect(snapshot.contentRight).toBeLessThanOrEqual(snapshot.panelLeft);
    expect(snapshot.mainRight).toBeGreaterThanOrEqual(snapshot.panelLeft);
    expect(snapshot.panelCount).toBe(1);
    expect(
      snapshot.composer.right,
      'message input must not overlap the optional panel',
    ).toBeLessThanOrEqual(snapshot.panelLeft);
    expect(snapshot.send.right).toBeLessThanOrEqual(snapshot.panelLeft);
  };
  assertGeometry(geometry);
  const originalTransform = await composerInput.evaluate((element) => ({
    value: (element as HTMLElement).style.getPropertyValue('transform'),
    priority: (element as HTMLElement).style.getPropertyPriority('transform'),
  }));
  try {
    await composerInput.evaluate((element) => {
      (element as HTMLElement).style.setProperty(
        'transform',
        'translateX(320px)',
      );
    });
    const overlappingGeometry = await readGeometry();
    expect(overlappingGeometry.panelLeft).toBe(geometry.panelLeft);
    expect(overlappingGeometry.composer.right).toBe(
      geometry.composer.right + 320,
    );
    expect(overlappingGeometry.composer.right).toBeGreaterThan(
      overlappingGeometry.panelLeft,
    );
    expect(overlappingGeometry.send).toEqual(geometry.send);
    expect(() => assertGeometry(overlappingGeometry)).toThrow(
      /message input must not overlap the optional panel/,
    );
  } finally {
    await composerInput.evaluate((element, transform) => {
      const input = element as HTMLElement;
      if (transform.value) {
        input.style.setProperty(
          'transform',
          transform.value,
          transform.priority,
        );
      } else {
        input.style.removeProperty('transform');
      }
    }, originalTransform);
  }
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
    let releaseOrganizationResponse!: () => void;
    let signalBufferedResponse!: () => void;
    let signalOrganizationRouteFinished!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseOrganizationResponse = resolve;
    });
    const responseBuffered = new Promise<void>((resolve) => {
      signalBufferedResponse = resolve;
    });
    const organizationRouteFinished = new Promise<void>((resolve) => {
      signalOrganizationRouteFinished = resolve;
    });
    const organizationListPattern = /\/api\/organizations\?limit=20$/;
    let organizationRouteBuffered = false;
    const organizationListRoute = async (route: Route) => {
      const response = await route.fetch();
      organizationRouteBuffered = true;
      signalBufferedResponse();
      try {
        await responseGate;
        await route.fulfill({ response });
      } finally {
        signalOrganizationRouteFinished();
      }
    };
    let popup!: Locator;
    let create!: Locator;
    let organizationListStatus: number;
    await page.route(organizationListPattern, organizationListRoute);
    try {
      await page.goto(stack.frontendUrl + '/workspace');
      await responseBuffered;
      if (viewport.width < 768) {
        await page.getByRole('button', { name: 'Open navigation' }).click();
      }
      const organization = page.getByRole('button', {
        name: 'Organization: Personal',
      });
      await organization.focus();
      await page.keyboard.press('Enter');
      popup = page.getByTestId('organization-popup');
      await expect(popup).toBeVisible();
      await expect(
        page.getByRole('menu', { name: 'Organizations', exact: true }),
      ).toBeVisible();
      create = popup.getByRole('menuitem', { name: 'Create a team' });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const popupElement = document.querySelector(
              '[data-testid="organization-popup"]',
            );
            return popupElement?.contains(document.activeElement) ?? false;
          }),
        )
        .toBe(true);
      await expect(
        popup.getByRole('menuitem', { name: /^F2 popup team/ }),
      ).toHaveCount(0);
      await page.keyboard.press('End');
      await expect(create).toBeFocused();
      const organizationList = page.waitForResponse(
        (response) =>
          response.url().includes('/api/organizations?limit=20') &&
          response.request().method() === 'GET',
      );
      releaseOrganizationResponse();
      organizationListStatus = (await organizationList).status();
    } finally {
      releaseOrganizationResponse();
      if (organizationRouteBuffered) await organizationRouteFinished;
      await page.unroute(organizationListPattern, organizationListRoute);
    }
    expect(organizationListStatus).toBe(200);
    await expect(
      popup.getByRole('menuitem', { name: /^F2 popup team/ }),
    ).toHaveCount(19);
    const next = popup.getByRole('menuitem', { name: 'Next page' });
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const focusState = await page.evaluate(() => {
        const popupElement = document.querySelector(
          '[data-testid="organization-popup"]',
        );
        return {
          insidePopup: !!popupElement?.contains(document.activeElement),
        };
      });
      if (await next.evaluate((element) => element === document.activeElement))
        break;
      if (!focusState.insidePopup)
        throw new Error('Keyboard focus left the organization popup');
      await page.keyboard.press('ArrowDown');
    }
    await expect(next).toBeFocused();
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
      .getByRole('menuitem', { name: /^F2 popup team/ })
      .last();
    await expect(lastChoice).toBeVisible();
    const lastChoiceRect = await lastChoice.boundingBox();
    const nextRect = await next.boundingBox();
    const popupRect = await popup.boundingBox();
    expect(lastChoiceRect).not.toBeNull();
    expect(nextRect).not.toBeNull();
    expect(popupRect).not.toBeNull();
    expect(lastChoiceRect!.y).toBeGreaterThanOrEqual(popupRect!.y);
    expect(lastChoiceRect!.y + lastChoiceRect!.height).toBeLessThanOrEqual(
      popupRect!.y + popupRect!.height,
    );
    expect(nextRect!.y + nextRect!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Enter');
    await expect(
      popup.getByRole('menuitem', { name: /^F2 popup team/ }),
    ).toHaveCount(1);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (
        await create.evaluate((element) => element === document.activeElement)
      )
        break;
      const inPopup = await page.evaluate(() =>
        document
          .querySelector('[data-testid="organization-popup"]')
          ?.contains(document.activeElement),
      );
      if (!inPopup)
        throw new Error('Keyboard focus left the organization popup');
      await page.keyboard.press('ArrowDown');
    }
    await expect(create).toBeFocused();
    const createRect = await create.boundingBox();
    expect(createRect).not.toBeNull();
    expect(createRect!.y + createRect!.height).toBeLessThanOrEqual(
      viewport.height,
    );
    await page.keyboard.press('Escape');
  }
});
