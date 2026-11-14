import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

async function tabTo(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await locator.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Keyboard tab order did not reach the requested control');
}

test('F2 keyboard flow signs in, switches teams, changes appearance, and signs out', async ({
  page,
}) => {
  const stack = descriptor();
  const email = randomUUID() + '@example.test';
  const password = 'F2-keyboard-42!';
  const headers = { origin: stack.frontendUrl };
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/auth/sign-up/email', {
        headers,
        data: { name: 'F2 Keyboard', email, password },
      })
    ).status(),
  ).toBe(200);
  const mail = await (
    await import('./identity-support.js')
  ).readCapturedMail(stack.project, email, 'verification');
  const verify = new URL(mail.actionUrl);
  verify.searchParams.delete('callbackURL');
  expect(
    (
      await page.request.get(stack.apiUrl + verify.pathname + verify.search)
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/auth/sign-in/email', {
        headers,
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  const teamResponse = await page.request.post(
    stack.apiUrl + '/api/organizations',
    {
      headers,
      data: {
        name: 'Keyboard team',
        slug: 'keyboard-' + randomUUID().slice(0, 8),
      },
    },
  );
  expect(teamResponse.status()).toBe(201);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  await page.request.post(stack.frontendUrl + '/api/auth/sign-out', {
    headers,
    data: {},
  });

  await page.goto(stack.frontendUrl + '/sign-in');
  const emailInput = page.getByLabel('Email', { exact: true });
  await tabTo(page, emailInput);
  await page.keyboard.type(email);
  const passwordInput = page.getByLabel('Password', { exact: true });
  await tabTo(page, passwordInput);
  await page.keyboard.type(password);
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await tabTo(page, signIn);
  const organizationListResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/organizations?limit=20') &&
      response.request().method() === 'GET',
  );
  const signInResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/sign-in/email' &&
      response.request().method() === 'POST',
  );
  await page.keyboard.press('Enter');
  expect((await signInResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/workspace$/);
  expect((await organizationListResponse).status()).toBe(200);

  const switcher = page.getByRole('button', { name: 'Organization: Personal' });
  await tabTo(page, switcher);
  await expect(switcher).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(switcher).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Organizations', { exact: true })).toBeVisible();
  const documentBeforeSwitch = await page.evaluate(
    () => performance.timeOrigin,
  );
  const teamButton = page.getByRole('menuitem', {
    name: 'Keyboard team',
    exact: true,
  });
  await expect(teamButton).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(teamButton).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const popup = document.querySelector(
          '[data-testid="organization-popup"]',
        );
        return popup?.contains(document.activeElement) ?? false;
      }),
    )
    .toBe(true);
  const nextDocumentLoaded = page.waitForEvent('domcontentloaded');
  await page.keyboard.press('Enter');
  await nextDocumentLoaded;
  await expect(page).toHaveURL(/\/workspace$/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBeGreaterThan(
    documentBeforeSwitch,
  );
  await expect(
    page.getByRole('button', { name: /Organization: Keyboard team/ }),
  ).toBeVisible();

  const userMenu = page.locator(
    '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
  );
  await tabTo(page, userMenu);
  await expect(userMenu).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(userMenu).toHaveAttribute('aria-expanded', 'true');
  const settingsMenuItem = page.getByRole('menuitem', {
    name: /^Settings/,
  });
  await expect(settingsMenuItem).toBeFocused();
  const documentBeforeSettingsNavigation = await page.evaluate(
    () => performance.timeOrigin,
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workspace\?settings=profile$/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(
    documentBeforeSettingsNavigation,
  );
  await page.goto(stack.frontendUrl + '/workspace?settings=appearance');
  const systemTheme = page.getByRole('radio', { name: 'System' });
  await tabTo(page, systemTheme);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  await page.keyboard.press('Escape');
  await expect(settingsDialog).toBeHidden();

  await tabTo(page, userMenu);
  await page.keyboard.press('ArrowDown');
  await expect(settingsMenuItem).toBeFocused();
  const signOut = page.getByRole('menuitem', { name: 'Sign out', exact: true });
  await expect(signOut).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workspace\?settings=profile$/);
  await expect(
    settingsDialog.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settingsDialog).toBeHidden();
  await expect(userMenu).toBeFocused();
  await tabTo(page, userMenu);
  await page.keyboard.press('ArrowDown');
  await expect(settingsMenuItem).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(signOut).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('F2 cross-organization settings URL shows no access without requesting protected data', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  const own = await page.request.post(stack.apiUrl + '/api/organizations', {
    headers,
    data: { name: 'Own team', slug: 'own-' + randomUUID().slice(0, 8) },
  });
  const otherId = randomUUID();
  expect(own.status()).toBe(201);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  const protectedRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(`/api/organizations/${otherId}/`))
      protectedRequests.push(request.url());
  });
  await page.goto(
    `${stack.frontendUrl}/workspace?settings=invitations&orgId=${otherId}`,
  );
  await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
  await expect(
    page.getByText('You do not have access to this section.', { exact: true }),
  ).toBeVisible();
  expect(protectedRequests).toEqual([]);
});

test('retired organization URLs keep the scoped not-found state and fetch no organization data', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  const organizationId = randomUUID();
  const organizationRequests: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith(
        `/api/organizations/${organizationId}`,
      )
    )
      organizationRequests.push(request.url());
  });
  const response = await page.goto(
    `${stack.frontendUrl}/organizations/${organizationId}/settings/members`,
  );
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  expect(organizationRequests).toEqual([]);
});

test('onboarding and organization switches preserve Personal and last owner', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  await page.goto(stack.frontendUrl + '/workspace');
  await expect(page).toHaveURL(/onboarding/);
  await page
    .getByLabel('Display name', { exact: true })
    .fill('Workspace owner');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Pending invitations' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Team name', { exact: true }).fill('First team');
  await page
    .getByLabel('Team slug', { exact: true })
    .fill('first-' + randomUUID().slice(0, 8));
  await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(
    page.getByText('Team created. Your current organization is unchanged.', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Finish onboarding', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Organization: Personal' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Organization settings', exact: true }),
  ).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).analyze();
  if (accessibility.violations.length > 0) {
    const trigger = await page
      .locator('button[aria-label^="Organization:"]')
      .evaluate((element) => ({
        outerHTML: element.outerHTML,
        textContent: element.textContent,
        innerText: (element as HTMLElement).innerText,
        ariaLabel: element.getAttribute('aria-label'),
        ariaLabelledBy: element.getAttribute('aria-labelledby'),
      }));
    console.info('Organization trigger accessibility evidence:', trigger);
  }
  expect(
    accessibility.violations.flatMap((violation) =>
      violation.nodes.map((node) => ({
        id: violation.id,
        html: node.html,
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    ),
  ).toEqual([]);
  const organizationPage = await page.request.get(
    stack.apiUrl + '/api/organizations?limit=20',
    { headers },
  );
  const { items } = (await organizationPage.json()) as {
    items: Array<{ id: string; name: string }>;
  };
  const firstTeamId = items.find((item) => item.name === 'First team')?.id;
  expect(firstTeamId).toBeDefined();
  await page.getByRole('button', { name: 'Organization: Personal' }).click();
  await page.getByRole('menuitem', { name: 'First team', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Organization: First team' }),
  ).toBeVisible();
  await page.goto(`${stack.frontendUrl}/workspace?settings=members`);
  await page
    .getByRole('button', { name: 'Leave organization', exact: true })
    .click();
  const leaveDialog = page.getByRole('alertdialog', {
    name: 'Leave First team?',
  });
  await expect(leaveDialog).toBeVisible();
  const leaveResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/leave') &&
      response.request().method() === 'POST',
  );
  await leaveDialog
    .getByRole('button', { name: 'Leave organization', exact: true })
    .click();
  expect((await leaveResponse).status()).toBe(409);
  await expect(leaveDialog.getByRole('alert')).toContainText(
    'Promote another owner before leaving or removing the last owner.',
  );
  const diagnosticDirectory = resolve('.cache/f21-task9-main');
  await mkdir(diagnosticDirectory, { recursive: true });
  await page.screenshot({
    path: resolve(diagnosticDirectory, 'rejected-last-owner-leave.png'),
    fullPage: false,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('F2 organization entry clears stale cookies without a redirect loop', async ({
  page,
  context,
}) => {
  const stack = descriptor();
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: 'stale-invalid-session',
      url: stack.frontendUrl,
    },
  ]);
  await page.goto(stack.frontendUrl + '/workspace');
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole('heading', { name: 'Sign in to Lexon', exact: true }),
  ).toBeVisible();
});
test('F2 organization 2FA standby and active-page member removal preserve safe Personal selection', async ({
  page,
  playwright,
}) => {
  test.setTimeout(90000);
  const stack = descriptor();
  const owner = await playwright.request.newContext();
  const headers = await authenticateApi(owner);
  await authenticateApi(page.request);
  const recipient = (await (
    await page.request.get(stack.apiUrl + '/api/identity/profile')
  ).json()) as { id: string; email: string };
  const teams: { id: string; name: string }[] = [];
  for (const name of ['Protected team', 'Ordinary team']) {
    const result = await owner.post(stack.apiUrl + '/api/organizations', {
      headers,
      data: { name, slug: 'switch-' + randomUUID().slice(0, 8) },
    });
    expect(result.status()).toBe(201);
    const team = (await result.json()) as { id: string; name: string };
    teams.push(team);
    const invite = await owner.post(
      stack.apiUrl + '/api/organizations/' + team.id + '/invitations',
      {
        headers,
        data: {
          email: recipient.email,
          role: name === 'Ordinary team' ? 'admin' : 'member',
        },
      },
    );
    const invitation = (await invite.json()) as { id: string };
    expect(invite.status()).toBe(201);
    expect(
      (
        await page.request.post(
          stack.apiUrl + '/api/invitations/' + invitation.id + '/accept',
          { headers, data: {} },
        )
      ).status(),
    ).toBe(200);
  }
  const personal = (
    (await (
      await page.request.get(stack.apiUrl + '/api/organizations')
    ).json()) as { items: { id: string; kind: string }[] }
  ).items.find((org) => org.kind === 'personal')!;
  expect(
    (
      await page.request.post(stack.apiUrl + '/api/organizations/active', {
        headers,
        data: { organizationId: personal.id },
      })
    ).status(),
  ).toBe(200);
  await page.request.post(stack.apiUrl + '/api/identity/onboarding/complete', {
    headers,
    data: {},
  });
  expect(
    (
      await owner.patch(
        stack.apiUrl + '/api/organizations/' + teams[0]!.id + '/settings',
        { headers, data: { require2fa: true } },
      )
    ).status(),
  ).toBe(200);
  await page.goto(stack.frontendUrl + '/workspace');
  await page.getByRole('button', { name: 'Organization: Personal' }).click();
  await page
    .getByRole('menuitem', { name: 'Protected team', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Organization: Personal' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Your current organization is unchanged' }),
  ).toContainText('Your current organization is unchanged');
  await page.getByRole('button', { name: 'Organization: Personal' }).click();
  await page
    .getByRole('menuitem', { name: 'Ordinary team', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Organization: Ordinary team' }),
  ).toBeVisible();
  const invitationsPath = `${stack.frontendUrl}/workspace?settings=invitations`;
  const invitedDataResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/api/organizations/${teams[1]!.id}/invitations`) &&
      response.request().method() === 'GET',
  );
  await page.goto(invitationsPath);
  await expect(
    page.getByRole('heading', { name: 'Invitations', exact: true }),
  ).toBeVisible();
  expect((await invitedDataResponse).status()).toBe(200);
  const acceptedInvitation = page
    .getByRole('row')
    .filter({ hasText: recipient.email });
  await expect(acceptedInvitation).toBeVisible();
  await expect(acceptedInvitation).toContainText('Admin');
  await expect(acceptedInvitation).toContainText('accepted');
  const members = (await (
    await owner.get(
      stack.apiUrl + '/api/organizations/' + teams[1]!.id + '/members',
    )
  ).json()) as { items: { id: string; userId: string; role: string }[] };
  const member = members.items.find((row) => row.userId === recipient.id)!;
  expect(member.role).toBe('admin');
  const protectedRoleRequests: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes(`/api/organizations/${teams[1]!.id}/invitations`)
    )
      protectedRoleRequests.push(request.url());
  });
  const identityRefreshAfterDemotion = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/identity' &&
      response.request().method() === 'GET',
  );
  expect(
    (
      await owner.patch(
        `${stack.apiUrl}/api/organizations/${teams[1]!.id}/members/${member.id}`,
        { headers, data: { role: 'member' } },
      )
    ).status(),
  ).toBe(200);
  expect((await identityRefreshAfterDemotion).status()).toBe(200);
  await expect(
    page.getByText('You do not have access to this section.', { exact: true }),
  ).toBeVisible();
  expect(protectedRoleRequests).toEqual([]);
  let releaseOrganizations!: () => void;
  let releaseIdentity!: () => void;
  let releaseChats!: () => void;
  let organizationsStarted!: () => void;
  let identityStarted!: () => void;
  let chatsStarted!: () => void;
  let organizationsFinished!: () => void;
  let identityFinished!: () => void;
  let chatsFinished!: () => void;
  const organizationsGate = new Promise<void>((resolve) => {
    releaseOrganizations = resolve;
  });
  const identityGate = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });
  const chatsGate = new Promise<void>((resolve) => {
    releaseChats = resolve;
  });
  const organizationsRequestStarted = new Promise<void>((resolve) => {
    organizationsStarted = resolve;
  });
  const identityRequestStarted = new Promise<void>((resolve) => {
    identityStarted = resolve;
  });
  const chatsRequestStarted = new Promise<void>((resolve) => {
    chatsStarted = resolve;
  });
  const organizationsResponseFinished = new Promise<void>((resolve) => {
    organizationsFinished = resolve;
  });
  const identityResponseFinished = new Promise<void>((resolve) => {
    identityFinished = resolve;
  });
  const chatsResponseFinished = new Promise<void>((resolve) => {
    chatsFinished = resolve;
  });
  const organizationsFallbackHeaders: Array<string | undefined> = [];
  const identityFallbackBodies: Array<string | undefined> = [];
  const chatsFallbackHeaders: Array<string | undefined> = [];
  await page.route(
    (url) => url.pathname === '/api/chats',
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      chatsStarted();
      await chatsGate;
      try {
        const response = await route.fetch();
        chatsFallbackHeaders.push(
          response.headers()['x-lexon-fallback-reason'],
        );
        await route.fulfill({ response });
      } finally {
        chatsFinished();
      }
    },
  );
  await page.route(
    (url) => url.pathname === '/api/organizations',
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      organizationsStarted();
      await organizationsGate;
      try {
        const response = await route.fetch();
        organizationsFallbackHeaders.push(
          response.headers()['x-lexon-fallback-reason'],
        );
        releaseChats();
        await chatsResponseFinished;
        await route.fulfill({ response });
      } finally {
        organizationsFinished();
      }
    },
  );
  let holdNextIdentity = true;
  await page.route(
    (url) => url.pathname === '/api/identity',
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      if (holdNextIdentity) {
        holdNextIdentity = false;
        identityStarted();
        await identityGate;
      }
      try {
        const response = await route.fetch();
        if (response.ok()) {
          const body = (await response.json()) as {
            fallbackReason?: string;
          };
          identityFallbackBodies.push(body.fallbackReason);
          await route.fulfill({ response, json: body });
        } else {
          await route.fulfill({ response });
        }
      } finally {
        identityFinished();
      }
    },
  );
  try {
    await page.goto(stack.frontendUrl + '/workspace');
    await organizationsRequestStarted;
    await chatsRequestStarted;
    await expect(
      page.getByRole('button', { name: 'Organization: Ordinary team' }),
    ).toBeVisible();
    let identityRefreshes = 0;
    page.on('response', (response) => {
      if (
        new URL(response.url()).pathname === '/api/identity' &&
        response.request().method() === 'GET' &&
        response.status() === 200
      )
        identityRefreshes += 1;
    });
    expect(
      (
        await owner.delete(
          stack.apiUrl +
            '/api/organizations/' +
            teams[1]!.id +
            '/members/' +
            member.id,
          { headers },
        )
      ).status(),
    ).toBe(204);
    releaseOrganizations();
    await organizationsResponseFinished;
    expect(chatsFallbackHeaders).toContain(undefined);
    await identityRequestStarted;
    releaseIdentity();
    await identityResponseFinished;
    expect(organizationsFallbackHeaders).toContain('membership_removed');
    expect(identityFallbackBodies).toContain(undefined);
    await expect(
      page.getByRole('button', { name: 'Organization: Personal' }),
    ).toBeVisible();
    const fallback = page
      .getByRole('status')
      .filter({ hasText: 'You no longer have access' });
    await expect(fallback).toContainText('You no longer have access');
    await expect(fallback).toHaveCount(1);
    const refreshesAfterFallback = identityRefreshes;
    await expect
      .poll(() => identityRefreshes, { timeout: 15000 })
      .toBeGreaterThan(refreshesAfterFallback);
    await expect(fallback).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Organization: Personal' }),
    ).toBeVisible();
    await page.reload();
    await expect(fallback).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Organization: Personal' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Organization: Personal' }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Ordinary team', exact: true }),
    ).toHaveCount(0);
  } finally {
    releaseChats();
    releaseOrganizations();
    releaseIdentity();
    await page.unrouteAll({ behavior: 'wait' });
    await owner.dispose();
  }
});
