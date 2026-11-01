import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { securityHarness } from '../setup/security-harness.js';
import { totpForUri } from '../setup/totp.js';
import { createSecurityInspector } from '../../src/infrastructure/db/testing/security-fixture.js';

const password = 'Reauthentication-password-42!';
test('old non-MFA session requires password plus the enabled factor; reauthentication does not forge native creation time', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createSecurityInspector(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const old = await proof.signIn({
      body: { email, name: 'Reauth user', password },
    });
    const security = securityHarness(proof);
    const enrolled = await security.enroll(email, password);
    const original = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: old.cookieHeaders }),
    );
    await inspect.ageSession(original!.session.id, 86400);
    const createdAt = (await inspect.session(original!.session.id))!.createdAt;
    await security.identity(old.cookieHeaders, async (identity) => {
      await expect(
        security.service.reauthenticate(identity, { password }),
      ).rejects.toMatchObject({ code: 'AUTH_2FA_REQUIRED' });
      await expect(
        security.service.reauthenticate(identity, {
          password: 'Wrong-password-42!',
          totp: totpForUri(enrolled.totpURI),
        }),
      ).rejects.toBeDefined();
      expect(
        (await inspect.session(identity.sessionId))!.mfaVerifiedAt,
      ).toBeNull();
      await security.service.reauthenticate(identity, {
        password,
        totp: totpForUri(enrolled.totpURI),
      });
      expect(await security.service.state(identity)).toMatchObject({
        twoFactorEnabled: true,
        mfaVerified: true,
        recoveryCodesRemaining: 10,
      });
    });
    const after = await inspect.session(original!.session.id);
    expect(after!.createdAt).toEqual(createdAt);
    expect(after!.mfaVerifiedAt).toBeInstanceOf(Date);
    expect(after!.reauthenticatedAt).toBeInstanceOf(Date);
    await inspect.ageRecent(original!.session.id, 301);
    await expect(
      security.run(
        '/two-factor/generate-backup-codes',
        { password },
        old.cookieHeaders,
      ),
    ).rejects.toMatchObject({ code: 'AUTH_REAUTH_REQUIRED' });
    await security.identity(old.cookieHeaders, (identity) =>
      security.service.reauthenticate(identity, {
        password,
        recoveryCode: enrolled.backupCodes[0]!,
      }),
    );
    const regenerated = await security.run(
      '/two-factor/generate-backup-codes',
      { password },
      old.cookieHeaders,
    );
    expect(
      ((await regenerated.json()) as { backupCodes: string[] }).backupCodes,
    ).toHaveLength(10);
  } finally {
    await inspect.close();
    await proof.close();
  }
});
