import { expect, test, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import {
  brandFixedTime,
  captureBrandViews,
  hideDevOverlayOnLoad,
} from './brand-visual-support.js';
import { gateRequests, gateStarted } from './brand-visual-world.js';
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

// Every test installs the normalizations; they are removed after it whatever
// its outcome, and a recorded normalization failure fails the test (or is
// reported next to the test's own error).
let normalized:
  Awaited<ReturnType<typeof installPlatformConsoleNormalization>> | undefined;
test.afterEach(async () => {
  const current = normalized;
  normalized = undefined;
  await current?.remove();
});

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
  normalized = await installPlatformConsoleNormalization(page, world);

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
    await gateStarted(list, 'platform-organizations-loading');
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
});

test('Provision dialog and organization record pages', async ({
  page,
  playwright,
}) => {
  test.setTimeout(300_000);
  const world = await platformWorld(page, playwright);
  normalized = await installPlatformConsoleNormalization(page, world);

  // The dialog over the list, filled as in the prototype; nothing is sent.
  await openOrganizations(page);
  await expect(footer(page, '5 organizations')).toBeVisible();
  const provision = page.getByRole('button', {
    name: 'Provision organization',
  });
  await waitForHydration(provision);
  await provision.click();
  const dialog = page.getByRole('dialog', {
    name: 'Provision a team organization',
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('textbox', { name: /^Organization name/ })
    .fill('Harbor Legal Partners');
  const slug = dialog.getByRole('textbox', { name: /^Organization slug/ });
  await slug.fill('harbor-legal-partners');
  await dialog
    .getByRole('textbox', { name: /^First owner email/ })
    .fill('owner@harborlegal.co.id');
  await captureBrandViews(page, 'platform-organization-provision', {
    keepFocus: true,
    open: async () => {
      await expect(dialog).toBeVisible();
      await expect(slug).toHaveValue('harbor-legal-partners');
    },
  });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByLabel('Open Harbor Legal Partners', { exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/platform/organizations/${world.harborId}$`),
  );
  await captureBrandViews(page, 'platform-organization-provisioning', {
    open: async () => {
      await expect(
        page.getByRole('button', { name: 'Resend invitation' }),
      ).toBeVisible();
      const expires = page.locator('[data-slot="stat-tile"]', {
        hasText: 'Expires',
      });
      await expect(expires).toContainText('21 Nov 2026');
      await expect(expires).toContainText('11:00');
    },
  });

  await openOrganizations(page);
  await page.getByLabel('Open Hukum Nusantara', { exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/platform/organizations/${world.organizations.team}$`),
  );
  await expect(page.locator('h1')).toHaveText('Hukum Nusantara');
  await captureBrandViews(page, 'platform-organization-active', {
    open: async () => {
      await expect(footer(page, '3 members')).toBeVisible();
      await expect(
        page.getByRole('main').getByText('Sari Wibowo').first(),
      ).toBeVisible();
    },
  });
});
