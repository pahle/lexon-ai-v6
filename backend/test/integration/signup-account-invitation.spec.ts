import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { unlimitedLimiter } from '../setup/unlimited-limiter.js';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { AccountInvitationsService } from '../../src/modules/platform-console/account-invitations.service.js';
import { AccountService } from '../../src/modules/identity-access/account.service.js';
import { securityHarness } from '../setup/security-harness.js';

const password = 'Account-invite-42!';

test('acceptance after a resend between policy check and accept rolls the sign-up back', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const harness = securityHarness(proof);
    const adminEmail = `${randomUUID()}@example.test`;
    const admin = await proof.signIn({
      body: { name: 'Admin', email: adminEmail, password },
    });
    await proof.inspect.makeAdmin(admin.userId);
    const full = await harness.enroll(adminEmail, password);
    const invitations = new AccountInvitationsService(
      new OrganizationAuthPort(proof.integration),
      { reauthSeconds: 300 },
      unlimitedLimiter,
    );
    const email = `${randomUUID()}@example.test`;
    const created = await harness.identity(full.headers, (i) =>
      invitations.create(i, { email }),
    );
    const oldToken = new URL(
      proof.dispatchedLink(email, 'account-invitation')!,
    ).searchParams.get('accountInvitation')!;
    const accounts = new AccountService(proof.integration, {
      openSignup: false,
    });
    const body = {
      name: 'Raced',
      email,
      password: 'Raced-password-42!',
      accountInvitationToken: oldToken,
    };
    await expect(
      proof.integration.transaction(async (tx) => {
        await accounts.authorizeSignup(tx, body);
        const done = await accounts.prepareOperation(
          tx,
          '/sign-up/email',
          body,
          new Headers(),
        );
        const native = await proof.integration.handle(
          new Request(`${proof.origin}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: {
              origin: proof.origin,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              name: body.name,
              email,
              password: body.password,
            }),
          }),
        );
        expect(native.status).toBeLessThan(400);
        // Resend commits on its own connection after the policy check.
        await proof.inspect.migratorQuery(
          'SELECT * FROM auth.lexon_resend_account_invitation($1::uuid, $2)',
          [
            created.id,
            createHash('sha256')
              .update(randomBytes(32).toString('base64url'))
              .digest('hex'),
          ],
        );
        return done(native);
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(
      await proof.inspect.migratorQuery(
        'SELECT 1 FROM auth."user" WHERE email = $1',
        [email],
      ),
    ).toEqual([]);
  } finally {
    await proof.close();
  }
});
