import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi, readCapturedMail } from './identity-support.js';
import { operatorSetup, signupMode } from './setup-support.js';
import { totpForUri } from '../setup/totp.js';
import { ChatTreeSchema, type ChatMessage } from '@lexon/contracts';
import {
  activeRunFrames,
  answer,
  assistantMessage,
  assistantMessageId,
  chatId,
  deepThinkingQuestion,
  expectSolidDestructiveButton,
  fileNames,
  installChatFixtures,
  installRunStreamFixture,
  reasoning,
  runId,
  timestamp,
  userMessage,
  userMessageId,
} from './chat-state-fixtures.js';
import {
  brandViewId,
  isBrandViewPixelLocked,
  isBrandViewSvgSnapshotted,
  snapshotIndicatorSvg,
  assertSvgSnapshotsMatched,
  runBrandAxe,
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
    .fill('synthetic-review.bv@example.test');
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
      email: 'maya.chen.bv@example.test',
      password,
    },
    'Senior Associate',
  );
  const teamResponse = await page.request.post(
    stack.apiUrl + '/api/organizations',
    { headers, data: { name: 'Harbor Legal', slug: 'harbor-legal-review-bv' } },
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
    {
      name: 'Alex Rivera',
      email: 'alex.rivera.bv@example.test',
      role: 'member',
    },
    { name: 'Jordan Lee', email: 'jordan.lee.bv@example.test', role: 'admin' },
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
          data: { email: 'sam.taylor.bv@example.test', role: 'member' },
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
  const members = await installTask9MemberOrderNormalization(page, team.id, [
    'maya.chen.bv@example.test',
    'jordan.lee.bv@example.test',
    'alex.rivera.bv@example.test',
  ]);
  try {
    await captureBrandViews(
      page,
      'settings-members',
      settingsHooks('Members', (p) =>
        p.getByText('alex.rivera.bv@example.test', { exact: true }),
      ),
    );
  } finally {
    await members.remove();
  }
  const invitations = await installTask9InvitationExpiryNormalization(
    page,
    team.id,
    [
      'sam.taylor.bv@example.test',
      'alex.rivera.bv@example.test',
      'jordan.lee.bv@example.test',
    ],
  );
  try {
    await captureBrandViews(
      page,
      'settings-invitations',
      settingsHooks('Invitations', (p) =>
        p.getByText('sam.taylor.bv@example.test', { exact: true }),
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

// Platform, errors, and UI patterns.

let restoreSignupModeAfterTest = false;
test.afterEach(async () => {
  if (!restoreSignupModeAfterTest) return;
  restoreSignupModeAfterTest = false;
  await signupMode(true);
});

/**
 * Holds every request matching `matches` until `release()` is called. The
 * route is removed by its own matcher, after every held request has finished,
 * so no other route is touched.
 */
async function gateRequests(
  page: Page,
  matches: (url: URL, method: string) => boolean,
) {
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((done) => (markStarted = done));
  const gate = new Promise<void>((done) => (release = done));
  const held = new Set<Promise<void>>();
  const matcher = (url: URL) => matches(url, '');
  await page.route(matcher, (route) => {
    if (!matches(new URL(route.request().url()), route.request().method()))
      return route.fallback();
    markStarted();
    const request = (async () => {
      await gate;
      await route.continue();
    })();
    held.add(request);
    return request;
  });
  return {
    started,
    release,
    async finish() {
      release();
      await Promise.all([...held]);
      await page.unroute(matcher);
    },
  };
}

const chatListRequest = (url: URL, method: string) =>
  url.pathname === '/api/chats' && (method === 'GET' || method === '');

test('chats empty and loading lists, access denied, and not-found pages', async ({
  page,
}) => {
  const stack = descriptor();
  await prepareIdentity(page, { name: 'Ayu Wardani' }, 'Senior Associate');
  await page.clock.setFixedTime(brandFixedTime);

  await page.goto(stack.frontendUrl + '/chats');
  await expect(page.getByText('No chats yet', { exact: true })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  await captureBrandViews(page, 'chats-empty');

  // The list request is held by a gated route, so the loading state stays
  // open for as long as the captures need and never depends on a timer.
  const list = await gateRequests(page, chatListRequest);
  try {
    await page.goto(stack.frontendUrl + '/chats');
    await list.started;
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading chats…' }),
    ).toBeVisible();
    await captureBrandViews(page, 'chats-loading');
  } finally {
    await list.finish();
  }

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
  await prepareIdentity(page, { name: 'Ayu Wardani' }, 'Senior Associate');
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
                  title: 'Force majeure clause review',
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

test('toast after a saved profile', async ({ page }) => {
  const stack = descriptor();
  await prepareIdentity(
    page,
    { name: 'Ayu Wardani', email: 'ayu.wardani@example.test' },
    'Senior Associate',
  );
  // The clock is paused (not raced) so the toast cannot time out: nothing
  // advances it except the small runFor steps below.
  await page.clock.install({ time: new Date(brandFixedTime) });
  await page.goto(stack.frontendUrl + '/workspace?settings=profile');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Job title')).toHaveValue('Senior Associate');
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const save = await gateRequests(
    page,
    (url, method) =>
      url.pathname === '/api/identity/profile' &&
      (method === 'PATCH' || method === ''),
  );
  try {
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await save.started;
    // Pause 100 ms ahead of the page's own clock: the held save request is
    // in flight, and a larger jump would fire the client's request timeout.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(new Date(now + 100));
    save.release();
    const toast = page.locator('[data-sonner-toast]');
    await expect
      .poll(async () => {
        await page.clock.runFor(50);
        return toast.count();
      })
      .toBe(1);
    await expect(toast).toContainText('Changes saved.');
    // axe finishes its rules through zero-delay timers, so the paused clock
    // is stepped one millisecond at a time while the captures run. The fake
    // time that passes is the step count, bounded far below the 4 s toast
    // lifetime, so no real-time race is involved.
    let stepping = true;
    let steps = 0;
    const stepper = (async () => {
      while (stepping) {
        await page.clock.runFor(1);
        steps++;
        await new Promise((done) => setTimeout(done, 5));
      }
    })();
    try {
      await captureBrandViews(page, 'toast-success');
    } finally {
      stepping = false;
      await stepper;
    }
    expect(
      steps,
      'fake milliseconds advanced during the captures',
    ).toBeLessThan(3000);
    await expect(toast).toContainText('Changes saved.');
  } finally {
    await save.finish();
  }
});

test('Platform pages for a real platform administrator', async ({ page }) => {
  test.setTimeout(230_000);
  const stack = descriptor();
  const email = 'brand.operator@example.test';
  const password = 'Brand-operator-42!';
  await signupMode(false);
  restoreSignupModeAfterTest = true;
  const setup = await operatorSetup(email, true);
  expect(setup.status).toBe('created');
  await page.goto(setup.mail!.actionUrl);
  await page
    .getByRole('button', { name: 'Create setup account', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Brand Operator');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();
  await page.goto(
    (await readCapturedMail(stack.project, email, 'verification')).actionUrl,
  );
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const signedIn = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/sign-in/email' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(page).toHaveURL(/admin-setup/);
  await page.getByLabel('Enrollment password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Set up authenticator', exact: true })
    .click();
  const uri = await page.getByTestId('authenticator-uri').textContent();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totpForUri(uri!));
  await page
    .getByRole('button', { name: 'Verify authenticator', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'I saved my recovery codes', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Activate platform administrator',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Administrator setup complete' }),
  ).toBeVisible();
  expect(
    (
      await page.request.post(
        stack.apiUrl + '/api/identity/onboarding/complete',
        { headers: { origin: stack.frontendUrl }, data: {} },
      )
    ).status(),
  ).toBe(204);
  await page.clock.setFixedTime(brandFixedTime);

  const listUrl = (url: URL, method: string) =>
    url.pathname === '/api/platform/provisioning' &&
    url.searchParams.has('limit') &&
    (method === 'GET' || method === '');
  const provisioning = stack.frontendUrl + '/platform/provisioning';

  // The empty list: nothing has been provisioned yet.
  await page.goto(provisioning);
  await expect(page.locator('h1')).toHaveText('Organization provisioning');
  await expect(
    page.getByText('No provisioning organizations', { exact: true }),
  ).toBeVisible();
  await captureBrandViews(page, 'platform-provisioning-empty');

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

  const created = await page.request.post(
    stack.apiUrl + '/api/platform/provisioning',
    {
      headers: { origin: stack.frontendUrl },
      data: {
        name: 'Harbor Legal Partners',
        slug: 'harbor-legal-partners-review',
        ownerEmail: 'first.owner@example.test',
      },
    },
  );
  expect(created.status()).toBe(201);
  const organization = (await created.json()) as { id: string };
  await page.goto(provisioning);
  await expect(
    page.getByRole('link', { name: 'Harbor Legal Partners', exact: true }),
  ).toBeVisible();
  await captureBrandViews(page, 'platform-provisioning-populated');

  // The invitation expiry is the only time-dependent value on the detail page.
  const detailPath = `/api/platform/provisioning/${organization.id}`;
  const detailUrl = (url: URL) => url.pathname === detailPath;
  await page.route(detailUrl, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as {
      invitation: { expiresAt: string };
    };
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
      page.getByText('Nov 21, 2026', { exact: false }),
    ).toBeVisible();
    await captureBrandViews(page, 'platform-provisioning-detail');
  } finally {
    await page.unroute(detailUrl);
  }

  await page.goto(stack.frontendUrl + '/platform/accounts');
  await expect(page.getByLabel('User ID')).toBeVisible();
  await captureBrandViews(page, 'platform-accounts');
});

// Chat states. The chat API and the run stream are the deterministic fixtures
// of the F4 chat states (chat-state-fixtures.ts); the shell, the auth, and the
// organization are real. The thinking indicator animates, so these states run
// with reduced motion (the project default), which shows the static mark.

type ChatEnv = { stack: ReturnType<typeof descriptor>; state: string };

async function startChatStates(page: Page): Promise<ChatEnv> {
  const { stack } = await prepareIdentity(
    page,
    { name: 'Ayu Wardani' },
    'Senior Associate',
  );
  const env: ChatEnv = { stack, state: 'new-chat' };
  await installChatFixtures(
    page,
    () => env.state,
    () => undefined,
  );
  await installRunStreamFixture(page);
  // The theme is stored per origin, so the page is on the app before the
  // first capture applies it.
  await gotoWorkspace(page, 'Ayu');
  return env;
}

const messageOf = (page: Page, id: string) =>
  page.locator(`[data-message-id="${id}"]`);

async function settleAnimations(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/**
 * Parks the pointer, closes any hover tooltip, lets every animation finish,
 * and waits until the layout has been still for 20 frames, so the capture
 * does not depend on where a transition or an autosizing field is.
 */
async function calm(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  await settleAnimations(page);
  await page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((done) => requestAnimationFrame(() => done()));
    const layout = () =>
      [...document.querySelectorAll('button, textarea, input, mark, main')]
        .map((node) => {
          const r = node.getBoundingClientRect();
          return `${r.x},${r.y},${r.width},${r.height}`;
        })
        .join('|');
    let still = 0;
    let last = layout();
    for (let tries = 0; still < 20 && tries < 300; tries++) {
      await frame();
      const next = layout();
      still = next === last ? still + 1 : 0;
      last = next;
    }
  });
}

async function openThread(
  page: Page,
  env: ChatEnv,
  state: string,
  ready: Locator,
  query = '',
) {
  env.state = state;
  await page.clock.setFixedTime(brandFixedTime);
  const response = await page.goto(
    `${env.stack.frontendUrl}/chats/${chatId}${query}`,
  );
  expect(response?.status()).toBe(200);
  await expect(ready).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
}

const reasoningToggle = (page: Page, label: string) =>
  page.getByRole('button', { name: label });
const answerStart = answer.slice(0, 50);

test('new chat, Deep thinking, and a starter prompt', async ({ page }) => {
  await startChatStates(page);
  const openNewChat = async (viewport: BrandViewport) => {
    await gotoWorkspace(page, 'Ayu');
    await expectResting(page, viewport);
    if (viewport === 'desktop')
      await expect(
        page
          .getByRole('group', { name: 'Recent chats' })
          .getByRole('link', { name: fileNames.default, exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Starter prompts' }),
    ).toBeVisible();
  };
  await captureBrandViews(page, 'chat-new', { open: openNewChat });

  await captureBrandViews(page, 'chat-deep-thinking', {
    open: async (viewport) => {
      await openNewChat(viewport);
      await page
        .getByRole('textbox', { name: 'Message input' })
        .fill(deepThinkingQuestion);
      const toggle = page.getByRole('button', { name: 'Deep thinking' });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await calm(page);
    },
  });

  const template =
    'Explain Article [number] of [law or regulation] in plain language.';
  await captureBrandViews(page, 'chat-starter-pill', {
    open: async (viewport) => {
      await openNewChat(viewport);
      await page
        .getByRole('group', { name: 'Starter prompts' })
        .getByRole('button', { name: 'Explain an article', exact: true })
        .click();
      const input = page.getByRole('textbox', { name: 'Message input' });
      await expect(input).toHaveValue(template);
      await expect(input).toBeFocused();
      await calm(page);
    },
  });
});

test('completed answers, editing, branches, stopped, and failed runs', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page);
  const answerShown = page.getByText(answerStart);
  const thought = 'Thought for 14 seconds';
  const openAnswer = async () => {
    await openThread(page, env, 'answer-complete', answerShown);
    await expect(reasoningToggle(page, thought)).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  };

  await captureBrandViews(page, 'chat-reasoning-collapsed', {
    open: openAnswer,
  });

  await captureBrandViews(page, 'chat-reasoning-open', {
    open: async () => {
      await openAnswer();
      await reasoningToggle(page, thought).click();
      await expect(reasoningToggle(page, thought)).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(page.getByText(reasoning)).toBeVisible();
      await settleAnimations(page);
    },
  });

  // The action bar shows on hover or focus; focus keeps it open after the
  // capture step moves the pointer away.
  await captureBrandViews(page, 'chat-answer-actions', {
    open: async () => {
      await openAnswer();
      const copy = page.getByRole('button', { name: 'Copy answer' });
      await copy.focus();
      await expect(copy).toBeFocused();
      await expect(page.locator('[data-slot="aui_message-actions"]')).toHaveCSS(
        'opacity',
        '1',
      );
    },
  });

  await captureBrandViews(page, 'chat-edit', {
    open: async () => {
      await openAnswer();
      const message = messageOf(page, userMessageId);
      await message.getByRole('button', { name: 'Edit message' }).click();
      await expect(
        page.getByRole('textbox', { name: 'Edit message input' }),
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Edit message input' }),
      ).toBeFocused();
    },
  });

  const editedLeaf = '00000000-0000-4000-8000-000000000105';
  await captureBrandViews(page, 'chat-branch', {
    open: async () => {
      await openThread(
        page,
        env,
        'edited-branch',
        page.getByText('2 / 2', { exact: true }).first(),
      );
      const previous = messageOf(page, editedLeaf).getByRole('button', {
        name: 'Previous branch',
      });
      await previous.focus();
      await expect(previous).toBeFocused();
    },
  });

  await captureBrandViews(page, 'chat-stopped', {
    open: async () => {
      await openThread(
        page,
        env,
        'stopped',
        page.getByText('Stopped', { exact: true }),
      );
    },
  });

  await captureBrandViews(page, 'chat-error', {
    open: async () => {
      await openThread(
        page,
        env,
        'run-error',
        page.locator('#main').getByRole('alert'),
      );
      await expect(page.locator('#main').getByRole('alert')).toContainText(
        'The response could not be completed.',
      );
    },
  });
});

test('chat menus, rename, delete, and the Recent menu', async ({ page }) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page);
  const answerShown = page.getByText(answerStart);
  const pill = page.getByRole('button', { name: 'Chat actions', exact: true });
  const renameItem = page.getByRole('menuitem', { name: 'Rename' });
  const openPillMenu = async () => {
    await openThread(page, env, 'answer-complete', answerShown);
    await expect(pill).toBeEnabled();
    await openMenuReliably(page, pill, renameItem, 'floating chat menu');
  };
  const closePillMenu = async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  };

  await captureBrandViews(page, 'chat-floating-menu', {
    open: async () => {
      await openPillMenu();
      await expect(
        page.getByRole('menuitem', { name: 'Delete' }),
      ).toBeVisible();
    },
    close: closePillMenu,
  });

  await captureBrandViews(page, 'chat-rename', {
    open: async () => {
      await openPillMenu();
      await renameItem.click();
      const dialog = page.getByRole('dialog', { name: 'Rename chat' });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('textbox', { name: 'Chat title' }),
      ).toBeFocused();
      await settleAnimations(page);
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: 'Rename chat' }),
      ).toBeHidden();
    },
  });

  await captureBrandViews(page, 'chat-delete', {
    open: async () => {
      await openPillMenu();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expectSolidDestructiveButton(
        dialog.getByRole('button', { name: 'Delete chat', exact: true }),
      );
      await settleAnimations(page);
    },
    close: async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toBeHidden();
    },
  });

  const recentTrigger = page.getByRole('button', {
    name: `Chat actions for ${fileNames.acquisition}`,
  });
  await captureBrandViews(page, 'recent-menu', {
    open: async (viewport) => {
      await openThread(page, env, 'answer-complete', answerShown);
      if (viewport === 'mobile') await openMobileSheet(page);
      await openMenuReliably(
        page,
        recentTrigger,
        renameItem,
        'Recent chat menu',
      );
      await expect(
        page.getByRole('menuitem', { name: 'Delete' }),
      ).toBeVisible();
    },
    close: async (viewport) => {
      await closeMenu(page, viewport);
    },
  });
});

/**
 * Holds the page clock still for states whose indicator expires on a timer
 * (the copied check, the feedback toast). The clock is installed once, resumed
 * for each load, and paused 100 ms after the click; the one-millisecond steps
 * that let axe finish are counted and bounded far below the timer.
 */
function frozenClock(page: Page) {
  let stepping = false;
  let steps = 0;
  let loop: Promise<void> | undefined;
  return {
    install: () => page.clock.install({ time: new Date(brandFixedTime) }),
    resume: () => page.clock.resume(),
    async hold() {
      // Pause just after the current fake instant. A far-future pause would
      // run the copied and toast timers to completion before the capture.
      const now = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(new Date(now + 100));
      stepping = true;
      steps = 0;
      loop = (async () => {
        while (stepping) {
          await page.clock.runFor(1);
          steps++;
          await new Promise((done) => setTimeout(done, 5));
        }
      })();
    },
    async release() {
      stepping = false;
      await loop;
      expect(
        steps,
        'fake milliseconds advanced during the capture',
      ).toBeLessThan(2000);
    },
  };
}

test('copied answer and given feedback hold their timers', async ({ page }) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: env.stack.frontendUrl,
  });
  const clock = frozenClock(page);
  await clock.install();
  const load = async () => {
    await clock.resume();
    env.state = 'answer-complete';
    const response = await page.goto(
      `${env.stack.frontendUrl}/chats/${chatId}`,
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByText(answerStart)).toBeVisible();
  };

  await captureBrandViews(page, 'chat-copied', {
    open: async () => {
      await load();
      await page.getByRole('button', { name: 'Copy answer' }).click();
      // The accessible name changes to "Copied" while the confirmation shows.
      const copied = page.getByRole('button', { name: 'Copied' });
      await expect(copied.locator('svg.lucide-check')).toBeVisible();
      await expect(copied).toHaveText('Copied');
      await clock.hold();
    },
    close: () => clock.release(),
  });

  await captureBrandViews(page, 'chat-feedback', {
    open: async () => {
      await load();
      const good = page.getByRole('button', { name: 'Good answer' });
      await good.click();
      await expect(good).toHaveAttribute('aria-pressed', 'true');
      const toast = page.locator('[data-sonner-toast]');
      await expect(toast).toContainText('Thanks for your feedback.');
      await clock.hold();
      await settleAnimations(page);
    },
    close: () => clock.release(),
  });
});

function scrollableStreamingTree() {
  const messages: ChatMessage[] = [];
  let parentId: string | null = null;
  for (let turn = 0; turn < 3; turn++) {
    const user: Extract<ChatMessage, { role: 'user' }> = {
      ...userMessage(`00000000-0000-4000-8000-00000000020${turn}`),
      parentId,
    };
    const reply: Extract<ChatMessage, { role: 'assistant' }> = {
      ...assistantMessage(
        'answer-complete',
        `00000000-0000-4000-8000-00000000021${turn}`,
        user.id,
      ),
      runId: `00000000-0000-4000-8000-00000000022${turn}`,
    };
    messages.push(user, reply);
    parentId = reply.id;
  }
  messages.push(
    { ...userMessage(), parentId },
    assistantMessage('streaming-answer'),
  );
  return ChatTreeSchema.parse({
    id: chatId,
    title: fileNames.newChat,
    messages,
    viewedLeafId: assistantMessageId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

test('streaming, reconnecting, and loading chat threads', async ({ page }) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page);

  await page.route(
    (url) => url.pathname === `/api/chats/${chatId}`,
    (route) =>
      route.request().method() === 'GET' && env.state === 'streaming-scroll'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(scrollableStreamingTree()),
          })
        : route.fallback(),
  );
  await captureBrandViews(page, 'chat-streaming-scroll', {
    open: async (viewport) => {
      await openThread(
        page,
        env,
        'streaming-scroll',
        page.getByRole('button', { name: 'Stop generating' }),
        '?capture_state=streaming-answer',
      );
      await expect(page.getByText('Thought for 8 seconds')).toBeVisible();
      const viewportBox = page.locator('[data-slot="aui_thread-viewport"]');
      // Wait until the thread is pinned to the bottom and has stopped
      // changing size, so nothing later pulls it back down.
      await viewportBox.evaluate(async (element) => {
        const frame = () =>
          new Promise<void>((done) => requestAnimationFrame(() => done()));
        let still = 0;
        let last = '';
        for (let tries = 0; still < 30 && tries < 600; tries++) {
          await frame();
          const next = `${element.scrollHeight}|${element.scrollTop}`;
          still = next === last ? still + 1 : 0;
          last = next;
        }
      });
      await page.mouse.move(viewport === 'desktop' ? 840 : 195, 400);
      await page.mouse.wheel(0, -6000);
      await expect(
        page.getByRole('button', { name: 'Scroll to bottom' }),
      ).toBeVisible();
      await expect
        .poll(() => viewportBox.evaluate((element) => element.scrollTop))
        .toBe(0);
    },
  });

  await captureBrandViews(page, 'chat-reconnecting', {
    open: async () => {
      await openThread(
        page,
        env,
        'reconnecting',
        page.getByRole('button', { name: 'Stop generating' }),
        '?capture_state=reconnecting',
      );
      await expect(
        page.getByText(/Pasal 1320 KUHPerdata menetapkan/).first(),
      ).toBeVisible();
      await expect(page.getByText('Reconnecting…')).toHaveCount(0);
      const disconnected = await page.evaluate(
        () =>
          (
            window as Window & { __chatVisualDisconnectRun?: () => boolean }
          ).__chatVisualDisconnectRun?.() ?? false,
      );
      expect(disconnected).toBe(true);
      await expect(page.getByText('Reconnecting…')).toBeVisible();
    },
  });

  // The thread request is held by a gated route, so the loading state stays
  // open for as long as the captures need and never depends on a timer.
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  await page.route(
    (url) => url.pathname === `/api/chats/${chatId}`,
    async (route) => {
      if (route.request().method() !== 'GET' || env.state !== 'thread-loading')
        return route.fallback();
      await gate;
      await route.abort().catch(() => undefined);
    },
  );
  try {
    await captureBrandViews(page, 'chat-thread-loading', {
      open: async () => {
        env.state = 'thread-loading';
        await page.clock.setFixedTime(brandFixedTime);
        await page.goto(`${env.stack.frontendUrl}/chats/${chatId}`);
        await expect(page.locator('#main [role="status"]')).toBeVisible();
      },
    });
  } finally {
    release();
  }
});

test('Chats history, search with highlights, and no results', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const env = await startChatStates(page);
  const openChats = async (state: string) => {
    env.state = state;
    await page.clock.setFixedTime(brandFixedTime);
    await page.goto(`${env.stack.frontendUrl}/chats`);
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
  };
  const search = async (query: string) => {
    const box = page.getByRole('textbox', { name: 'Search chats' });
    await box.fill(query);
    await box.press('Enter');
  };

  await captureBrandViews(page, 'chats-history', {
    open: async () => {
      await openChats('chats-history');
      for (const title of [fileNames.newChat, fileNames.data])
        await expect(
          page.locator('#main').getByText(title, { exact: true }).first(),
        ).toBeVisible();
    },
  });

  await captureBrandViews(page, 'chats-search', {
    open: async () => {
      await openChats('chats-search');
      await search('wanprestasi');
      await expect(page.getByText('3 chats', { exact: true })).toBeVisible();
      await expect(page.locator('#main mark').first()).toBeVisible();
      await calm(page);
    },
  });

  await captureBrandViews(page, 'chats-no-results', {
    open: async () => {
      await openChats('chats-no-results');
      await search('hak tanggungan');
      await expect(
        page.getByText('No chats match “hak tanggungan”', { exact: true }),
      ).toBeVisible();
      await calm(page);
    },
  });
});

// Indicator frames. The thinking indicator is driven by the page clock, so
// these captures alone run with motion allowed. The seed is made deterministic
// without a product hook: an init script makes the one-word request the
// indicator uses for its default seed return a fixed value, and the clock is
// installed, paused before the run starts, and advanced with runFor().

// The capture times and the seed live in one fixture (read by path from the
// frontend test fixtures; the boundary lint forbids a frontend test from
// importing docs/) that a frontend unit
// test (frontend/test/indicator-capture-times.spec.tsx) checks against the
// real createTimeline(createSeededRandom(seed)), because the backend does not
// import the frontend (LEXON-02 section 3.4). indicator-mark is the start of
// the hold of the round's second mark, the instant its drawing has landed.
const indicatorTimes = JSON.parse(
  readFileSync(
    resolve('frontend/test/fixtures/indicator-capture-times.json'),
    'utf8',
  ),
) as {
  seed: number;
  thinkingMs: number;
  wanderMs: number;
  markMs: number;
  finishedOffsetMs: number;
};
const indicatorSeed = indicatorTimes.seed;

async function installHeldRun(page: Page) {
  const thinking = activeRunFrames('thinking');
  const completed = activeRunFrames('streaming-answer').map((frame) => {
    const copy = JSON.parse(JSON.stringify(frame)) as Record<string, unknown>;
    if (copy.type === 'snapshot-start') {
      const snapshot = copy.snapshot as Record<string, unknown>;
      snapshot.status = 'completed';
      snapshot.reasoningDurationMs = 14_000;
    }
    if (copy.partType === 'text') copy.text = answer;
    return copy;
  });
  await page.addInitScript(
    ({ seed, fixtureRunId, thinking, completed }) => {
      const nativeRandom = crypto.getRandomValues.bind(crypto);
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        writable: true,
        value: (array: ArrayBufferView) => {
          if (array instanceof Uint32Array && array.length === 1) {
            array[0] = seed;
            return array;
          }
          return nativeRandom(array as Uint8Array<ArrayBuffer>);
        },
      });
      const nativeFetch = window.fetch.bind(window);
      const held = window as Window & { __finishHeldRun?: () => boolean };
      window.fetch = async (input, init) => {
        const requestUrl =
          typeof input === 'string' || input instanceof URL
            ? String(input)
            : input.url;
        const url = new URL(requestUrl, window.location.href);
        if (url.pathname !== `/api/runs/${fixtureRunId}/events`)
          return nativeFetch(input, init);
        const signal =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const encoder = new TextEncoder();
        const send = (
          controller: ReadableStreamDefaultController<Uint8Array>,
          frames: unknown[],
        ) => {
          for (const frame of frames)
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(frame)}\n\n`),
            );
        };
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let settled = false;
            send(controller, thinking);
            held.__finishHeldRun = () => {
              if (settled) return false;
              settled = true;
              send(controller, completed);
              controller.close();
              return true;
            };
            signal?.addEventListener(
              'abort',
              () => {
                if (settled) return;
                settled = true;
                controller.close();
              },
              { once: true },
            );
          },
        });
        return new Response(body, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        });
      };
    },
    { seed: indicatorSeed, fixtureRunId: runId, thinking, completed },
  );
}

// Constant pause instant, a few fake seconds after the clock install; the
// page load takes about 1.5 s of fake time, and a longer jump broke the run.
const holdOffsetMs = 3_000;

test('indicator frames at fixed times in a held run', async ({ page }) => {
  test.setTimeout(900_000);
  const markMs = indicatorTimes.markMs;
  const env = await startChatStates(page);
  await installHeldRun(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: new Date(brandFixedTime) });

  let releaseTree!: () => void;
  let treeGate = Promise.resolve();
  await page.route(
    (url) => url.pathname === `/api/chats/${chatId}`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await treeGate;
      return route.fallback();
    },
  );

  const shot = () =>
    page.screenshot({
      fullPage: false,
      caret: 'hide',
      animations: 'disabled',
      scale: 'css',
    });
  const currentTheme = async () =>
    (await page
      .locator('html')
      .evaluate((element) => element.classList.contains('dark')))
      ? 'dark'
      : 'light';
  // The clock is paused, so a frame must not move between captures.
  // Owner decision of 2026-11-16: on Linux, Chromium rasterizes the identical
  // indicator SVG differently between captures (max channel diff 14/255, only
  // inside the indicator), so the animating frames (chat-thinking,
  // indicator-wander, indicator-mark) carry `"lock": "svg-snapshot"` in the
  // index. Their full-page screenshots are still written in capture mode for
  // review, with no byte assertion on any platform; their lock is a normalized
  // snapshot of the indicator SVG markup (see snapshotFrame). A frame without
  // that lock (indicator-finished, the static mark) keeps the strict checks
  // below: the full-page byte check is a Linux gate only. On Linux the first
  // two full-page screenshots must be byte-identical, before and after the
  // capture. On macOS, Chromium under suite load re-rasterizes a few page
  // pixels between screenshots of an unchanged, frozen page (the indicator
  // element itself stays stable), so there the full-page capture has no byte
  // assertion; instead the indicator element alone (the 20 px indicator svg
  // inside [data-slot="reasoning-mark"]) is screenshotted twice and the two
  // must be byte-identical, with no retry and no tolerance.
  const strictBytes = process.platform === 'linux';
  let pinned: Buffer | undefined;
  const options = {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  } as const;
  const indicator = page.locator('[data-slot="reasoning-mark"] svg').first();
  const scrollState = () =>
    indicator.evaluate((element) => {
      const positions: number[] = [window.scrollX, window.scrollY];
      for (let node: Element | null = element; node; node = node.parentElement)
        positions.push(node.scrollLeft, node.scrollTop);
      return positions;
    });
  const restoreScroll = (positions: number[]) =>
    indicator.evaluate((element, saved) => {
      window.scrollTo({ left: saved[0]!, top: saved[1]!, behavior: 'instant' });
      let index = 2;
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        node.scrollTo({
          left: saved[index++]!,
          top: saved[index++]!,
          behavior: 'instant',
        });
      }
    }, positions);
  /**
   * Warm-up, kept only for the frames that are still pixel-locked
   * (indicator-finished): the strict Linux full-page check and the macOS
   * element check were measured with it and stay as they were. The
   * SVG-snapshot frames read markup and need no warm-up. Chromium's
   * rasterization of the indicator settles with one
   * indicator-only screenshot and one full-page screenshot, both discarded. A
   * capture-only step with no product change; owner decision 2026-11-16.
   * Chromium rasterizes the same SVG differently after the first screenshot of
   * a frame. On the 390 px finished frame the indicator is outside the
   * viewport, so the element screenshot scrolls it into view; the scroll
   * position is saved and restored around it and asserted, and the full-page
   * screenshot comes after the restore, so the frame that follows is at the
   * scroll position it had before the warm-up.
   */
  const warmUp = async (frame: string) => {
    const saved = await scrollState();
    await indicator.screenshot(options);
    await restoreScroll(saved);
    expect(
      await scrollState(),
      `${frame}: scroll restored after warm-up`,
    ).toEqual(saved);
    await shot();
  };
  const pinFrame = async (frame: string, when: string) => {
    await warmUp(frame);
    const first = await shot();
    const second = await shot();
    expect(
      second.equals(first),
      `${frame}: first vs second full-page capture (${when})`,
    ).toBe(true);
    return second;
  };
  /**
   * macOS element check. It runs in the close hook, after the full-page
   * capture has been written, so the scroll that Playwright does to bring an
   * off-screen indicator into view (the 390 px finished frame) cannot affect
   * that capture. The scroll position is restored and compared afterwards.
   */
  const checkIndicatorElement = async (label: string) => {
    const before = await scrollState();
    const first = await indicator.screenshot(options);
    const second = await indicator.screenshot(options);
    expect(second.equals(first), `${label}: two indicator captures`).toBe(true);
    await restoreScroll(before);
    expect(await scrollState(), `${label}: scroll restored`).toEqual(before);
  };

  /** Loads the thinking thread with the run starting at a known clock value. */
  const openHeldRun = async (viewport: BrandViewport, thinkingAxe = false) => {
    await page.clock.resume();
    env.state = 'thinking';
    if (thinkingAxe) {
      // Axe needs live timers, so the thinking thread is checked on a first
      // load with the clock running; the timed frame loads it again.
      await page.goto(env.stack.frontendUrl + '/chats/' + chatId);
      await expect(page.getByText('Thinking…')).toBeVisible();
      await runBrandAxe(
        page,
        brandViewId('chat-thinking', viewport, await currentTheme()),
      );
    }
    treeGate = new Promise<void>((done) => (releaseTree = done));
    await page.goto(env.stack.frontendUrl + '/chats/' + chatId);
    await expect(page.locator('#main [role="status"]')).toBeVisible();
    // Exact start. Pause the clock at a constant instant first, with the tree
    // held (the run's start reaches the page only through the tree; the
    // stream is requested later, on a page timer, which cannot fire while the
    // clock is paused). Then release the tree; no fake time passes while the
    // indicator registers the run, so its start is the same performance.now()
    // value in every run and every later frame is a pure function of runFor().
    const pauseTarget = Date.parse(brandFixedTime) + holdOffsetMs;
    const now = await page.evaluate(() => Date.now());
    expect(now, 'page load finished before the pause instant').toBeLessThan(
      pauseTarget,
    );
    await page.clock.pauseAt(new Date(pauseTarget));
    releaseTree();
    await expect(page.getByText('Thinking…')).toBeVisible();
    // The indicator has registered the run once its svg holds the first draw
    // state: the renderer appends its circles in the same effect that notes
    // the start. No fake time advances while this is polled.
    await expect(
      page
        .locator('[data-slot="reasoning-mark"] svg[width="20"] circle')
        .first(),
    ).toBeAttached();
  };
  const frameId = async (frame: string, viewport: BrandViewport) =>
    brandViewId(frame, viewport, await currentTheme());
  /**
   * Advances the held run to a frame and locks its indicator SVG markup (two
   * equal reads, then a byte comparison with the committed snapshot). Only a
   * frame that is still pixel-locked in the index also gets the full-page
   * byte checks.
   */
  const playTo = async (frame: string, viewport: BrandViewport, ms: number) => {
    await page.clock.runFor(ms);
    const id = await frameId(frame, viewport);
    // A frame locked by the engine tests ("lock": "engine-tests") has no
    // SVG snapshot: its markup is not stable across runs.
    if (await isBrandViewSvgSnapshotted(id))
      await snapshotIndicatorSvg(id, () =>
        indicator.evaluate((element) => element.outerHTML),
      );
    if (!(await isBrandViewPixelLocked(id))) return;
    if (strictBytes) pinned = await pinFrame(frame, 'before capture');
    else await warmUp(frame);
  };
  const closeFrame = async (label: string, viewport: BrandViewport) => {
    if (!(await isBrandViewPixelLocked(await frameId(label, viewport)))) return;
    if (!strictBytes) return checkIndicatorElement(label);
    const after = await pinFrame(label, 'after capture');
    expect(after.equals(pinned!), `${label}: before vs after capture`).toBe(
      true,
    );
    pinned = undefined;
  };

  await captureBrandViews(page, 'chat-thinking', {
    axe: false,
    open: async (viewport) => {
      await openHeldRun(viewport, true);
      await playTo('chat-thinking', viewport, indicatorTimes.thinkingMs);
    },
    close: (viewport) => closeFrame('chat-thinking', viewport),
  });
  // wander and mark are not axe-checked: axe hangs on a paused fake clock, and
  // chat-thinking runs axe on the running indicator.
  await captureBrandViews(page, 'indicator-wander', {
    axe: false,
    open: async (viewport) => {
      await openHeldRun(viewport);
      await playTo('indicator-wander', viewport, indicatorTimes.wanderMs);
    },
    close: (viewport) => closeFrame('indicator-wander', viewport),
  });
  await captureBrandViews(page, 'indicator-mark', {
    axe: false,
    open: async (viewport) => {
      await openHeldRun(viewport);
      await playTo('indicator-mark', viewport, markMs);
    },
    close: (viewport) => closeFrame('indicator-mark', viewport),
  });
  await captureBrandViews(page, 'indicator-finished', {
    axe: false,
    open: async (viewport) => {
      await openHeldRun(viewport);
      await page.clock.runFor(markMs);
      env.state = 'answer-complete';
      const finished = await page.evaluate(() =>
        (
          window as Window & { __finishHeldRun?: () => boolean }
        ).__finishHeldRun?.(),
      );
      expect(finished).toBe(true);
      await expect(page.getByText('Thought for 14 seconds')).toBeVisible();
      await playTo(
        'indicator-finished',
        viewport,
        indicatorTimes.finishedOffsetMs,
      );
    },
    close: async (viewport) => {
      await closeFrame('indicator-finished', viewport);
      // Last, because stepping the clock for axe moves the frame.
      let axing = true;
      const stepper = (async () => {
        while (axing) {
          await page.clock.runFor(1);
          await new Promise((done) => setTimeout(done, 5));
        }
      })();
      try {
        await runBrandAxe(
          page,
          brandViewId('indicator-finished', viewport, await currentTheme()),
        );
      } finally {
        axing = false;
        await stepper;
      }
    },
  });
  assertSvgSnapshotsMatched();
});
