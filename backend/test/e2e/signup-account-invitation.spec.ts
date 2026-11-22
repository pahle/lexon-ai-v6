import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { containerId, descriptor, docker } from './runtime-support.js';
import { readCapturedMail, waitForHydration } from './identity-support.js';
import { enrollAdministrator } from './brand-visual-platform-world.js';
import { withSignupMode } from './setup-support.js';

test.setTimeout(300000);

const password = 'Invited-signup-42!';
const psql = async (sql: string) =>
  docker([
    'exec',
    await containerId('postgres'),
    'sh',
    '-c',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U postgres -d lexon -v ON_ERROR_STOP=1 -At -c "$0"',
    sql,
  ]);

const inviter = (admin: APIRequestContext) => async (email: string) => {
  const stack = descriptor();
  const created = await admin.post(
    `${stack.apiUrl}/api/platform/account-invitations`,
    { headers: { origin: stack.frontendUrl }, data: { email } },
  );
  expect(created.status(), await created.text()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  const mail = await readCapturedMail(
    stack.project,
    email,
    'account-invitation',
  );
  return {
    id,
    token: new URL(mail.actionUrl).searchParams.get('accountInvitation')!,
  };
};

test('sign-up with an account invitation while public sign-up is closed', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  const origin = { origin: stack.frontendUrl };
  const platform = (path: string) => `${stack.apiUrl}/api/platform${path}`;
  await enrollAdministrator(
    page,
    `signup.invites.${Date.now().toString(36)}@example.test`,
  );
  const admin: APIRequestContext = page.request;
  const invite = inviter(admin);
  const signUp = async (email: string, accountInvitationToken?: string) => {
    const client = await playwright.request.newContext();
    return client.post(stack.apiUrl + '/api/auth/sign-up/email', {
      headers: origin,
      data: {
        name: 'Invited Person',
        email,
        password,
        ...(accountInvitationToken ? { accountInvitationToken } : {}),
      },
    });
  };
  const users = (email: string) =>
    psql(`SELECT count(*) FROM auth."user" WHERE email = '${email}'`);

  await withSignupMode(false, async () => {
    // Plain sign-up is refused.
    const plain = `${randomUUID()}@example.test`;
    expect((await signUp(plain)).status()).toBe(401);
    expect(await users(plain)).toBe('0');

    // A valid token signs up; the address is verified and active.
    const email = `${randomUUID()}@example.test`;
    const first = await invite(email);
    const ok = await signUp(email, first.token);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(
      await psql(
        `SELECT u.email_verified, coalesce(u.banned,false), (SELECT count(*) FROM auth.member m JOIN auth.organization o ON o.id=m.organization_id WHERE m.user_id=u.id AND o.kind='team'), (SELECT count(*) FROM auth.organization o WHERE o.personal_owner_id=u.id) FROM auth."user" u WHERE u.email='${email}'`,
      ),
    ).toBe('t|f|0|1');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const accepted = await psql(
      `SELECT subject_user_id = actor_user_id, metadata->>'invitationId' = '${first.id}' FROM ops.audit_events WHERE type='platform.account_invitation_accepted.v1' AND metadata->>'invitationId'='${first.id}'`,
    );
    expect(accepted).toBe('t|t');
    expect(
      await docker([
        'exec',
        await containerId('api'),
        'node',
        'backend/test/e2e/mail-control.mjs',
        email,
        'verification',
      ]),
    ).toMatch(/^null/);

    // Reused token and the invitation list no longer show it.
    const reused = await signUp(`${randomUUID()}@example.test`, first.token);
    expect(reused.status()).toBe(401);

    // Wrong email.
    const second = await invite(`${randomUUID()}@example.test`);
    const wrong = `${randomUUID()}@example.test`;
    expect((await signUp(wrong, second.token)).status()).toBe(401);
    expect(await users(wrong)).toBe('0');

    // Cancelled.
    const cancelledEmail = `${randomUUID()}@example.test`;
    const cancelled = await invite(cancelledEmail);
    expect(
      (
        await admin.delete(platform(`/account-invitations/${cancelled.id}`), {
          headers: origin,
        })
      ).status(),
    ).toBe(204);
    expect((await signUp(cancelledEmail, cancelled.token)).status()).toBe(401);

    // Superseded by a resend: the old token is refused, the new one works.
    const resentEmail = `${randomUUID()}@example.test`;
    const resent = await invite(resentEmail);
    expect(
      (
        await admin.post(platform(`/account-invitations/${resent.id}/resend`), {
          headers: origin,
        })
      ).status(),
    ).toBe(204);
    expect((await signUp(resentEmail, resent.token)).status()).toBe(401);
    expect(await users(resentEmail)).toBe('0');
  });
});

test('invitation sign-up in the browser skips the verify-email screen, lands on sign-in with returnTo, and signs in right away', async ({
  page,
  browser,
}) => {
  const stack = descriptor();
  await enrollAdministrator(
    page,
    `signup.browser.${Date.now().toString(36)}@example.test`,
  );
  const invite = inviter(page.request);
  const context = await browser.newContext();
  const visitor = await context.newPage();
  try {
    await withSignupMode(false, async () => {
      const email = `${randomUUID()}@example.test`;
      const { token } = await invite(email);
      const fillSignUp = async (address: string) => {
        await waitForHydration(
          visitor.getByRole('button', { name: 'Create account', exact: true }),
        );
        await visitor
          .getByLabel('Full name', { exact: true })
          .fill('Invited Browser Person');
        await visitor.getByLabel('Work email', { exact: true }).fill(address);
        await visitor.getByLabel('Password', { exact: true }).fill(password);
        const response = visitor.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname === '/api/auth/sign-up/email' &&
            candidate.request().method() === 'POST',
        );
        await visitor
          .getByRole('button', { name: 'Create account', exact: true })
          .click();
        return response;
      };

      await visitor.goto(
        `${stack.frontendUrl}/sign-up?accountInvitation=${encodeURIComponent(token)}&returnTo=%2Fworkspace`,
      );
      expect((await fillSignUp(email)).status()).toBe(200);
      await expect(visitor).toHaveURL(
        `${stack.frontendUrl}/sign-in?returnTo=%2Fworkspace`,
      );
      await expect(
        visitor.getByRole('heading', { name: 'Verify your email' }),
      ).toHaveCount(0);

      await waitForHydration(
        visitor.getByRole('button', { name: 'Sign in', exact: true }),
      );
      await visitor.getByLabel('Email', { exact: true }).fill(email);
      await visitor.getByLabel('Password', { exact: true }).fill(password);
      const signedIn = visitor.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/auth/sign-in/email' &&
          response.request().method() === 'POST',
      );
      await visitor
        .getByRole('button', { name: 'Sign in', exact: true })
        .click();
      expect((await signedIn).status()).toBe(200);
      await expect(visitor).toHaveURL(/\/(workspace|onboarding)/);
      expect(
        await psql(
          `SELECT email_verified, coalesce(banned,false) FROM auth."user" WHERE email='${email}'`,
        ),
      ).toBe('t|f');
      expect(
        await docker([
          'exec',
          await containerId('api'),
          'node',
          'backend/test/e2e/mail-control.mjs',
          email,
          'verification',
        ]),
      ).toMatch(/^null/);

      // A reused token is refused with the invitation unavailable state.
      await visitor.context().clearCookies();
      await visitor.goto(
        `${stack.frontendUrl}/sign-up?accountInvitation=${encodeURIComponent(token)}`,
      );
      const refused = await fillSignUp(`${randomUUID()}@example.test`);
      expect(refused.status()).toBe(401);
      expect(await refused.json()).toEqual({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' },
      });
      await expect(
        visitor.getByRole('heading', { name: 'Invitation unavailable' }),
      ).toBeVisible();
      await expect(
        visitor.getByRole('link', { name: 'Go to Lexon', exact: true }),
      ).toBeVisible();
    });
  } finally {
    await context.close();
  }
});
