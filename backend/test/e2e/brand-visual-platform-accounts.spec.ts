import { expect, test, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import {
  brandFixedTime,
  captureBrandViews,
  hideDevOverlayOnLoad,
} from './brand-visual-support.js';
import { gateRequests, gateStarted } from './brand-visual-world.js';
import { waitForHydration } from './identity-support.js';
import { openMenuReliably } from './visual-support.js';
import { platformWorld } from './brand-visual-platform-world.js';
import { installPlatformConsoleNormalization } from './brand-visual-platform-normalizations.js';
import { platformInvitee } from './prototype-fixtures.js';

// F4.1 visual set, platform accounts group (revision 16): the Accounts list
// and its states, the Invitations tab and the invite dialog, and the account
// record pages, for a real platform administrator. Content is the
// prototype's (brand-visual-platform-normalizations.ts). The prototype pages
// show ten rows per page, so the lists open with ?pageSize=10.

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

const accountsUrl = () => descriptor().frontendUrl + '/platform/accounts';
const searchBox = (page: Page) =>
  page.getByLabel('Search by name or email', { exact: true });

async function openAccounts(page: Page, query = '?pageSize=10') {
  await page.clock.setFixedTime(brandFixedTime);
  await page.goto(accountsUrl() + query);
  await expect(page.locator('h1')).toHaveText('Accounts');
  await expect(
    page.getByRole('tab', { name: /^Accounts\s*248/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('tab', { name: /^Invitations\s*2/ }),
  ).toBeVisible();
}

async function search(page: Page, value: string) {
  const box = searchBox(page);
  await waitForHydration(box);
  await box.fill(value);
  // The query reaches the URL after a debounce.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('query'))
    .toBe(value);
}

const footer = (page: Page, text: string) =>
  page.locator('[data-slot="paged-footer"]').getByText(text, { exact: true });

/** Rows per page 10, chosen in the footer (desktop only shows the select). */
async function chooseTenRows(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const select = page.getByRole('combobox', { name: 'Rows per page' });
  await waitForHydration(select);
  await select.click();
  await page.getByRole('option', { name: '10', exact: true }).click();
}

test('Accounts list states', async ({ page, playwright }) => {
  test.setTimeout(420_000);
  const world = await platformWorld(page, playwright);
  normalized = await installPlatformConsoleNormalization(page, world);

  await openAccounts(page);
  await captureBrandViews(page, 'platform-accounts', {
    open: async () => {
      await expect(
        page.getByLabel('Open Ayu Wardani', { exact: true }),
      ).toBeVisible();
      await expect(footer(page, '248 accounts')).toBeVisible();
    },
  });

  // Search applied: the four hukum-nusantara.co.id accounts, Reset shown.
  await search(page, 'hukum-nusantara');
  await expect(footer(page, '4 accounts')).toBeVisible();
  await captureBrandViews(page, 'platform-accounts-search', {
    keepFocus: true,
    open: async () => {
      await expect(
        page.getByLabel('Open Lina Hartono', { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
      await searchBox(page).focus();
    },
  });

  await search(page, 'notaris');
  await captureBrandViews(page, 'platform-accounts-no-results', {
    keepFocus: true,
    open: async () => {
      await expect(
        page.getByText('No accounts match “notaris”', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Reset filters' }),
      ).toBeVisible();
      await searchBox(page).focus();
    },
  });

  // Status facet: Unverified and Disabled, the list open as in the prototype.
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('query'))
    .toBeNull();
  await expect(footer(page, '248 accounts')).toBeVisible();
  const statusFacet = page.getByRole('button', { name: /^Status/ });
  await openMenuReliably(
    page,
    statusFacet,
    page.getByRole('menuitemcheckbox', { name: 'Unverified' }),
    'status facet',
  );
  await page.getByRole('menuitemcheckbox', { name: 'Unverified' }).click();
  // Each choice builds on the facets in the URL: wait for the first one to
  // land before the second (two clicks in one render lost "unverified").
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll('status'))
    .toEqual(['unverified']);
  await page.getByRole('menuitemcheckbox', { name: 'Disabled' }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll('status'))
    .toEqual(['unverified', 'disabled']);
  await expect(footer(page, '2 accounts')).toBeVisible();
  await captureBrandViews(page, 'platform-accounts-filtered', {
    keepFocus: true,
    open: async () => {
      await openMenuReliably(
        page,
        statusFacet,
        page.getByRole('menuitemcheckbox', { name: 'Disabled' }),
        'status facet',
      );
      await expect(
        page.getByRole('menuitemcheckbox', { name: 'Unverified' }),
      ).toBeChecked();
      await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
    },
  });

  // The row menu of Ayu Wardani, as the prototype's: View account, a
  // separator, Sign out everywhere, Disable account (destructive, last).
  // On mobile the prototype's state shows every row's menu button and no
  // open menu (its open menu is part of the desktop table cell only), so the
  // mobile capture shows the buttons, menu closed. The relative Last active
  // values come from the fixed clock (prototype-fixtures.ts `lastActive`).
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(footer(page, '248 accounts')).toBeVisible();
  await expect(
    page.getByRole('main').getByText('2 days ago', { exact: true }).first(),
  ).toBeVisible();
  await captureBrandViews(page, 'platform-accounts-row-menu', {
    keepFocus: true,
    open: async (viewport) => {
      await expect(
        page.getByLabel('Open Ayu Wardani', { exact: true }),
      ).toBeVisible();
      if (viewport === 'desktop') {
        await openMenuReliably(
          page,
          page.getByRole('button', { name: 'Actions for Ayu Wardani' }),
          page.getByRole('menuitem', { name: 'Disable account' }),
          'account row menu',
        );
        await expect(page.getByRole('menuitem')).toHaveText([
          'View account',
          'Sign out everywhere',
          'Disable account',
        ]);
        await expect(page.getByRole('menu').getByRole('separator')).toHaveCount(
          1,
        );
      } else {
        await expect(
          page.getByRole('button', { name: 'Actions for Ayu Wardani' }),
        ).toBeVisible();
        await expect(page.getByRole('menu')).toHaveCount(0);
      }
    },
    close: async (viewport) => {
      if (viewport !== 'desktop') return;
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
    },
  });

  // Loading and failure: the tab counts are loaded first (default page
  // size), then Rows per page 10 starts the held or failing list request.
  const tenRows = (url: URL, method: string) =>
    url.pathname === '/api/platform/accounts' &&
    url.searchParams.get('pageSize') === '10' &&
    (method === 'GET' || method === '');
  await openAccounts(page, '');
  await expect(footer(page, '248 accounts')).toBeVisible();
  const list = await gateRequests(page, tenRows);
  try {
    await chooseTenRows(page);
    await gateStarted(list, 'platform-accounts-loading');
    await captureBrandViews(page, 'platform-accounts-loading', {
      open: () =>
        expect(
          page.getByRole('status', { name: 'Loading accounts' }),
        ).toBeVisible(),
    });
  } finally {
    await list.finish();
  }

  await openAccounts(page, '');
  await expect(footer(page, '248 accounts')).toBeVisible();
  const failing = (url: URL) => tenRows(url, 'GET');
  await page.route(failing, (route) =>
    route.request().method() !== 'GET'
      ? route.fallback()
      : route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"private platform detail"}',
        }),
  );
  try {
    await chooseTenRows(page);
    await expect(
      page.getByText('We could not load accounts.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      'private platform detail',
    );
    await captureBrandViews(page, 'platform-accounts-error', {
      open: () =>
        expect(page.getByRole('button', { name: 'Try again' })).toBeVisible(),
    });
  } finally {
    await page.unroute(failing);
  }
});

test('Invitations tab and the invite dialog', async ({ page, playwright }) => {
  test.setTimeout(300_000);
  const world = await platformWorld(page, playwright);
  normalized = await installPlatformConsoleNormalization(page, world);

  await openAccounts(page, '?tab=invitations&pageSize=10');
  await expect(page.getByRole('tab', { name: /^Invitations/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await captureBrandViews(page, 'platform-accounts-invitations', {
    open: async (viewport) => {
      await expect(
        page.getByRole('main').getByText('joko.santosa@gmail.com').first(),
      ).toBeVisible();
      await expect(footer(page, '2 invitations')).toBeVisible();
      // The prototype's mobile invitation row meta.
      if (viewport === 'mobile')
        await expect(
          page.getByText('Sent 19 Nov 2026 · Expires 26 Nov 2026', {
            exact: true,
          }),
        ).toBeVisible();
    },
  });

  // The dialog over the Accounts list, filled as in the prototype; nothing
  // is sent.
  await openAccounts(page);
  await expect(footer(page, '248 accounts')).toBeVisible();
  const invite = page.getByRole('button', { name: 'Invite account' });
  await waitForHydration(invite);
  await invite.click();
  const dialog = page.getByRole('dialog', { name: 'Invite someone to Lexon' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('textbox', { name: /^Email/ })
    .fill(platformInvitee.email);
  await dialog
    .getByRole('textbox', { name: /^Name/ })
    .fill(platformInvitee.name);
  await captureBrandViews(page, 'platform-account-invite', {
    keepFocus: true,
    open: async () => {
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Send invitation' }),
      ).toBeEnabled();
    },
  });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

/** Opens an account record from the normalized Accounts list. */
async function openRecord(page: Page, name: string) {
  await openAccounts(page);
  const row = page.getByLabel(`Open ${name}`, { exact: true });
  await waitForHydration(row);
  await row.click();
  await expect(page).toHaveURL(/\/platform\/accounts\/[0-9a-f-]{36}$/);
  await expect(page.locator('h1')).toHaveText(name);
}

test('Account record pages and their confirmations', async ({
  page,
  playwright,
}) => {
  test.setTimeout(420_000);
  const world = await platformWorld(page, playwright);
  normalized = await installPlatformConsoleNormalization(page, world);

  await openRecord(page, 'Ayu Wardani');
  const signOut = page.getByRole('button', { name: 'Sign out everywhere' });
  const disable = page.getByRole('button', { name: 'Disable account' });
  await captureBrandViews(page, 'platform-account-detail', {
    open: async () => {
      await expect(
        page.getByText('Last active today', { exact: true }),
      ).toBeVisible();
      await expect(signOut).toBeVisible();
      await expect(disable).toBeVisible();
      await expect(page.getByText('Pro Bono Clinic').first()).toBeVisible();
    },
  });

  // The confirmations open from the header and are cancelled; nothing runs.
  const disableDialog = page.getByRole('alertdialog', {
    name: 'Disable Ayu Wardani’s account?',
  });
  await waitForHydration(disable);
  await disable.click();
  await expect(disableDialog).toBeVisible();
  await expect(disableDialog).toContainText(
    'Ayu Wardani is signed out everywhere and cannot sign in until you enable the account again. Their teams and content stay unchanged.',
  );
  await captureBrandViews(page, 'platform-account-disable', {
    keepFocus: true,
    open: () => expect(disableDialog).toBeVisible(),
  });
  await disableDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(disableDialog).toHaveCount(0);

  const signOutDialog = page.getByRole('alertdialog', {
    name: 'Sign Ayu Wardani out everywhere?',
  });
  await signOut.click();
  await expect(signOutDialog).toBeVisible();
  await expect(signOutDialog).toContainText(
    'All 3 sessions end on every device, including apps signed in with a token. Ayu Wardani can sign in again.',
  );
  await captureBrandViews(page, 'platform-account-sign-out', {
    keepFocus: true,
    open: () => expect(signOutDialog).toBeVisible(),
  });
  await signOutDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(signOutDialog).toHaveCount(0);

  await openRecord(page, 'Bagus Santoso');
  await captureBrandViews(page, 'platform-account-unverified', {
    open: () =>
      expect(
        page.getByRole('button', { name: 'Resend verification email' }),
      ).toBeVisible(),
  });

  await openRecord(page, 'Lina Hartono');
  await captureBrandViews(page, 'platform-account-disabled', {
    open: async () => {
      await expect(
        page.getByRole('button', { name: 'Enable account' }),
      ).toBeVisible();
      await expect(
        page.getByText('Signed out when disabled', { exact: true }),
      ).toBeVisible();
    },
  });
});
