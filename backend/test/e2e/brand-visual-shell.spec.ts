import { expect, test, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { installChatFixtures } from './chat-state-fixtures.js';
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
} from './brand-visual-world.js';
import { ayu, chatTitles } from './prototype-fixtures.js';
import { openMenuReliably } from './visual-support.js';

// F4.1 visual set, shell group: the Personal and team shells, menus, the
// mobile sheet, and the status pages.

/** Recent lists the six prototype chats; the chat API itself is mocked. */
const recentChats = (page: Page) =>
  installChatFixtures(
    page,
    () => 'new-chat',
    () => undefined,
  );

test('shell in the Personal workspace and the collapsed sidebar', async ({
  page,
}) => {
  await prepareIdentity(page, { name: ayu.name }, ayu.jobTitle);
  await recentChats(page);
  await gotoWorkspace(page, 'Ayu');
  await expect(
    page.getByRole('button', { name: 'Organization: Personal' }),
  ).toBeVisible();

  await captureBrandViews(page, 'shell-personal', {
    open: (viewport) => expectResting(page, viewport),
  });

  await captureBrandViews(page, 'sidebar-collapsed', {
    open: async (viewport) => {
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
});

test('team shell, menus, and the mobile sheet', async ({
  page,
  playwright,
}) => {
  test.setTimeout(230_000);
  await teamWorld(page, playwright);
  await recentChats(page);
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
    open: (viewport) => openUserMenu(page, viewport),
    close: (viewport) => closeMenu(page, viewport),
  });

  await captureBrandViews(page, 'mobile-sheet-open', {
    keepFocus: true,
    open: async (viewport) => {
      if (viewport === 'mobile') await openMobileSheet(page);
      else await expectResting(page, viewport);
    },
    close: async (viewport) => {
      if (viewport === 'mobile') await closeMobileSheet(page);
    },
  });
});

test('access denied and not-found pages', async ({ page, playwright }) => {
  const stack = descriptor();
  await teamWorld(page, playwright);
  await recentChats(page);
  await page.clock.setFixedTime(brandFixedTime);

  const denied = await page.goto(stack.frontendUrl + '/platform/provisioning');
  expect(denied?.status()).toBe(200);
  await expect(page.locator('section[role="alert"]')).toContainText(
    'You do not have access to this page.',
  );
  await captureBrandViews(page, 'platform-no-access');

  const organizations = await page.goto(stack.frontendUrl + '/organizations');
  expect(organizations?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  await expect(
    page.getByText('The requested workspace page could not be found.'),
  ).toBeVisible();
  await captureBrandViews(page, 'organizations-not-found');

  const missing = await page.goto(stack.frontendUrl + '/no-such-page');
  expect(missing?.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  await expect(
    page.getByText('The requested page could not be found.', { exact: true }),
  ).toBeVisible();
  await captureBrandViews(page, 'not-found');
});

test('workspace error page after a render failure', async ({ page }) => {
  const stack = descriptor();
  await prepareIdentity(page, { name: ayu.name }, ayu.jobTitle);
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
      route.request().method() !== 'GET'
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
