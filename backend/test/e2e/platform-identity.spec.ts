import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { readCapturedMail, authenticateApi } from './identity-support.js';
import { operatorSetup, signupMode } from './setup-support.js';
import { totpForUri } from '../setup/totp.js';
import {
  captureCheckpointCView,
  captureShellReviewView,
} from './visual-support.js';
import { captureTask7BViewportReview } from './visual-support.js';

let restoreSignupModeAfterTest = false;

test.afterEach(async () => {
  if (!restoreSignupModeAfterTest) return;
  restoreSignupModeAfterTest = false;
  await signupMode(true);
});

test('F2 platform navigation remains hidden and direct routes are denied for ordinary users', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  await page.goto(stack.frontendUrl + '/workspace');
  await expect(
    page.getByRole('link', { name: 'Platform', exact: true }),
  ).toHaveCount(0);
  const platformRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/platform/'))
      platformRequests.push(request.url());
  });
  await page.goto(stack.frontendUrl + '/platform/provisioning');
  await expect(page.locator('section[role="alert"]')).toContainText(
    'You do not have access to this page.',
  );
  await expect(
    page.getByRole('link', { name: 'Platform', exact: true }),
  ).toHaveCount(0);
  expect(platformRequests).toEqual([]);
});

test('F2 platform page passes both-theme axe checks in the real operator flow and provisioning remains scoped', async ({
  page,
  playwright,
}) => {
  test.setTimeout(120000);
  const operatorTestStarted = Date.now();
  const markOperatorStage = (stage: string) =>
    console.info(
      `[operator-flow timing] ${stage}: ${Date.now() - operatorTestStarted}ms`,
    );
  const stack = descriptor();
  const email = 'platform.operator@example.test';
  const password = 'Platform-browser-42!';
  const target = await playwright.request.newContext();
  await authenticateApi(target);
  const targetProfile = (await (
    await target.get(stack.apiUrl + '/api/identity/profile')
  ).json()) as { id: string; email: string };
  await signupMode(false);
  restoreSignupModeAfterTest = true;
  try {
    const setup = await operatorSetup(email);
    markOperatorStage('setup provisioned');
    expect(setup.status).toBe('created');
    expect(!!setup.mail).toBe(true);
    await page.goto(setup.mail!.actionUrl);
    await expect(
      page.getByRole('button', { name: 'Provision organization', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Create setup account', exact: true })
      .click();
    await page.getByLabel('Name', { exact: true }).fill('Platform operator');
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
    const signInResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/sign-in/email' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await signInResponse).status()).toBe(200);
    await expect(page).toHaveURL(/admin-setup/);
    await page
      .getByLabel('Enrollment password', { exact: true })
      .fill(password);
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
    markOperatorStage('administrator activated');
    await expect(
      page.getByRole('heading', { name: 'Administrator setup complete' }),
    ).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    const onboarding = await page.request.post(
      stack.apiUrl + '/api/identity/onboarding/complete',
      { headers: { origin: stack.frontendUrl }, data: {} },
    );
    expect(onboarding.status()).toBe(204);
    markOperatorStage('onboarding completed');
    await page.goto(stack.frontendUrl + '/workspace');
    await expect(page.locator('h1')).toHaveText('Home');
    const expandSidebar = page.getByRole('button', {
      name: 'Expand sidebar',
    });
    if (await expandSidebar.isVisible()) await expandSidebar.click();
    await expect(
      page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Platform', exact: true }),
    ).toBeVisible();
    const platformDisclosure = page.getByRole('button', {
      name: 'Toggle Platform navigation',
    });
    const disclosureBounds = await platformDisclosure.boundingBox();
    const platformLinkBounds = await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Platform', exact: true })
      .boundingBox();
    expect(disclosureBounds?.width).toBeGreaterThanOrEqual(24);
    expect(disclosureBounds?.height).toBeGreaterThanOrEqual(24);
    expect(platformLinkBounds).not.toBeNull();
    expect(
      Math.abs(
        disclosureBounds!.y +
          disclosureBounds!.height / 2 -
          (platformLinkBounds!.y + platformLinkBounds!.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
    await platformDisclosure.click();
    await expect(
      page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Provisioning', exact: true }),
    ).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await captureShellReviewView(
        page,
        'sidebar-expanded',
        theme,
        'desktop',
        '.cache/f21-task6A/platform-admin',
        'Home',
        true,
      );
      await captureShellReviewView(
        page,
        'user-menu-open',
        theme,
        'desktop',
        '.cache/f21-task6A/platform-admin',
        'Home',
      );
    }
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(
        (value) => localStorage.setItem('theme', value),
        theme,
      );
      await page.goto(stack.frontendUrl + '/workspace');
      const expand = page.getByRole('button', { name: 'Expand sidebar' });
      if (await expand.isVisible()) await expand.click();
      const platformToggle = page.getByRole('button', {
        name: 'Toggle Platform navigation',
      });
      if ((await platformToggle.getAttribute('aria-expanded')) !== 'true')
        await platformToggle.click();
      await expect(
        page.getByRole('link', { name: 'Provisioning', exact: true }),
      ).toBeVisible();
      await page
        .locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]')
        .click();
      await expect(
        page.getByRole('menuitem', { name: 'Sign out' }),
      ).toBeVisible();
      await expect(
        page.getByRole('menuitem', { name: /Settings/ }),
      ).toContainText('⌘,');
      await captureCheckpointCView(page, 'user-menu-open', theme);
    }
    markOperatorStage('C operator menu screenshots captured');
    await page.goto(stack.frontendUrl + '/platform/provisioning');
    await expect(page.locator('h1')).toHaveText('Organization provisioning');
    markOperatorStage('provisioning list opened');
    const platformListUrl = (url: URL) =>
      url.pathname === '/api/platform/provisioning' &&
      url.searchParams.has('limit');
    const capturePlatformResponsiveState = async (name: string) => {
      for (const width of [390, 768] as const) {
        for (const theme of ['light', 'dark'] as const) {
          await captureTask7BViewportReview(page, name, width, theme);
        }
      }
    };
    let releaseProvisioningList!: () => void;
    let provisioningListStarted!: () => void;
    let provisioningListFinished!: () => void;
    const provisioningListGate = new Promise<void>((resolve) => {
      releaseProvisioningList = resolve;
    });
    const provisioningStarted = new Promise<void>((resolve) => {
      provisioningListStarted = resolve;
    });
    const provisioningFinished = new Promise<void>((resolve) => {
      provisioningListFinished = resolve;
    });
    await page.route(platformListUrl, async (route) => {
      provisioningListStarted();
      try {
        await provisioningListGate;
        const response = await route.fetch();
        await route.fulfill({ response });
      } finally {
        provisioningListFinished();
      }
    });
    try {
      await page.reload();
      await provisioningStarted;
      await expect(
        page.getByRole('status', { name: 'Checking platform access' }),
      ).toBeVisible();
      await capturePlatformResponsiveState('platform-provisioning-loading');
    } finally {
      releaseProvisioningList();
      await provisioningFinished;
      await page.unroute(platformListUrl);
    }
    await expect(
      page.getByText('No provisioning organizations', { exact: true }),
    ).toBeVisible();

    await page.route(platformListUrl, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"private platform detail"}',
      }),
    );
    try {
      await page.reload();
      await expect(
        page.getByText('Service temporarily unavailable. Please try again.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText(
        'private platform detail',
      );
      await capturePlatformResponsiveState('platform-provisioning-error');
    } finally {
      await page.unroute(platformListUrl);
    }
    await page.reload();
    await expect(
      page.getByText('No provisioning organizations', { exact: true }),
    ).toBeVisible();
    for (const width of [390, 768, 1440] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await captureTask7BViewportReview(
          page,
          'platform-provisioning-empty',
          width,
          theme,
        );
      }
    }
    const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('a[href="#main"]')).toHaveCount(1);
    await expect(page).toHaveTitle(/\S/);
    expect(
      (await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations,
    ).toEqual([]);
    markOperatorStage('light provisioning axe passed');
    await expect(page.locator('h1')).toHaveCount(1);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('a[href="#main"]')).toHaveCount(1);
    await expect(page).toHaveTitle(/\S/);
    expect(
      (await new AxeBuilder({ page }).withTags(axeTags).analyze()).violations,
    ).toEqual([]);
    markOperatorStage('dark provisioning axe passed');
    const ownerEmail = targetProfile.email;
    await page
      .getByLabel('Organization name', { exact: true })
      .fill('Provisioned team');
    await page
      .getByLabel('Organization slug', { exact: true })
      .fill('provision-' + randomUUID().slice(0, 8));
    await page
      .getByLabel('First owner email', { exact: true })
      .fill(ownerEmail);
    await page
      .getByRole('button', { name: 'Provision organization', exact: true })
      .click();
    await expect(
      page.getByRole('link', { name: 'Provisioned team', exact: true }),
    ).toBeVisible();
    markOperatorStage('provisioned team appeared in list');
    for (const width of [390, 768, 1440] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await captureTask7BViewportReview(
          page,
          'platform-provisioning-populated',
          width,
          theme,
        );
      }
    }
    await page
      .getByRole('link', { name: 'Provisioned team', exact: true })
      .click();
    await expect(page.getByText('provisioning', { exact: true })).toBeVisible();
    markOperatorStage('provisioned detail opened');
    for (const width of [390, 768, 1440] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await captureTask7BViewportReview(
          page,
          'platform-provisioning-detail',
          width,
          theme,
        );
      }
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const originalMail = await readCapturedMail(
      stack.project,
      ownerEmail,
      'invitation',
    );
    const originalId = new URL(originalMail.actionUrl).searchParams.get('id')!;
    const replacementEmail = randomUUID() + '@example.test';
    await page
      .getByLabel('Replacement owner email', { exact: true })
      .fill(replacementEmail);
    const replaced = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith('/owner-email'),
    );
    await page
      .getByRole('button', { name: 'Replace owner email', exact: true })
      .click();
    expect((await replaced).status()).toBe(200);
    expect(
      (
        await target.post(
          stack.apiUrl + '/api/invitations/' + originalId + '/accept',
          { headers: { origin: stack.frontendUrl }, data: {} },
        )
      ).status(),
    ).toBe(403);
    const resent = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/resend'),
    );
    await page
      .getByRole('button', { name: 'Resend owner invitation', exact: true })
      .click();
    expect((await resent).status()).toBe(200);
    markOperatorStage('replacement owner invite resent');
    const recipientContext = await page.context().browser()!.newContext();
    try {
      const recipient = await recipientContext.newPage();
      await recipient.goto(
        (await readCapturedMail(stack.project, replacementEmail, 'invitation'))
          .actionUrl,
      );
      await recipient
        .getByRole('link', { name: 'Create account', exact: true })
        .click();
      await recipient.getByLabel('Name', { exact: true }).fill('First owner');
      await recipient
        .getByLabel('Email', { exact: true })
        .fill(replacementEmail);
      await recipient
        .getByLabel('Password', { exact: true })
        .fill('First-owner-browser-42!');
      await recipient
        .getByRole('button', { name: 'Create account', exact: true })
        .click();
      await expect(
        recipient.getByRole('heading', { name: 'Check your email' }),
      ).toBeVisible();
      await recipient.goto(
        (
          await readCapturedMail(
            stack.project,
            replacementEmail,
            'verification',
          )
        ).actionUrl,
      );
      await recipient
        .getByRole('link', { name: 'Sign in', exact: true })
        .click();
      await recipient
        .getByLabel('Email', { exact: true })
        .fill(replacementEmail);
      await recipient
        .getByLabel('Password', { exact: true })
        .fill('First-owner-browser-42!');
      await recipient
        .getByRole('button', { name: 'Sign in', exact: true })
        .click();
      await recipient
        .getByRole('button', { name: 'Accept invitation', exact: true })
        .click();
      await expect(recipient).toHaveURL(/\/(workspace|onboarding)/);
      const identity = (await (
        await recipient.request.get(stack.frontendUrl + '/api/identity')
      ).json()) as {
        organization: { kind: string; state: string; role: string };
      };
      expect(
        identity.organization.kind === 'team' &&
          identity.organization.state === 'active' &&
          identity.organization.role === 'owner',
      ).toBe(true);
      markOperatorStage('replacement owner accepted invitation');
    } finally {
      await recipientContext.close();
    }
    await page.goto(stack.frontendUrl + '/platform/provisioning');
    await page
      .getByLabel('Organization name', { exact: true })
      .fill('Cancelled team');
    await page
      .getByLabel('Organization slug', { exact: true })
      .fill('cancel-' + randomUUID().slice(0, 8));
    await page
      .getByLabel('First owner email', { exact: true })
      .fill(ownerEmail);
    await page
      .getByRole('button', { name: 'Provision organization', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'Cancelled team', exact: true })
      .click();
    const cancelledMail = await readCapturedMail(
      stack.project,
      ownerEmail,
      'invitation',
    );
    const cancelledId = new URL(cancelledMail.actionUrl).searchParams.get(
      'id',
    )!;
    await page
      .getByRole('button', { name: 'Cancel provisioning', exact: true })
      .click();
    const cancelDialog = page.getByRole('alertdialog', {
      name: 'Cancel provisioning for Cancelled team?',
    });
    await expect(cancelDialog).toBeVisible();
    const cancelRequest = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.includes(
          '/api/platform/provisioning/',
        ),
    );
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cancel provisioning', exact: true })
      .click();
    expect((await cancelRequest).status()).toBe(204);
    await expect(page).toHaveURL(/\/platform\/provisioning$/);
    await expect(
      page.getByRole('link', { name: 'Cancelled team', exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await target.post(
          stack.apiUrl + '/api/invitations/' + cancelledId + '/accept',
          { headers: { origin: stack.frontendUrl }, data: {} },
        )
      ).status(),
    ).toBe(403);
    const orgs = (await (
      await page.request.get(stack.frontendUrl + '/api/organizations')
    ).json()) as { items: { kind: string }[] };
    expect(orgs.items.every((org) => org.kind === 'personal')).toBe(true);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Account status', exact: true })
      .click();
    await expect(page.getByLabel('User ID', { exact: true })).toBeVisible();
    for (const width of [390, 768, 1440] as const) {
      for (const theme of ['light', 'dark'] as const) {
        await captureTask7BViewportReview(
          page,
          'platform-account-status',
          width,
          theme,
        );
      }
    }
    await page.getByLabel('User ID', { exact: true }).fill(targetProfile.id);
    const disableRequest = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith(
          `/platform/users/${targetProfile.id}/disabled`,
        ),
    );
    await page
      .getByRole('button', { name: 'Disable account', exact: true })
      .click();
    const disableDialog = page.getByRole('alertdialog', {
      name: `Disable account ${targetProfile.id}?`,
    });
    await expect(disableDialog).toBeVisible();
    await disableDialog
      .getByRole('button', { name: 'Disable account', exact: true })
      .click();
    expect((await disableRequest).status()).toBe(204);
    await expect(
      page.getByText('Account disabled.', { exact: true }),
    ).toBeVisible();
    expect((await target.get(stack.apiUrl + '/api/identity')).status()).toBe(
      401,
    );
    const enableRequest = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith(
          `/platform/users/${targetProfile.id}/disabled`,
        ),
    );
    await page
      .getByRole('button', { name: 'Enable account', exact: true })
      .click();
    expect((await enableRequest).status()).toBe(204);
    await expect(
      page.getByText('Account enabled.', { exact: true }),
    ).toBeVisible();
    expect((await target.get(stack.apiUrl + '/api/identity')).status()).toBe(
      401,
    );
    const headers = { origin: stack.frontendUrl };
    const sessions = (await (
      await page.request.get(stack.frontendUrl + '/api/identity/sessions')
    ).json()) as { id: string; current: boolean }[];
    const current = sessions.find((session) => session.current)!;
    expect(
      (
        await page.request.delete(
          stack.frontendUrl + '/api/identity/sessions/' + current.id,
          { headers },
        )
      ).status(),
    ).toBe(204);
    expect(
      (
        await page.request.get(stack.frontendUrl + '/api/platform/provisioning')
      ).status(),
    ).toBe(401);
    const elevated = await playwright.request.newContext();
    try {
      expect(
        (
          await elevated.post(stack.apiUrl + '/api/auth/sign-in/email', {
            headers,
            data: { email, password },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await elevated.post(
            stack.apiUrl + '/api/auth/two-factor/verify-totp',
            { headers, data: { code: totpForUri(uri!) } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await elevated.post(stack.apiUrl + '/api/auth/two-factor/disable', {
            headers,
            data: { password },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await elevated.get(stack.apiUrl + '/api/platform/provisioning')
        ).status(),
      ).toBe(403);
    } finally {
      await elevated.dispose();
    }
  } finally {
    await signupMode(true);
    restoreSignupModeAfterTest = false;
    await target.dispose();
  }
});
