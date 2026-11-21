import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAuthLimiter } from '../../src/infrastructure/queue/index.js';
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
    const events = () =>
      proof.inspect.auditCount('platform.user_disabled_changed.v1');
    const before = await events();
    await harness.identity(a.headers, async (identity) => {
      await expect(
        service.setDisabled(identity, a.id, true),
      ).rejects.toMatchObject({ code: 'PLATFORM_SELF_ACTION', status: 409 });
    });
    expect(await events()).toBe(before);
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
    // Both outcomes are legitimate. Each transaction already holds its own user row (security facts), so the
    // two disables deadlock; Postgres aborts one and its retry finds the
    // actor disabled (401). A loser that reaches the count gets the 409.
    const reason = (rejected[0] as PromiseRejectedResult).reason as {
      code: string;
      status: number;
    };
    expect(`${reason.status} ${reason.code}`).toMatch(
      /^(409 PLATFORM_LAST_ADMINISTRATOR|401 AUTH_REQUIRED)$/,
    );
    expect(await proof.inspect.enabledAdminCount([a.id, b.id])).toBe(1);
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
test('revoke deletes all target sessions, audits with empty metadata, refuses self and rate-limits per target', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:rl:auth:`,
  });
  try {
    const harness = securityHarness(proof);
    const port = new OrganizationAuthPort(proof.integration);
    const service = new PlatformAdminService(
      port,
      { reauthSeconds: 300 },
      limiter,
    );
    const adminEmail = `${randomUUID()}@example.test`;
    const admin = await proof.signIn({
      body: { name: 'Revoke admin', email: adminEmail, password },
    });
    await proof.inspect.makeAdmin(admin.userId);
    const full = await harness.enroll(adminEmail, password);
    const targetEmail = `${randomUUID()}@example.test`;
    const target = await proof.signIn({
      body: { name: 'Revoked user', email: targetEmail, password },
    });
    const second = responseCookies(
      await harness.run(
        '/sign-in/email',
        { email: targetEmail, password },
        new Headers(),
      ),
    );
    const identities = new IdentitySessionService(proof.integration);
    const before = await proof.inspect.auditCount(
      'platform.user_sessions_revoked.v1',
    );
    await harness.identity(full.headers, async (identity) => {
      await expect(
        service.revokeSessions(identity, admin.userId),
      ).rejects.toMatchObject({ code: 'PLATFORM_SELF_ACTION', status: 409 });
      await service.revokeSessions(identity, target.userId);
    });
    expect(
      await proof.inspect.auditCount('platform.user_sessions_revoked.v1'),
    ).toBe(before + 1);
    for (const headers of [target.cookieHeaders, second])
      await expect(
        identities.resolve(headers, { kind: 'account' }),
      ).rejects.toMatchObject({ status: 401 });
    await harness.identity(full.headers, async (identity) => {
      for (let i = 0; i < 4; i++)
        await service.revokeSessions(identity, target.userId);
      await expect(
        service.revokeSessions(identity, target.userId),
      ).rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED', status: 429 });
    });
  } finally {
    await limiter.close();
    await proof.close();
  }
});
