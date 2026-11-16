import { expect, test, type Locator, type Page } from '@playwright/test';
import { descriptor } from './runtime-support.js';
import { authenticateApi, readCapturedMail } from './identity-support.js';
import { operatorSetup, signupMode } from './setup-support.js';
import { totpForUri } from '../setup/totp.js';
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
