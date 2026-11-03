import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { randomUUID } from 'node:crypto';

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
    name: 'Settings',
    exact: true,
  });
  await expect(settingsMenuItem).toBeFocused();
  const documentBeforeSettingsNavigation = await page.evaluate(
    () => performance.timeOrigin,
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/profile$/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(
    documentBeforeSettingsNavigation,
  );
  await page.goto(stack.frontendUrl + '/settings/appearance');
  const systemTheme = page.getByRole('radio', { name: 'System' });
  await tabTo(page, systemTheme);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);

  await tabTo(page, userMenu);
  await page.keyboard.press('ArrowDown');
  await expect(settingsMenuItem).toBeFocused();
  const signOut = page.getByRole('menuitem', { name: 'Sign out', exact: true });
  await expect(signOut).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Profile settings',
      exact: true,
    }),
  ).toBeFocused();
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
    `${stack.frontendUrl}/organizations/${otherId}/settings/invitations`,
  );
  await expect(page.locator('section[role="alert"]')).toContainText(
    'You no longer have access to this organization',
  );
  expect(protectedRequests).toEqual([]);
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
  await expect(page.getByRole('status')).toContainText('Team created');
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
  await page.goto(
    `${stack.frontendUrl}/organizations/${firstTeamId}/settings/members`,
  );
  await page
    .getByRole('button', { name: 'Leave organization', exact: true })
    .click();
  await expect(page.locator('[data-slot="field-error"]')).toContainText(
    'Promote another owner',
  );
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
    page.getByRole('heading', { name: 'Sign in', exact: true }),
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
  const invitationsPath = `${stack.frontendUrl}/organizations/${teams[1]!.id}/settings/invitations`;
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
    .locator('main li')
    .filter({ hasText: recipient.email });
  await expect(acceptedInvitation).toBeVisible();
  await expect(acceptedInvitation).toContainText('admin — accepted');
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
  expect(
    (
      await owner.patch(
        `${stack.apiUrl}/api/organizations/${teams[1]!.id}/members/${member.id}`,
        { headers, data: { role: 'member' } },
      )
    ).status(),
  ).toBe(200);
  await expect(page.locator('section[role="alert"]')).toContainText(
    'You do not have access to this organization setting.',
  );
  expect(protectedRoleRequests).toEqual([]);
  await page.goto(stack.frontendUrl + '/workspace');
  await expect(
    page.getByRole('button', { name: 'Organization: Ordinary team' }),
  ).toBeVisible();
  let identityRefreshes = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/identity')
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
  await owner.dispose();
});
