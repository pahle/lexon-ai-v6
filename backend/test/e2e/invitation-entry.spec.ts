import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { descriptor } from './runtime-support.js';
import { authenticateApi, readCapturedMail } from './identity-support.js';
test('invitation new recipient signs up verifies and accepts without exposing another account', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  const owner = await playwright.request.newContext();
  const headers = await authenticateApi(owner);
  const teamResponse = await owner.post(stack.apiUrl + '/api/organizations', {
    headers,
    data: { name: 'Invited team', slug: 'invite-' + randomUUID().slice(0, 8) },
  });
  expect(teamResponse.status()).toBe(201);
  const team = (await teamResponse.json()) as { id: string };
  const email = randomUUID() + '@example.test';
  const invited = await owner.post(
    stack.apiUrl + '/api/organizations/' + team.id + '/invitations',
    { headers, data: { email, role: 'member' } },
  );
  expect(invited.status()).toBe(201);
  await page.goto(
    (await readCapturedMail(stack.project, email, 'invitation')).actionUrl,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('link', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Invited identity');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Browser-password-42!');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();
  await page.goto(
    (await readCapturedMail(stack.project, email, 'verification')).actionUrl,
  );
  let releaseScripts!: () => void;
  let heldScriptRequests = 0;
  const scriptsGate = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route('**/*.js*', async (route) => {
    heldScriptRequests += 1;
    await scriptsGate;
    await route.continue();
  });
  const authSignInPaths: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/sign-in/email') {
      authSignInPaths.push(new URL(request.url()).pathname);
    }
  });
  const signInNavigation = page
    .getByRole('link', { name: 'Sign in', exact: true })
    .click();
  try {
    await expect.poll(() => new URL(page.url()).pathname).toBe('/sign-in');
    await expect.poll(() => heldScriptRequests).toBeGreaterThan(0);
    await expect(page.getByLabel('Email', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Password', { exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Show password', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeDisabled();
  } finally {
    releaseScripts();
    await signInNavigation.catch(() => undefined);
    await page.unroute('**/*.js*');
  }
  await expect(page.getByLabel('Email', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Password', { exact: true })).toBeEnabled();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Browser-password-42!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe('/accept-invitation');
  await page.waitForLoadState('load');
  expect(authSignInPaths).toEqual(['/api/auth/sign-in/email']);
  await page
    .getByRole('button', { name: 'Accept invitation', exact: true })
    .click();
  await expect(page).toHaveURL(/\/(workspace|onboarding)/);
  const identity = await page.request.get(stack.frontendUrl + '/api/identity');
  expect(identity.status()).toBe(200);
  expect(
    ((await identity.json()) as { organization: { id: string } }).organization
      .id,
  ).toBe(team.id);
  await owner.dispose();
});
test('invitation belonging to another account reveals no organization or recipient', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  const owner = await playwright.request.newContext();
  const headers = await authenticateApi(owner);
  const response = await owner.post(stack.apiUrl + '/api/organizations', {
    headers,
    data: {
      name: 'Private invite sentinel',
      slug: 'private-' + randomUUID().slice(0, 8),
    },
  });
  const team = (await response.json()) as { id: string };
  const email = randomUUID() + '@example.test';
  const inviteResponse = await owner.post(
    stack.apiUrl + '/api/organizations/' + team.id + '/invitations',
    { headers, data: { email, role: 'member' } },
  );
  expect(inviteResponse.status()).toBe(201);
  const invitation = (await inviteResponse.json()) as { id: string };
  await authenticateApi(page.request);
  await page.goto(
    stack.frontendUrl + '/accept-invitation?invitationId=' + invitation.id,
  );
  await page
    .getByRole('button', { name: 'Accept invitation', exact: true })
    .click();
  await expect(page.locator('[data-slot="alert"]')).toContainText(
    'This invitation is unavailable for this account.',
  );
  const text = await page.locator('body').innerText();
  expect(text.includes(email) || text.includes('Private invite sentinel')).toBe(
    false,
  );
  await owner.dispose();
});
