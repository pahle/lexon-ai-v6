import { expect, test, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { brandFixedTime, captureBrandViews } from './brand-visual-support.js';
import { gateRequests } from './brand-visual-world.js';
import {
  prototypeNow,
  provisioningOrganizations,
} from './prototype-fixtures.js';
import { hideDevOverlayOnLoad } from './brand-visual-support.js';
import { platformWorld } from './brand-visual-platform-world.js';

// F4.1 visual set, platform group: provisioning and account status for a
// real platform administrator.

/** The list shows each organization's prototype expiry and status. */
async function installProvisioningListNormalization(page: Page) {
  const matcher = (url: URL) =>
    url.pathname === '/api/platform/provisioning' &&
    url.searchParams.has('limit');
  const handler = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = (await response.json()) as {
      items: Array<{
        slug: string;
        createdAt: string;
        invitation: { status: string; expiresAt: string };
      }>;
    };
    const items = provisioningOrganizations.flatMap((organization) => {
      const row = body.items.find((item) => item.slug === organization.slug);
      return row
        ? [
            {
              ...row,
              createdAt: prototypeNow,
              invitation: {
                ...row.invitation,
                status:
                  organization.status === 'Expired' ? 'expired' : 'pending',
                expiresAt: organization.expiresAt,
              },
            },
          ]
        : [];
    });
    return route.fulfill({ response, json: { ...body, items } });
  };
  await page.route(matcher, handler);
  return { remove: () => page.unroute(matcher, handler) };
}

// Platform, errors, and UI patterns.

test.beforeEach(({ page }) => hideDevOverlayOnLoad(page));

test('Platform pages for a real platform administrator', async ({ page }) => {
  test.setTimeout(420_000);
  const stack = descriptor();
  // Built once per stack (administrator and the three organizations) and
  // reused afterwards, so this group can run again on a long-lived stack.
  const world = await platformWorld(page);
  await page.clock.setFixedTime(brandFixedTime);

  const listUrl = (url: URL, method: string) =>
    url.pathname === '/api/platform/provisioning' &&
    url.searchParams.has('limit') &&
    (method === 'GET' || method === '');
  const provisioning = stack.frontendUrl + '/platform/provisioning';

  // The empty list: the world already holds the organizations, so the list
  // answers with no items for this state.
  const emptyList = (url: URL) => listUrl(url, 'GET');
  await page.route(emptyList, (route) =>
    route.request().method() !== 'GET'
      ? route.fallback()
      : route.fulfill({ json: { items: [], pageInfo: { nextCursor: null } } }),
  );
  try {
    await page.goto(provisioning);
    await expect(page.locator('h1')).toHaveText('Organization provisioning');
    await expect(
      page.getByText('No provisioning organizations', { exact: true }),
    ).toBeVisible();
    await captureBrandViews(page, 'platform-provisioning-empty');
  } finally {
    await page.unroute(emptyList);
  }

  // The list request is held by a gated route, then released.
  const list = await gateRequests(page, listUrl);
  try {
    await page.reload();
    await list.started;
    await expect(
      page.getByRole('status', { name: 'Checking platform access' }),
    ).toBeVisible();
    await captureBrandViews(page, 'platform-provisioning-loading');
  } finally {
    await list.finish();
  }

  const failingList = (url: URL) => listUrl(url, 'GET');
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
    await expect(async () => {
      await page.reload();
      await expect(
        page.getByText('Service temporarily unavailable. Please try again.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await expect(page.locator('body')).not.toContainText(
      'private platform detail',
    );
    await captureBrandViews(page, 'platform-provisioning-error');
  } finally {
    await page.unroute(failingList);
  }

  // The list shows the prototype dates and the expired invitation.
  const normalized = await installProvisioningListNormalization(page);
  await page.goto(provisioning);
  await expect(
    page.getByRole('link', { name: 'Harbor Legal Partners', exact: true }),
  ).toBeVisible();
  await captureBrandViews(page, 'platform-provisioning-populated');
  await normalized.remove();

  // The invitation expiry is the only time-dependent value on the detail page.
  const detailPath = `/api/platform/provisioning/${world.harborId}`;
  const detailUrl = (url: URL) => url.pathname === detailPath;
  await page.route(detailUrl, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as {
      createdAt: string;
      invitation: { expiresAt: string };
    };
    body.createdAt = prototypeNow;
    body.invitation.expiresAt = '2026-11-21T04:00:00.000Z';
    return route.fulfill({ response, json: body });
  });
  try {
    await page
      .getByRole('link', { name: 'Harbor Legal Partners', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Resend owner invitation' }),
    ).toBeVisible();
    await expect(
      page.getByText('21 Nov 2026, 11:00', { exact: true }),
    ).toBeVisible();
    await captureBrandViews(page, 'platform-provisioning-detail');
  } finally {
    await page.unroute(detailUrl);
  }

  await page.goto(stack.frontendUrl + '/platform/accounts');
  await expect(page.getByLabel('User ID')).toBeVisible();
  await captureBrandViews(page, 'platform-accounts');
});
