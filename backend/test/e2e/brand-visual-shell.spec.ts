import { expect, test, type Locator, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import {
  answer,
  chatId,
  installChatFixtures,
  installRunStreamFixture,
} from './chat-state-fixtures.js';
import { brandFixedTime, captureBrandViews } from './brand-visual-support.js';
import {
  chatListRequest,
  closeMobileSheet,
  closeMenu,
  expectResting,
  gotoWorkspace,
  openMobileSheet,
  openUserMenu,
  organizationTrigger,
  prepareIdentity,
  teamWorld,
  userTrigger,
} from './brand-visual-world.js';
import { ayu, chatTitles } from './prototype-fixtures.js';
import { openMenuReliably } from './visual-support.js';
import { hideDevOverlayOnLoad } from './brand-visual-support.js';

// F4.1 visual set, shell group: the Personal and team shells, menus, the
// mobile sheet, and the status pages.

/** Recent lists the six prototype chats; the chat API itself is mocked. */
const recentChats = async (page: Page) => {
  const env = { state: 'new-chat' };
  await installChatFixtures(
    page,
    () => env.state,
    () => undefined,
  );
  await installRunStreamFixture(page);
  return env;
};

/**
 * The prototype shows the menus, the collapsed sidebar and the mobile sheet
 * over the open chat "Syarat sah perjanjian", so those states open it.
 */
const openAnswerThread = async (page: Page, env: { state: string }) => {
  env.state = 'answer-complete';
  await page.clock.setFixedTime(brandFixedTime);
  const response = await page.goto(
    `${descriptor().frontendUrl}/chats/${chatId}`,
  );
  expect(response?.status()).toBe(200);
  await expect(page.getByText(answer.slice(0, 50))).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
};

test.beforeEach(({ page }) => hideDevOverlayOnLoad(page));

test('shell in the Personal workspace', async ({ page }) => {
  await prepareIdentity(page, { name: ayu.name }, ayu.jobTitle);
  await recentChats(page);
  await gotoWorkspace(page, 'Ayu');
  await expect(
    page.getByRole('button', { name: 'Organization: Personal' }),
  ).toBeVisible();

  await captureBrandViews(page, 'shell-personal', {
    open: (viewport) => expectResting(page, viewport),
  });
});

test('Recent failing to load in the team workspace', async ({
  page,
  playwright,
}) => {
  await teamWorld(page, playwright);
  await recentChats(page);
  // The chat list request fails; the later route wins over the fixture.
  await page.route(
    (url) => chatListRequest(url, 'GET'),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'unavailable' }),
          })
        : route.fallback(),
  );
  await gotoWorkspace(page, ayu.firstName);
  await captureBrandViews(page, 'recent-load-failed', {
    keepFocus: true,
    open: async (viewport) => {
      await expectResting(page, viewport);
      if (viewport === 'mobile') await openMobileSheet(page);
      await expect(
        page.getByText('We could not load recent chats.'),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Try again' }),
      ).toBeVisible();
    },
    close: async (viewport) => {
      if (viewport === 'mobile') await closeMobileSheet(page);
    },
  });
});

test('team shell, menus, and the mobile sheet', async ({
  page,
  playwright,
}) => {
  test.setTimeout(300_000);
  await teamWorld(page, playwright);
  const env = await recentChats(page);
  await gotoWorkspace(page, ayu.firstName);
  await expect(
    page.getByRole('button', { name: /Organization: Hukum Nusantara/ }),
  ).toBeVisible();

  await captureBrandViews(page, 'shell-team', {
    open: (viewport) => expectResting(page, viewport),
  });

  await captureBrandViews(page, 'organization-switcher-open', {
    keepFocus: true,
    open: async (viewport) => {
      await openAnswerThread(page, env);
      if (viewport === 'mobile') await openMobileSheet(page);
      await openMenuReliably(
        page,
        organizationTrigger(page),
        page.getByTestId('organization-popup'),
        'organization switcher',
      );
      await expect(
        page.getByRole('menuitem', { name: 'Personal' }),
      ).toBeVisible();
    },
    close: async (viewport) => {
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('organization-popup')).toBeHidden();
      if (viewport === 'mobile') await closeMobileSheet(page);
    },
  });

  await captureBrandViews(page, 'user-menu-open', {
    keepFocus: true,
    open: async (viewport) => {
      await openAnswerThread(page, env);
      await openUserMenu(page, viewport);
    },
    close: (viewport) => closeMenu(page, viewport),
  });

  await captureBrandViews(page, 'mobile-sheet-open', {
    keepFocus: true,
    open: async (viewport) => {
      await openAnswerThread(page, env);
      if (viewport === 'mobile') await openMobileSheet(page);
      else await expect(organizationTrigger(page)).toBeVisible();
    },
    close: async (viewport) => {
      if (viewport === 'mobile') await closeMobileSheet(page);
    },
  });

  await captureBrandViews(page, 'sidebar-collapsed', {
    open: async (viewport) => {
      await openAnswerThread(page, env);
      if (viewport === 'desktop') {
        await page.getByRole('button', { name: 'Collapse sidebar' }).click();
        await expect(
          page.getByRole('button', { name: 'Expand sidebar' }),
        ).toBeVisible();
      } else {
        await expect(
          page.getByRole('button', { name: 'Open navigation' }),
        ).toBeVisible();
        await expect(
          page.getByRole('dialog', { name: 'Sidebar' }),
        ).toBeHidden();
      }
    },
    close: async (viewport) => {
      if (viewport === 'desktop') {
        await page.getByRole('button', { name: 'Expand sidebar' }).click();
        await expect(
          page.getByRole('button', { name: 'Collapse sidebar' }),
        ).toBeVisible();
      }
    },
  });

  // One grid (LEX-DS-001 §5.5 Shell): the tile and the avatar keep their
  // position when the sidebar collapses; the Assistant icon is centered in its
  // 32px button under the tile (x 24, 8px right of expanded) at the same y.
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoWorkspace(page, ayu.firstName);
  const spots = async () => {
    const box = async (locator: Locator) => {
      const found = await locator.boundingBox();
      if (!found) throw new Error('shell landmark is not rendered');
      return found;
    };
    const tile = await box(organizationTrigger(page).locator('span').first());
    const icon = await box(
      page
        .getByRole('navigation', { name: 'Primary navigation' })
        .locator(
          'a[data-slot="sidebar-menu-button"] > svg, button[aria-label="Assistant navigation"] > svg',
        )
        .first(),
    );
    const avatar = await box(userTrigger(page).locator('[data-slot="avatar"]'));
    const height = page.viewportSize()?.height ?? 0;
    return {
      tile: [tile.x, tile.y, tile.width, tile.height],
      icon: [icon.x, icon.y, icon.width, icon.height],
      avatar: [avatar.x, height - (avatar.y + avatar.height), avatar.width],
    };
  };
  const expanded = await spots();
  expect(expanded.tile).toEqual([16, 16, 32, 32]);
  expect(expanded.icon.slice(0, 2)).toEqual([16, 80]);
  expect(expanded.avatar[0]).toBe(16);
  await expectSidebarGrid(page);
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  const collapsed = await spots();
  expect(collapsed.tile).toEqual(expanded.tile);
  expect(collapsed.avatar).toEqual(expanded.avatar);
  // Centered under the tile: the icon's center is the tile's center.
  expect(collapsed.icon[0]! + collapsed.icon[2]! / 2).toBe(
    collapsed.tile[0]! + collapsed.tile[2]! / 2,
  );
  expect(collapsed.icon[1]).toBe(expanded.icon[1]);
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
});

test('access denied and not-found pages', async ({ page, playwright }) => {
  const stack = descriptor();
  await teamWorld(page, playwright);
  await recentChats(page);
  await page.clock.setFixedTime(brandFixedTime);

  const denied = await page.goto(stack.frontendUrl + '/platform/provisioning');
  expect(denied?.status()).toBe(200);
  await expect(
    page.getByText('This page is available to platform administrators only.'),
  ).toBeVisible();
  await captureBrandViews(page, 'platform-no-access');

  const organizations = await page.goto(stack.frontendUrl + '/organizations');
  expect(organizations?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Workspace not found' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'This organization does not exist, or you are no longer a member.',
    ),
  ).toBeVisible();
  await captureBrandViews(page, 'organizations-not-found');

  const missing = await page.goto(stack.frontendUrl + '/no-such-page');
  expect(missing?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'The page you are looking for does not exist or has moved.',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await captureBrandViews(page, 'not-found');
});

test('workspace error page after a render failure', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  await teamWorld(page, playwright);
  await recentChats(page);
  await page.clock.setFixedTime(brandFixedTime);
  // One chat from an earlier month makes the Chats page format a month-and-year
  // heading; the init script makes exactly that formatter fail, so the real
  // route error boundary renders. Nothing in the product is changed.
  await page.addInitScript(() => {
    const Original = Intl.DateTimeFormat;
    Intl.DateTimeFormat = new Proxy(Original, {
      construct(target, args, newTarget) {
        const options = args[1] as Intl.DateTimeFormatOptions | undefined;
        if (
          options?.month === 'long' &&
          options.year === 'numeric' &&
          options.day === undefined
        )
          throw new Error('Synthetic render failure');
        return Reflect.construct(target, args, newTarget);
      },
    });
  });
  await page.route(
    (url) => chatListRequest(url, 'GET'),
    (route) =>
      route.request().method() !== 'GET' ||
      new URL(route.request().url()).searchParams.get('limit') === '6'
        ? route.fallback()
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              items: [
                {
                  id: '5f0f2a7e-1c3b-4d5e-8a9b-0c1d2e3f4a5b',
                  title: chatTitles.forceMajeure,
                  updatedAt: '2026-01-05T04:00:00.000Z',
                  lastMessageAt: '2026-01-05T04:00:00.000Z',
                },
              ],
              pageInfo: { nextCursor: null },
            }),
          }),
  );
  await page.goto(stack.frontendUrl + '/chats');
  await expect(
    page.getByRole('heading', { name: 'Something went wrong' }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    'Synthetic render failure',
  );
  await captureBrandViews(page, 'workspace-error');
});

/**
 * Measures the visible glyphs of the expanded sidebar (not the 16px icon
 * boxes): SVG shapes through getBBox plus half the stroke, text through Range
 * rects. Right edges sit at x 240, left edges at x 16, within 1px.
 */
async function expectSidebarGrid(page: Page) {
  const edges = await page.evaluate(() => {
    const glyph = (svg: Element | null) => {
      if (!svg) throw new Error('glyph is not rendered');
      let left = Infinity;
      let right = -Infinity;
      for (const shape of svg.querySelectorAll<SVGGraphicsElement>(
        'path, circle, rect, line, polyline',
      )) {
        const ctm = shape.getScreenCTM();
        if (!ctm) continue;
        const bbox = shape.getBBox();
        const stroke = Number.parseFloat(
          getComputedStyle(shape).strokeWidth || '0',
        );
        const half = (stroke * Math.hypot(ctm.a, ctm.b)) / 2;
        // All four corners: the chevron is rotated when its group is open.
        for (const [x, y] of [
          [bbox.x, bbox.y],
          [bbox.x + bbox.width, bbox.y],
          [bbox.x, bbox.y + bbox.height],
          [bbox.x + bbox.width, bbox.y + bbox.height],
        ] as const) {
          const px = ctm.a * x + ctm.c * y + ctm.e;
          left = Math.min(left, px - half);
          right = Math.max(right, px + half);
        }
      }
      return { left, right };
    };
    const text = (node: Element | null) => {
      if (!node) throw new Error('text is not rendered');
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    };
    const q = (selector: string) => document.querySelector(selector);
    const org = q('button[aria-label^="Organization:"]');
    const user = q('[data-slot="sidebar-footer"] button');
    const assistantToggle = q(
      'button[aria-label="Toggle Assistant navigation"]',
    );
    const recentTitle = q('[data-slot="sidebar-menu-button"] > span.truncate');
    const label = [
      ...document.querySelectorAll('[data-slot="sidebar-group-label"]'),
    ].find((node) => node.textContent === 'Recent');
    const assistantLink = q(
      'nav[aria-label="Primary navigation"] a[data-slot="sidebar-menu-button"]',
    );
    return {
      tile: org?.querySelector('span')?.getBoundingClientRect().left ?? NaN,
      navIcon: glyph(assistantLink?.querySelector('svg') ?? null).left,
      recentLabel: text(label ?? null).left,
      recentTitle: text(recentTitle).left,
      avatar:
        user?.querySelector('[data-slot="avatar"]')?.getBoundingClientRect()
          .left ?? NaN,
      orgChevron: glyph(org?.querySelector(':scope > svg:last-child') ?? null)
        .right,
      userChevron: glyph(user?.querySelector(':scope > svg:last-child') ?? null)
        .right,
      assistantChevron: glyph(assistantToggle?.querySelector('svg') ?? null)
        .right,
      kbd: text(q('[data-slot="shortcut-hint"]')).right,
      rowMore: glyph(q('button[aria-label^="Chat actions for"] svg')).right,
    };
  });
  const leftEdges = [
    'tile',
    'navIcon',
    'recentLabel',
    'recentTitle',
    'avatar',
  ] as const;
  const rightEdges = [
    'orgChevron',
    'userChevron',
    'assistantChevron',
    'kbd',
    'rowMore',
  ] as const;
  for (const key of leftEdges)
    expect(Math.abs(edges[key] - 16), `left edge ${key}`).toBeLessThanOrEqual(
      1,
    );
  for (const key of rightEdges)
    expect(Math.abs(edges[key] - 240), `right edge ${key}`).toBeLessThanOrEqual(
      1,
    );
}
