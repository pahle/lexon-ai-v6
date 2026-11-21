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
test('disable refusals: self, last administrator, concurrent last two; enable still works', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createSecurityInspector(services);
  try {
    const harness = securityHarness(proof);
    const port = new OrganizationAuthPort(proof.integration);
    const service = new PlatformAdminService(port, { reauthSeconds: 300 });
    const mk = async (label: string) => {
      const email = `${randomUUID()}@example.test`;
      const u = await proof.signIn({
        body: { name: label, email, password },
      });
      await proof.inspect.makeAdmin(u.userId);
      const full = await harness.enroll(email, password);
      return { id: u.userId, headers: full.headers };
    };
    const a = await mk('Admin A');
    const b = await mk('Admin B');
    await harness.identity(a.headers, async (identity) => {
      await expect(
        service.setDisabled(identity, a.id, true),
      ).rejects.toMatchObject({ code: 'PLATFORM_SELF_ACTION', status: 409 });
    });
    // Two enabled admins, each disables the other concurrently. A barrier
    // inside both transactions (after policy facts) forces real overlap.
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const racing = new PlatformAdminService(
      Object.assign(Object.create(port) as OrganizationAuthPort, {
        platformTransaction: <T>(
          identity: Parameters<OrganizationAuthPort['platformTransaction']>[0],
          seconds: number,
          work: Parameters<OrganizationAuthPort['platformTransaction']>[2],
        ): Promise<T> =>
          port.platformTransaction(identity, seconds, async (tx, h) => {
            if (++arrived === 2) release();
            await gate;
            return work(tx, h) as Promise<T>;
          }),
      }),
      { reauthSeconds: 300 },
    );
    const results = await Promise.allSettled([
      harness.identity(a.headers, (i) => racing.setDisabled(i, b.id, true)),
      harness.identity(b.headers, (i) => racing.setDisabled(i, a.id, true)),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Each transaction already holds its own user row (security facts), so the
    // two disables deadlock; Postgres aborts one and its retry finds the
    // actor disabled (401). A loser that reaches the count gets the 409.
    expect((rejected[0] as PromiseRejectedResult).reason).toSatisfy(
      (e: { code: string; status: number }) =>
        (e.code === 'PLATFORM_LAST_ADMINISTRATOR' && e.status === 409) ||
        (e.code === 'AUTH_REQUIRED' && e.status === 401),
    );
    const winner = results[0]!.status === 'fulfilled' ? a : b;
    const loser = winner === a ? b : a;
    await harness.identity(winner.headers, (i) =>
      service.setDisabled(i, loser.id, false),
    );
  } finally {
    await inspect.close();
    await proof.close();
  }
});
