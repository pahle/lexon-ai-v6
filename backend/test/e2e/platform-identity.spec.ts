import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { readCapturedMail, authenticateApi } from './identity-support.js';
import { operatorSetup, signupMode } from './setup-support.js';
import { totpForUri } from '../setup/totp.js';
test('administrator setup is operator-only and platform provisioning never creates staff membership', async ({
  page,
  playwright,
}) => {
  test.setTimeout(120000);
  const stack = descriptor();
  const email = randomUUID() + '@example.test';
  const password = 'Platform-browser-42!';
  const target = await playwright.request.newContext();
  await authenticateApi(target);
  const targetProfile = (await (
    await target.get(stack.apiUrl + '/api/identity/profile')
  ).json()) as { id: string; email: string };
  await signupMode(false);
  try {
    const setup = await operatorSetup(email);
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
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
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
    await expect(
      page.getByRole('heading', { name: 'Administrator setup complete' }),
    ).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    await page.getByRole('link', { name: 'Provisioning', exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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
    await page
      .getByRole('link', { name: 'Provisioned team', exact: true })
      .click();
    await expect(page.getByText('provisioning', { exact: true })).toBeVisible();
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
    await page
      .getByRole('button', { name: 'Confirm cancellation', exact: true })
      .click();
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
      .getByRole('link', { name: 'Account status', exact: true })
      .click();
    await page.getByLabel('User ID', { exact: true }).fill(targetProfile.id);
    await page
      .getByRole('button', { name: 'Disable account', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Account status updated',
    );
    expect((await target.get(stack.apiUrl + '/api/identity')).status()).toBe(
      401,
    );
    await page
      .getByRole('button', { name: 'Enable account', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Account status updated',
    );
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
    await target.dispose();
  }
});
