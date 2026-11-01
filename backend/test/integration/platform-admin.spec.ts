import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { PlatformAdminService } from '../../src/modules/identity-access/platform-admin.service.js';
import { SessionService } from '../../src/modules/identity-access/session.service.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { securityHarness, responseCookies } from '../setup/security-harness.js';
import { createSecurityInspector } from '../../src/infrastructure/db/testing/security-fixture.js';
const password = 'Platform-disable-42!';
test('fresh fully authenticated platform admin disables and revokes both credential classes; unban restores no sessions', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createSecurityInspector(services);
  try {
    const adminEmail = `${randomUUID()}@example.test`;
    const admin = await proof.signIn({
      body: { name: 'Disable admin', email: adminEmail, password },
    });
    const recipientEmail = `${randomUUID()}@example.test`;
    const user = await proof.signIn({
      body: { name: 'Disabled user', email: recipientEmail, password },
    });
    const harness = securityHarness(proof);
    const port = new OrganizationAuthPort(proof.integration);
    const service = new PlatformAdminService(port, { reauthSeconds: 300 });
    await harness.identity(user.cookieHeaders, async (identity) => {
      await expect(
        service.setDisabled(identity, admin.userId, true),
      ).rejects.toMatchObject({ status: 403 });
    });
    await proof.inspect.makeAdmin(admin.userId);
    await harness.identity(admin.cookieHeaders, async (identity) => {
      await expect(
        service.setDisabled(identity, user.userId, true),
      ).rejects.toMatchObject({ status: 403 });
    });
    const full = await harness.enroll(adminEmail, password);
    const cookie = responseCookies(
      await harness.run(
        '/sign-in/email',
        { email: recipientEmail, password },
        new Headers(),
      ),
    );
    const bearer = await harness.identity(cookie, (identity) =>
      new SessionService(port, { bearerSeconds: 900 }).issueBearer(identity),
    );
    await harness.identity(full.headers, (identity) =>
      service.setDisabled(identity, user.userId, true),
    );
    const identities = new IdentitySessionService(proof.integration);
    for (const headers of [
      user.cookieHeaders,
      cookie,
      new Headers({ authorization: `Bearer ${bearer.token}` }),
    ])
      await expect(
        identities.resolve(headers, { kind: 'account' }),
      ).rejects.toMatchObject({ status: 401 });
    await harness.identity(full.headers, (identity) =>
      service.setDisabled(identity, user.userId, false),
    );
    await expect(
      identities.resolve(cookie, { kind: 'account' }),
    ).rejects.toMatchObject({ status: 401 });
    const session = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: full.headers }),
    );
    await inspect.ageRecent(session!.session.id, 301);
    await harness.identity(full.headers, async (identity) => {
      await expect(
        service.setDisabled(identity, user.userId, true),
      ).rejects.toMatchObject({ code: 'AUTH_REAUTH_REQUIRED' });
    });
  } finally {
    await inspect.close();
    await proof.close();
  }
});
