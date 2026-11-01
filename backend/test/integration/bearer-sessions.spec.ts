import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createSelectionInspector } from '../../src/infrastructure/db/testing/selection-fixture.js';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { SessionService } from '../../src/modules/identity-access/session.service.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { securityHarness, responseCookies } from '../setup/security-harness.js';
import { createSecurityInspector } from '../../src/infrastructure/db/testing/security-fixture.js';
for (const seconds of [900, 120])
  test(`cookie issues a separate Bearer row with immutable ${seconds}s hard cap`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    const inspect = createSecurityInspector(services);
    try {
      const email = `${randomUUID()}@example.test`;
      const password = 'Bearer-session-42!';
      await proof.signIn({ body: { name: 'Bearer owner', email, password } });
      const harness = securityHarness(proof);
      const cookieHeaders = responseCookies(
        await harness.run('/sign-in/email', { email, password }, new Headers()),
      );
      const service = new SessionService(
        new OrganizationAuthPort(proof.integration),
        { bearerSeconds: seconds },
      );
      const token = await harness.identity(cookieHeaders, (identity) =>
        service.issueBearer(identity),
      );
      const stored = await inspect.session(token.sessionId);
      expect(stored!.channel).toBe('bearer');
      expect(stored!.expiresAt.toISOString()).toBe(token.expiresAt);
      expect(
        stored!.hardExpiresAt!.getTime() - stored!.createdAt.getTime(),
      ).toBe(seconds * 1000);
      const headers = new Headers({ authorization: `Bearer ${token.token}` });
      const identities = new IdentitySessionService(proof.integration);
      expect(
        (await identities.resolve(headers, { kind: 'workspace' })).identity,
      ).toMatchObject({ sessionId: token.sessionId, channel: 'bearer' });
      await harness.identity(headers, async (identity) => {
        await expect(service.issueBearer(identity)).rejects.toMatchObject({
          status: 403,
        });
      });
      const before = stored!.expiresAt;
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers }),
      );
      expect((await inspect.session(token.sessionId))!.expiresAt).toEqual(
        before,
      );
      const list = await harness.identity(cookieHeaders, (identity) =>
        service.list(identity),
      );
      expect(list.map((row) => row.channel).sort()).toEqual([
        'bearer',
        'cookie',
        'cookie',
      ]);
      expect(JSON.stringify(list)).not.toContain(token.token);
      await harness.identity(cookieHeaders, (identity) =>
        service.revoke(identity, token.sessionId),
      );
      await expect(
        identities.resolve(headers, { kind: 'workspace' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(
        (await identities.resolve(cookieHeaders, { kind: 'workspace' }))
          .identity.channel,
      ).toBe('cookie');
    } finally {
      await inspect.close();
      await proof.close();
    }
  });

test('Bearer selection is independent, cookie replay is rejected, and expiry excludes the session', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const expiry = createSelectionInspector(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const password = 'Bearer-selection-42!';
    const user = await proof.signIn({
      body: { name: 'Bearer selection', email, password },
    });
    const harness = securityHarness(proof);
    const cookie = responseCookies(
      await harness.run('/sign-in/email', { email, password }, new Headers()),
    );
    const identities = new IdentitySessionService(proof.integration);
    const service = new SessionService(
      new OrganizationAuthPort(proof.integration),
      { bearerSeconds: 900 },
    );
    const issued = await harness.identity(cookie, (identity) =>
      service.issueBearer(identity),
    );
    const bearer = new Headers({ authorization: `Bearer ${issued.token}` });
    const team = await organizations.seedTeam([user.userId]);
    await harness.identity(bearer, (identity) =>
      identities.select(identity, team.id),
    );
    expect(
      (await identities.resolve(bearer, { kind: 'workspace' })).summary
        .organization.id,
    ).toBe(team.id);
    expect(
      (await identities.resolve(cookie, { kind: 'workspace' })).summary
        .organization.kind,
    ).toBe('personal');
    await harness.identity(bearer, async (identity) => {
      await expect(
        identities.select(identity, randomUUID()),
      ).rejects.toMatchObject({ status: 403 });
    });
    const cookieValue = cookie
      .get('cookie')!
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('better-auth.session_token='))!
      .split('=')
      .slice(1)
      .join('=');
    await expect(
      identities.resolve(
        new Headers({
          authorization: `Bearer ${decodeURIComponent(cookieValue)}`,
        }),
        { kind: 'workspace' },
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      identities.resolve(
        new Headers({ cookie: `better-auth.session_token=${issued.token}` }),
        { kind: 'workspace' },
      ),
    ).rejects.toMatchObject({ status: 401 });
    await harness.identity(cookie, (identity) =>
      service.revoke(identity, identity.sessionId),
    );
    expect(
      (await identities.resolve(bearer, { kind: 'workspace' })).identity
        .sessionId,
    ).toBe(issued.sessionId);
    await expiry.invalidate(user.userId, issued.sessionId, 'expired');
    await expect(
      identities.resolve(bearer, { kind: 'workspace' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (
        await harness.identity(user.cookieHeaders, (identity) =>
          service.list(identity),
        )
      ).some((row) => row.id === issued.sessionId),
    ).toBe(false);
  } finally {
    await expiry.close();
    await organizations.close();
    await proof.close();
  }
});
