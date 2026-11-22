import { expect, test, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import {
  brandFixedTime,
  captureBrandViews,
  hideDevOverlayOnLoad,
} from './brand-visual-support.js';
import { gateRequests } from './brand-visual-world.js';
import { waitForHydration } from './identity-support.js';
import { platformWorld } from './brand-visual-platform-world.js';
import { installPlatformConsoleNormalization } from './brand-visual-platform-normalizations.js';

// F4.1 visual set, platform organizations group (revision 16): the
// Organizations list and its states, the provision dialog, and the
// provisioning and active record pages, for a real platform administrator.
// Content is the prototype's (brand-visual-platform-normalizations.ts). The
// prototype pages show ten rows per page, so the list opens with
// ?pageSize=10.

test.beforeEach(({ page }) => hideDevOverlayOnLoad(page));

const footer = (page: Page, text: string) =>
  page.locator('[data-slot="paged-footer"]').getByText(text, { exact: true });

async function openOrganizations(page: Page) {
  await page.clock.setFixedTime(brandFixedTime);
  await page.goto(
    descriptor().frontendUrl + '/platform/organizations?pageSize=10',
  );
  await expect(page.locator('h1')).toHaveText('Organizations');
}

const listRequest = (url: URL, method: string) =>
  url.pathname === '/api/platform/organizations' &&
  url.searchParams.has('page') &&
  (method === 'GET' || method === '');

test('Organizations list states', async ({ page, playwright }) => {
  test.setTimeout(360_000);
  const world = await platformWorld(page, playwright);
  const normalized = await installPlatformConsoleNormalization(page, world);

  await openOrganizations(page);
  await captureBrandViews(page, 'platform-organizations', {
    open: async () => {
      await expect(
        page.getByLabel('Open Sinar Hukum', { exact: true }),
      ).toBeVisible();
      await expect(footer(page, '5 organizations')).toBeVisible();
    },
  });

  // No team organizations: the list answers with no items for this state.
  const emptyList = (url: URL) => listRequest(url, 'GET');
  await page.route(emptyList, (route) =>
    route.request().method() !== 'GET'
      ? route.fallback()
      : route.fulfill({
          json: { items: [], page: 1, pageSize: 10, total: 0 },
        }),
  );
  try {
    await openOrganizations(page);
    await captureBrandViews(page, 'platform-organizations-empty', {
      open: async () => {
        await expect(
          page.getByText('No team organizations yet', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Provision organization' }),
        ).toHaveCount(1);
      },
    });
  } finally {
    await page.unroute(emptyList);
  }

  // The list request is held by a gated route, then released.
  const list = await gateRequests(page, listRequest);
  try {
    await openOrganizations(page);
    await list.started;
    await captureBrandViews(page, 'platform-organizations-loading', {
      open: () =>
        expect(
          page.getByRole('status', { name: 'Loading organizations' }),
        ).toBeVisible(),
    });
  } finally {
    await list.finish();
  }

  const failingList = (url: URL) => listRequest(url, 'GET');
  await page.route(failingList, (route) =>
    route.request().method() !== 'GET'
      ? route.fallback()
      : route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"private platform detail"}',
        }),
  );
  try {
    await openOrganizations(page);
    await expect(
      page.getByText('We could not load organizations.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      'private platform detail',
    );
    await captureBrandViews(page, 'platform-organizations-error', {
      open: () =>
        expect(page.getByRole('button', { name: 'Try again' })).toBeVisible(),
    });
  } finally {
    await page.unroute(failingList);
  }
  await normalized.remove();
});
