import { expect, test } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { brandFixedTime } from './brand-visual-support.js';
import { gateRequests } from './brand-visual-world.js';
import {
  platformAdmin,
  prototypeNow,
  provisioningOrganizations,
} from './prototype-fixtures.js';
import { hideDevOverlayOnLoad } from './brand-visual-support.js';
import {
  platformWorld,
  reauthenticatePlatform,
} from './brand-visual-platform-world.js';

// F4.1 visual set, platform group: the functional checks of the platform
// console (Organizations, organization record, Accounts) for a real
// administrator. The revision 16 captures are in
// brand-visual-platform-accounts.spec.ts and
// brand-visual-platform-organizations.spec.ts.

// Platform, errors, and UI patterns.

test.beforeEach(({ page }) => hideDevOverlayOnLoad(page));

test('Platform pages for a real platform administrator', async ({
  page,
  playwright,
}) => {
  test.setTimeout(420_000);
  const stack = descriptor();
  // Built once per stack (administrator and the three organizations) and
  // reused afterwards, so this group can run again on a long-lived stack.
  const world = await platformWorld(page, playwright);
  await page.clock.setFixedTime(brandFixedTime);

  const listUrl = (url: URL, method: string) =>
    url.pathname === '/api/platform/organizations' &&
    url.searchParams.has('page') &&
    (method === 'GET' || method === '');
  const organizations = stack.frontendUrl + '/platform/organizations';

  // The empty list: the world already holds the organizations, so the list
  // answers with no items for this state.
  const emptyList = (url: URL) => listUrl(url, 'GET');
  await page.route(emptyList, (route) =>
    route.request().method() !== 'GET'
      ? route.fallback()
      : route.fulfill({
          json: { items: [], page: 1, pageSize: 20, total: 0 },
        }),
  );
  try {
    await page.goto(organizations);
    await expect(page.locator('h1')).toHaveText('Organizations');
    await expect(
      page.getByText('No team organizations yet', { exact: true }),
    ).toBeVisible();
    // The retired provisioning URL lands on the provisioning-filtered list.
    await page.goto(stack.frontendUrl + '/platform/provisioning');
    await expect(page).toHaveURL(
      /\/platform\/organizations\?state=provisioning$/,
    );
    await expect(page.locator('h1')).toHaveText('Organizations');
    await expect(
      page.getByText('No organizations match these filters', {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await page.unroute(emptyList);
  }

  // The list request is held by a gated route, then released.
  const list = await gateRequests(page, listUrl);
  try {
    await page.reload();
    await list.started;
    await expect(
      page.getByRole('status', { name: 'Loading organizations' }),
    ).toBeVisible();
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
        page.getByText('We could not load organizations.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await expect(page.locator('body')).not.toContainText(
      'private platform detail',
    );
  } finally {
    await page.unroute(failingList);
  }

  // The provisioning list shows every organization the world provisioned.
  await reauthenticatePlatform(page, world);
  await page.goto(organizations + '?state=provisioning');
  for (const organization of provisioningOrganizations)
    await expect(
      page.getByLabel(`Open ${organization.name}`, { exact: true }),
    ).toBeVisible();

  // The invitation expiry is the only time-dependent value on the record.
  const detailPath = `/api/platform/organizations/${world.harborId}`;
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
      .getByLabel('Open Harbor Legal Partners', { exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/platform/organizations/${world.harborId}$`),
    );
    await expect(
      page.getByRole('button', { name: 'Resend invitation' }),
    ).toBeVisible();
    const expires = page.locator('[data-slot="stat-tile"]', {
      hasText: 'Expires',
    });
    await expect(expires).toContainText('21 Nov 2026');
    await expect(expires).toContainText('11:00');
  } finally {
    await page.unroute(detailUrl);
  }

  await reauthenticatePlatform(page, world);
  await page.goto(stack.frontendUrl + '/platform/accounts');
  await expect(page.locator('h1')).toHaveText('Accounts');
  await expect(page.getByRole('tab', { name: /^Invitations/ })).toBeVisible();
  await page
    .getByLabel('Search by name or email', { exact: true })
    .fill(platformAdmin.name);
  await expect(
    page.getByLabel(`Open ${platformAdmin.name}`, { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByLabel('User ID')).toHaveCount(0);
});
