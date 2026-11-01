import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { randomUUID } from 'node:crypto';
test('onboarding and organization switches preserve Personal and last owner', async ({
  page,
}) => {
  const stack = descriptor();
  await authenticateApi(page.request);
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
  await expect(page.getByTestId('active-organization')).toHaveText('Personal');
  await expect(
    page.getByRole('link', { name: 'Organization settings', exact: true }),
  ).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole('button', { name: 'Switch to First team', exact: true })
    .click();
  await expect(page.getByTestId('active-organization')).toHaveText(
    'First team',
  );
  await page.getByRole('link', { name: 'Members', exact: true }).click();
  await page
    .getByRole('button', { name: 'Leave organization', exact: true })
    .click();
  await expect(page.locator('[data-slot="field-error"]')).toContainText(
    'Promote another owner',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('organization entry clears stale cookies without a redirect loop', async ({
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
test('organization 2FA standby and member removal preserve safe Personal selection', async ({
  page,
  playwright,
}) => {
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
      { headers, data: { email: recipient.email, role: 'member' } },
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
  await page
    .getByRole('button', { name: 'Switch to Protected team', exact: true })
    .click();
  await expect(page.getByTestId('active-organization')).toHaveText('Personal');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Your current organization is unchanged' }),
  ).toContainText('Your current organization is unchanged');
  await page
    .getByRole('button', { name: 'Switch to Ordinary team', exact: true })
    .click();
  await expect(page.getByTestId('active-organization')).toHaveText(
    'Ordinary team',
  );
  const members = (await (
    await owner.get(
      stack.apiUrl + '/api/organizations/' + teams[1]!.id + '/members',
    )
  ).json()) as { items: { id: string; userId: string }[] };
  const member = members.items.find((row) => row.userId === recipient.id)!;
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
  await expect(page.getByTestId('active-organization')).toHaveText('Personal');
  await expect(
    page.getByRole('status').filter({ hasText: 'You no longer have access' }),
  ).toContainText('You no longer have access');
  await expect(
    page.getByRole('button', { name: 'Switch to Ordinary team', exact: true }),
  ).toHaveCount(0);
  await owner.dispose();
});
