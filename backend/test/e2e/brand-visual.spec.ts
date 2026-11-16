import { expect, test, type Locator, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import {
  captureBrandViews,
  brandFixedTime,
  type BrandViewport,
} from './brand-visual-support.js';
import {
  installTask9InvitationExpiryNormalization,
  installTask9MemberOrderNormalization,
  installTask9SessionExpiryNormalization,
  openMenuReliably,
} from './visual-support.js';

// The F4.1 visual set. Every state is captured in light and dark at
// 1440×900 and 390×844; docs/references/F4.1-visual/index.json lists them.

test('sign-in states', async ({ page }) => {
  const base = descriptor().frontendUrl;
  await page.goto(base + '/sign-in');
  await expect(
    page.getByRole('heading', { name: 'Sign in to Lexon' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await captureBrandViews(page, 'sign-in');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await captureBrandViews(page, 'sign-in-field-errors');

  await page
    .getByLabel('Email', { exact: true })
    .fill('synthetic-review@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Synthetic-review-password-42!');
  // The sign-in request is held by a gated route, so the pending state is
  // open for as long as the captures need and never depends on a timer.
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((done) => (markStarted = done));
  const gate = new Promise<void>((done) => (release = done));
  await page.route('**/api/auth/sign-in/email', async (route) => {
    markStarted();
    await gate;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'AUTH_REQUIRED', message: 'Synthetic server detail' },
      }),
    });
  });
  try {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await started;
    await expect(
      page.getByRole('button', { name: 'Signing in…' }),
    ).toBeDisabled();
    await captureBrandViews(page, 'sign-in-pending');
    release();
    await expect(page.locator('[data-slot="alert"]')).toContainText(
      'Email or password is incorrect. Check them and try again.',
    );
    await expect(page.locator('body')).not.toContainText(
      'Synthetic server detail',
    );
    await captureBrandViews(page, 'sign-in-form-alert');
  } finally {
    release();
    await page.unroute('**/api/auth/sign-in/email');
  }
});

test('sign-up and secondary account flows', async ({ page }) => {
  const base = descriptor().frontendUrl;
  const visit = async (state: string, path: string, heading?: string) => {
    const response = await page.goto(base + path);
    expect(response?.status(), state).toBe(200);
    await expect(page.locator('main'), state).toHaveCount(1);
    await expect(page.locator('h1'), state).toHaveCount(1);
    if (heading)
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  };
  await visit('sign-up', '/sign-up', 'Create your account');
  await captureBrandViews(page, 'sign-up');
  await visit('forgot-password', '/forgot-password');
  await captureBrandViews(page, 'forgot-password');
  await visit('reset-password', '/reset-password');
  await captureBrandViews(page, 'reset-password');
  await visit('verify-email', '/verify-email?state=pending');
  await captureBrandViews(page, 'verify-email');
  await visit('two-factor', '/two-factor');
  await captureBrandViews(page, 'two-factor');
  await visit('accept-invitation', '/accept-invitation?invitationId=invalid');
  await captureBrandViews(page, 'accept-invitation');
  await visit('admin-setup', '/admin-setup');
  await captureBrandViews(page, 'admin-setup');
});

test('onboarding for a real API-created identity', async ({ page }) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, {
    name: 'Brand Preview',
  });
  const profile = await page.request.patch(
    stack.apiUrl + '/api/identity/profile',
    { headers, data: { name: 'Brand Preview' } },
  );
  expect(profile.status()).toBe(200);
  await page.goto(stack.frontendUrl + '/onboarding');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Lexon' }),
  ).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Brand Preview');
  await captureBrandViews(page, 'onboarding');
});

const userTrigger = (page: Page) =>
  page.locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]');
const organizationTrigger = (page: Page) =>
  page.locator('[data-slot="sidebar-header"] button[aria-haspopup="menu"]');

/** Waits until the mobile sheet has moved focus inside, then drops it. */
async function settleMobileSheet(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Sidebar' });
  await expect(sheet).toBeVisible();
  await expect
    .poll(() =>
      sheet.evaluate((dialog) => dialog.contains(document.activeElement)),
    )
    .toBe(true);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
}

async function openMobileSheet(page: Page) {
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await settleMobileSheet(page);
}

async function closeMobileSheet(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeHidden();
}

async function prepareIdentity(
  page: Page,
  fixture: { name: string; email?: string; password?: string },
  jobTitle: string,
) {
  const stack = descriptor();
  const headers = await authenticateApi(page.request, fixture);
  const profile = await page.request.patch(
    stack.apiUrl + '/api/identity/profile',
    { headers, data: { name: fixture.name, jobTitle } },
  );
  expect(profile.status()).toBe(200);
  expect(
    (
      await page.request.post(
        stack.apiUrl + '/api/identity/onboarding/complete',
        { headers, data: {} },
      )
    ).status(),
  ).toBe(204);
  return { stack, headers };
}

async function gotoWorkspace(page: Page, firstName: string) {
  const stack = descriptor();
  await page.clock.setFixedTime(brandFixedTime);
  const response = await page.goto(stack.frontendUrl + '/workspace');
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', {
      name: `Good morning, ${firstName}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
}

/** Resting page: desktop shows the expanded sidebar, mobile the closed one. */
async function expectResting(page: Page, viewport: BrandViewport) {
  if (viewport === 'desktop')
    await expect(
      page.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeVisible();
  else
    await expect(
      page.getByRole('button', { name: 'Open navigation' }),
    ).toBeVisible();
}

async function openUserMenu(page: Page, viewport: BrandViewport) {
  if (viewport === 'mobile') await openMobileSheet(page);
  await openMenuReliably(
    page,
    userTrigger(page),
    page.getByRole('menuitem', { name: 'Sign out' }),
    'user menu',
  );
}

async function closeMenu(page: Page, viewport: BrandViewport) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  if (viewport === 'mobile') await closeMobileSheet(page);
}

test('shell in the Personal workspace and the collapsed sidebar', async ({
  page,
}) => {
  await prepareIdentity(page, { name: 'Ayu Wardani' }, 'Senior Associate');
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

test('team shell, menus, mobile sheet, and Settings', async ({
  page,
  playwright,
}) => {
  test.setTimeout(230_000);
  const password = 'Maya-review-password-42!';
  const { stack, headers } = await prepareIdentity(
    page,
    {
      name: 'Maya Chen',
      email: 'maya.chen@example.test',
      password,
    },
    'Senior Associate',
  );
  const teamResponse = await page.request.post(
    stack.apiUrl + '/api/organizations',
    { headers, data: { name: 'Harbor Legal', slug: 'harbor-legal-review' } },
  );
  expect(teamResponse.status()).toBe(201);
  const team = (await teamResponse.json()) as { id: string };
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/organizations/active', {
        headers,
        data: { organizationId: team.id },
      })
    ).status(),
  ).toBe(200);
  for (const invitee of [
    { name: 'Alex Rivera', email: 'alex.rivera@example.test', role: 'member' },
    { name: 'Jordan Lee', email: 'jordan.lee@example.test', role: 'admin' },
  ] as const) {
    const invitation = await page.request.post(
      stack.apiUrl + `/api/organizations/${team.id}/invitations`,
      { headers, data: { email: invitee.email, role: invitee.role } },
    );
    expect(invitation.status()).toBe(201);
    const { id } = (await invitation.json()) as { id: string };
    const recipient = await playwright.request.newContext();
    try {
      const recipientHeaders = await authenticateApi(recipient, {
        name: invitee.name,
        email: invitee.email,
      });
      expect(
        (
          await recipient.post(stack.apiUrl + `/api/invitations/${id}/accept`, {
            headers: recipientHeaders,
            data: {},
          })
        ).status(),
      ).toBe(200);
    } finally {
      await recipient.dispose();
    }
  }
  expect(
    (
      await page.request.post(
        stack.apiUrl + `/api/organizations/${team.id}/invitations`,
        {
          headers,
          data: { email: 'sam.taylor@example.test', role: 'member' },
        },
      )
    ).status(),
  ).toBe(201);

  await gotoWorkspace(page, 'Maya');
  await expect(
    page.getByRole('button', { name: /Organization: Harbor Legal/ }),
  ).toBeVisible();

  await captureBrandViews(page, 'shell-team', {
    open: (viewport) => expectResting(page, viewport),
  });

  await captureBrandViews(page, 'organization-switcher-open', {
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
    open: (viewport) => openUserMenu(page, viewport),
    close: (viewport) => closeMenu(page, viewport),
  });

  await captureBrandViews(page, 'mobile-sheet-open', {
    open: async (viewport) => {
      if (viewport === 'mobile') await openMobileSheet(page);
      else await expectResting(page, viewport);
    },
    close: async (viewport) => {
      if (viewport === 'mobile') await closeMobileSheet(page);
    },
  });

  const settingsHooks = (link: string, ready: (page: Page) => Locator) => ({
    open: async (viewport: BrandViewport) => {
      await openUserMenu(page, viewport);
      await page.getByRole('menuitem', { name: /^Settings/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: link, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`settings=${link.toLowerCase()}$`),
      );
      await expect(ready(page)).toBeVisible();
      await expect(
        page.getByRole('status', { name: 'Loading sessions' }),
      ).toHaveCount(0);
      // Settle the dialog's animations and control transitions, then wait
      // until the layout of every control has been still for 12 frames.
      await dialog.evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined)),
        );
        const frame = () =>
          new Promise<void>((done) => requestAnimationFrame(() => done()));
        const layout = () =>
          [element, ...element.querySelectorAll('button, [role="radio"]')]
            .map((node) => {
              const r = node.getBoundingClientRect();
              return `${r.x},${r.y},${r.width},${r.height}`;
            })
            .join('|');
        let still = 0;
        let last = layout();
        for (let tries = 0; still < 12 && tries < 300; tries++) {
          await frame();
          const next = layout();
          still = next === last ? still + 1 : 0;
          last = next;
        }
      });
    },
    close: async (viewport: BrandViewport) => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
      await expect(page).toHaveURL(/\/workspace$/);
      await expectResting(page, viewport);
    },
  });

  await captureBrandViews(
    page,
    'settings-profile',
    settingsHooks('Profile', (p) => p.getByLabel('Job title')),
  );
  await captureBrandViews(
    page,
    'settings-appearance',
    settingsHooks('Appearance', (p) => p.getByRole('radio', { name: 'Dark' })),
  );
  const sessions = await installTask9SessionExpiryNormalization(page);
  try {
    await captureBrandViews(
      page,
      'settings-security',
      settingsHooks('Security', (p) =>
        p.getByRole('table', { name: 'Signed-in sessions' }),
      ),
    );
  } finally {
    await sessions.remove();
  }
  const members = await installTask9MemberOrderNormalization(page, team.id);
  try {
    await captureBrandViews(
      page,
      'settings-members',
      settingsHooks('Members', (p) =>
        p.getByText('alex.rivera@example.test', { exact: true }),
      ),
    );
  } finally {
    await members.remove();
  }
  const invitations = await installTask9InvitationExpiryNormalization(
    page,
    team.id,
  );
  try {
    await captureBrandViews(
      page,
      'settings-invitations',
      settingsHooks('Invitations', (p) =>
        p.getByText('sam.taylor@example.test', { exact: true }),
      ),
    );
  } finally {
    await invitations.remove();
  }
  await captureBrandViews(
    page,
    'settings-general',
    settingsHooks('General', (p) =>
      p.getByRole('heading', { name: 'General', exact: true }),
    ),
  );
});
