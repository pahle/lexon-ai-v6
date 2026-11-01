import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createSelectionInspector } from '../../src/infrastructure/db/testing/selection-fixture.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { SessionService } from '../../src/modules/identity-access/session.service.js';
import { securityHarness, responseCookies } from '../setup/security-harness.js';
const password = 'Own-sessions-42!';
test('session listing omits credentials and expired entries; foreign IDs cannot be revoked', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createSelectionInspector(services);
  try {
    const [owner, other] = await Promise.all(
      ['Own', 'Foreign'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const harness = securityHarness(proof);
    const service = new SessionService(
      new OrganizationAuthPort(proof.integration),
      { bearerSeconds: 900 },
    );
    const foreign = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: other!.cookieHeaders }),
    );
    await harness.identity(owner!.cookieHeaders, async (identity) => {
      const list = await service.list(identity);
      expect(Object.keys(list[0]!).sort()).toEqual([
        'channel',
        'createdAt',
        'current',
        'expiresAt',
        'id',
        'version',
      ]);
      expect(list[0]!.current).toBe(true);
      await expect(
        service.revoke(identity, foreign!.session.id),
      ).rejects.toMatchObject({ status: 403 });
    });
    await inspect.invalidate(other!.userId, foreign!.session.id, 'expired');
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: other!.cookieHeaders }),
      ),
    ).toBeNull();
  } finally {
    await inspect.close();
    await proof.close();
  }
});
test('enabled MFA requires actual session proof before issuing Bearer; ambiguous credentials are denied', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const user = await proof.signIn({
      body: { name: 'Factor bearer', email, password },
    });
    const harness = securityHarness(proof);
    const service = new SessionService(
      new OrganizationAuthPort(proof.integration),
      { bearerSeconds: 900 },
    );
    const old = responseCookies(
      await harness.run('/sign-in/email', { email, password }, new Headers()),
    );
    const full = await harness.enroll(email, password);
    await harness.identity(old, async (identity) => {
      await expect(service.issueBearer(identity)).rejects.toMatchObject({
        status: 403,
      });
    });
    const token = await harness.identity(full.headers, (identity) =>
      service.issueBearer(identity),
    );
    expect(token.token.length).toBeGreaterThan(20);
    const ambiguous = new Headers(full.headers);
    ambiguous.set('authorization', `Bearer ${token.token}`);
    await harness.identity(full.headers, async (identity) => {
      await expect(
        service.issueBearer({ ...identity, channel: 'bearer' }),
      ).rejects.toMatchObject({ status: 401 });
    });
    await expect(
      new IdentitySessionService(proof.integration).resolve(ambiguous, {
        kind: 'workspace',
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(user.userId).toBeTruthy();
  } finally {
    await proof.close();
  }
});

test('audit failure rolls back Bearer creation and own-session revocation without exposing credentials', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const audits = createAuditInspector(services);
  try {
    const email = `${randomUUID()}@example.test`;
    await proof.signIn({ body: { name: 'Session audit', email, password } });
    const harness = securityHarness(proof);
    const cookie = responseCookies(
      await harness.run('/sign-in/email', { email, password }, new Headers()),
    );
    const service = new SessionService(
      new OrganizationAuthPort(proof.integration),
      { bearerSeconds: 900 },
    );
    const issued = await harness.identity(cookie, (identity) =>
      service.issueBearer(identity),
    );
    const before = await harness.identity(cookie, (identity) =>
      service.list(identity),
    );
    await audits.rejectInserts();
    await harness.identity(cookie, async (identity) => {
      await expect(service.issueBearer(identity)).rejects.toThrow();
      await expect(
        service.revoke(identity, issued.sessionId),
      ).rejects.toThrow();
    });
    expect(
      await harness.identity(cookie, (identity) => service.list(identity)),
    ).toEqual(before);
    expect(
      (
        await new IdentitySessionService(proof.integration).resolve(
          new Headers({ authorization: `Bearer ${issued.token}` }),
          { kind: 'workspace' },
        )
      ).identity.sessionId,
    ).toBe(issued.sessionId);
  } finally {
    await audits.close();
    await proof.close();
  }
});

test('all live sessions remain discoverable and revocable beyond the adapter default page', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const email = `${randomUUID()}@example.test`;
    await proof.signIn({
      body: {
        name: 'Many sessions',
        email,
        password,
      },
    });
    const harness = securityHarness(proof);
    const service = new SessionService(
      new OrganizationAuthPort(proof.integration),
      { bearerSeconds: 900 },
    );
    const cookie = responseCookies(
      await harness.run('/sign-in/email', { email, password }, new Headers()),
    );
    await harness.identity(cookie, async (identity) => {
      const issuedIds: string[] = [];
      for (let index = 0; index < 101; index++) {
        issuedIds.push((await service.issueBearer(identity)).sessionId);
      }
      const listed = await service.list(identity);
      expect(listed).toHaveLength(103);
      expect(listed.find((row) => row.current)?.id).toBe(identity.sessionId);
      expect(listed.map((row) => row.id)).toEqual(
        expect.arrayContaining([identity.sessionId, ...issuedIds]),
      );
      await service.revoke(identity, issuedIds[0]!);
      const remaining = await service.list(identity);
      expect(remaining).toHaveLength(102);
      expect(remaining.some((row) => row.id === issuedIds[0])).toBe(false);
    });
  } finally {
    await proof.close();
  }
});
