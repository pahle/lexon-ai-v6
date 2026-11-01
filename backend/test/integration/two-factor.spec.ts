import { randomUUID, createHmac } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { SecurityService } from '../../src/modules/identity-access/security.service.js';
import { totpForUri } from '../setup/totp.js';
import { securityHarness, responseCookies } from '../setup/security-harness.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { createSecurityInspector } from '../../src/infrastructure/db/testing/security-fixture.js';
import { createAuthHttp } from '../../src/modules/identity-access/auth-http.js';
import { createAuthLimiter } from '../../src/infrastructure/queue/index.js';

const password = 'Factor-password-42!';
const cookieHeaders = (response: Response) =>
  new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  });

test('verified enrollment authenticates only its replacement session; old sessions cannot read seeds or change factors', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const original = await proof.signIn({
      body: { name: 'Factor user', email, password },
    });
    const security = new SecurityService(proof.integration, {
      reauthSeconds: 300,
    });
    const run = (
      path: string,
      body: Record<string, unknown>,
      headers: Headers,
    ) =>
      proof.integration.transaction(async (tx) => {
        const done = await security.prepareOperation(tx, path, body, headers);
        const response = await proof.integration.handle(
          new Request(`${proof.origin}/api/auth${path}`, {
            method: 'POST',
            headers: new Headers({
              ...Object.fromEntries(headers),
              origin: proof.origin,
              'content-type': 'application/json',
            }),
            body: JSON.stringify(body),
          }),
        );
        if (response.status >= 400)
          throw new Error('Native factor operation failed');
        return done(response);
      });
    // Apply the normal full-authentication completion to a fresh sign-in.
    const signed = await run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    const current = cookieHeaders(signed);
    const enabled = await run('/two-factor/enable', { password }, current);
    const setup = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(setup.backupCodes).toHaveLength(10);
    expect(
      (
        await proof.integration.transaction((tx) =>
          tx.call('getSession', { headers: current }),
        )
      )?.user.twoFactorEnabled,
    ).toBe(false);
    const validEnrollmentCodes = new Set(
      [-30000, 0, 30000].map((offset) =>
        totpForUri(setup.totpURI, Date.now() + offset),
      ),
    );
    const invalidEnrollmentCode = ['000000', '000001', '000002', '000003'].find(
      (code) => !validEnrollmentCodes.has(code),
    )!;
    await expect(
      run('/two-factor/verify-totp', { code: invalidEnrollmentCode }, current),
    ).rejects.toBeDefined();
    expect(
      (
        await proof.integration.transaction((tx) =>
          tx.call('getSession', { headers: current }),
        )
      )?.user.twoFactorEnabled,
    ).toBe(false);
    await expect(
      run(
        '/two-factor/verify-backup-code',
        { code: setup.backupCodes[0]! },
        current,
      ),
    ).rejects.toMatchObject({ code: 'AUTH_2FA_REQUIRED' });
    const verified = await run(
      '/two-factor/verify-totp',
      { code: totpForUri(setup.totpURI) },
      current,
    );
    const full = cookieHeaders(verified);
    const fresh = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: full }),
    );
    expect(fresh?.user.twoFactorEnabled).toBe(true);
    expect(fresh?.session.mfaVerifiedAt).toBeInstanceOf(Date);
    const old = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: original.cookieHeaders }),
    );
    expect(old?.session.mfaVerifiedAt).toBeNull();
    for (const path of [
      '/two-factor/get-totp-uri',
      '/two-factor/disable',
      '/two-factor/generate-backup-codes',
    ])
      await expect(
        run(path, { password }, original.cookieHeaders),
      ).rejects.toMatchObject({ code: 'AUTH_2FA_REQUIRED' });
    await expect(
      run(
        '/two-factor/verify-totp',
        { code: totpForUri(setup.totpURI) },
        original.cookieHeaders,
      ),
    ).rejects.toMatchObject({ code: 'AUTH_2FA_REQUIRED' });
    await expect(
      run(
        '/two-factor/verify-totp',
        { code: totpForUri(setup.totpURI), trustDevice: true },
        full,
      ),
    ).rejects.toBeDefined();
    const challenge = await run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    expect(await challenge.clone().json()).toMatchObject({
      twoFactorRedirect: true,
    });
    const pending = cookieHeaders(challenge);
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: pending }),
      ),
    ).toBeNull();
    const recovered = await run(
      '/two-factor/verify-backup-code',
      { code: setup.backupCodes[0]! },
      pending,
    );
    const recoveredSession = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: cookieHeaders(recovered) }),
    );
    expect(recoveredSession?.session.mfaVerifiedAt).toBeInstanceOf(Date);
    await expect(
      run(
        '/two-factor/verify-backup-code',
        { code: setup.backupCodes[0]! },
        cookieHeaders(recovered),
      ),
    ).rejects.toBeDefined();
  } finally {
    await proof.close();
  }
});

test('failed factor audit survives auth rollback and contains no submitted code', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const audit = createAuditInspector(services);
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:factor-failure:rl:auth:`,
  });
  try {
    const email = `${randomUUID()}@example.test`;
    const user = await proof.signIn({
      body: { name: 'Factor failure user', email, password },
    });
    const security = securityHarness(proof);
    const enrolled = await security.enroll(email, password);
    const challenge = await security.run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    const valid = new Set(
      [-30000, 0, 30000].map((offset) =>
        totpForUri(enrolled.totpURI, Date.now() + offset),
      ),
    );
    const code = ['000000', '000001', '000002', '000003'].find(
      (candidate) => !valid.has(candidate),
    )!;
    const handler = createAuthHttp(proof.integration, {
      origin: proof.origin,
      correlationSecret: 'a'.repeat(48),
      limiter,
      context: () => ({
        rawPath: '/api/auth/two-factor/verify-totp',
        peerAddress: '127.0.0.1',
      }),
      accountKey: async () =>
        createHmac('sha256', 'a'.repeat(48)).update(user.userId).digest('hex'),
      authorize: async (rule, { tx, body, request }) =>
        security.service.prepareOperation(tx, rule.path, body, request.headers),
      failed: async (_rule, _body, request) =>
        security.service.recordFailedFactor(request.headers),
    });
    const before = await audit.count('identity.sign_in_failed.v1');
    const response = await handler(
      new Request(`${proof.origin}/api/auth/two-factor/verify-totp`, {
        method: 'POST',
        headers: new Headers({
          ...Object.fromEntries(responseCookies(challenge)),
          origin: proof.origin,
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ code }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await audit.count('identity.sign_in_failed.v1')).toBe(before + 1);
    expect(JSON.stringify(await response.json())).not.toContain(code);
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: responseCookies(challenge) }),
      ),
    ).toBeNull();
  } finally {
    await limiter.close();
    await audit.close();
    await proof.close();
  }
});

test('a previously valid native trusted-device cookie cannot bypass the F1 challenge', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:trust:rl:auth:`,
  });
  try {
    const email = `${randomUUID()}@example.test`;
    await proof.signIn({
      body: { name: 'Untrusted device user', email, password },
    });
    const security = securityHarness(proof);
    const enrolled = await security.enroll(email, password);
    const challenge = await security.run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    const trusted = await proof.integration.transaction((tx) =>
      tx.call('verifyTOTP', {
        headers: responseCookies(challenge),
        body: { code: totpForUri(enrolled.totpURI), trustDevice: true },
        asResponse: true,
      }),
    );
    expect(
      trusted.headers
        .getSetCookie()
        .some((value) => value.startsWith('better-auth.trust_device=')),
    ).toBe(true);
    const handler = createAuthHttp(proof.integration, {
      origin: proof.origin,
      correlationSecret: 'a'.repeat(48),
      limiter,
      context: () => ({
        rawPath: '/api/auth/sign-in/email',
        peerAddress: '127.0.0.1',
      }),
      authorize: async (_rule, { tx, body, request }) =>
        security.service.prepareOperation(
          tx,
          '/sign-in/email',
          body,
          request.headers,
        ),
    });
    const response = await handler(
      new Request(`${proof.origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: new Headers({
          ...Object.fromEntries(responseCookies(trusted)),
          origin: proof.origin,
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toMatchObject({
      twoFactorRedirect: true,
    });
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: responseCookies(response) }),
      ),
    ).toBeNull();
  } finally {
    await limiter.close();
    await proof.close();
  }
});

test('concurrent recovery-code reuse has exactly one success and one new authenticated session', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const email = `${randomUUID()}@example.test`;
    await proof.signIn({ body: { name: 'Recovery user', email, password } });
    const security = securityHarness(proof);
    const enrolled = await security.enroll(email, password);
    const first = await security.run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    const second = await security.run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    const before = await proof.inspect.countSessions(email);
    const results = await Promise.allSettled(
      [first, second].map((challenge) =>
        security.run(
          '/two-factor/verify-backup-code',
          { code: enrolled.backupCodes[0]! },
          responseCookies(challenge),
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await proof.inspect.countSessions(email)).toBe(before + 1);
  } finally {
    await proof.close();
  }
});

test('audit failure rolls back verified enrollment, its replacement session and recovery-code regeneration', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  let audit = createAuditInspector(services);
  try {
    const email = `${randomUUID()}@example.test`;
    await proof.signIn({
      body: { name: 'Audit factor user', email, password },
    });
    const security = securityHarness(proof);
    const signed = await security.run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    const headers = responseCookies(signed);
    const setup = (await (
      await security.run('/two-factor/enable', { password }, headers)
    ).json()) as { totpURI: string; backupCodes: string[] };
    const before = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers }),
    );
    await audit.rejectInserts();
    await expect(
      security.run(
        '/two-factor/verify-totp',
        { code: totpForUri(setup.totpURI) },
        headers,
      ),
    ).rejects.toBeDefined();
    const rolledBack = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers }),
    );
    expect(rolledBack?.session.id).toBe(before!.session.id);
    expect(rolledBack?.user.twoFactorEnabled).toBe(false);
    expect(rolledBack?.session.mfaVerifiedAt).toBeNull();
    await audit.close();
    audit = createAuditInspector(services);
    const verified = await security.run(
      '/two-factor/verify-totp',
      { code: totpForUri(setup.totpURI) },
      headers,
    );
    const full = responseCookies(verified);
    await audit.rejectInserts();
    await expect(
      security.run('/two-factor/generate-backup-codes', { password }, full),
    ).rejects.toBeDefined();
    await audit.close();
    audit = createAuditInspector(services);
    await expect(
      security.run(
        '/two-factor/verify-backup-code',
        { code: setup.backupCodes[0]! },
        full,
      ),
    ).resolves.toBeInstanceOf(Response);
  } finally {
    await audit.close();
    await proof.close();
  }
});

test('database protects evidence and bearer cap across refresh and security replacement', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createSecurityInspector(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const user = await proof.signIn({
      body: { name: 'Protected session user', email, password },
    });
    const security = securityHarness(proof);
    const enrolled = await security.enroll(email, password);
    const original = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: enrolled.headers }),
    );
    const id = original!.session.id;
    const otherChallenge = await security.run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    const otherFull = responseCookies(
      await security.run(
        '/two-factor/verify-totp',
        { code: totpForUri(enrolled.totpURI) },
        responseCookies(otherChallenge),
      ),
    );
    expect(
      (await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: otherFull }),
      ))!.session.mfaVerifiedAt,
    ).toBeInstanceOf(Date);
    await inspect.ageSession(id, 600);
    for (const field of [
      'mfa',
      'recent',
      'channel',
      'cap',
      'creation',
    ] as const)
      await expect(
        inspect.attemptProtectedWrite(id, field),
      ).rejects.toMatchObject({ code: '23514' });
    await expect(inspect.attemptAppEvidence()).rejects.toMatchObject({
      code: '42501',
    });
    expect(await inspect.protectedFunction()).toEqual({
      owner: 'lexon_migrator',
      safePath: true,
      publicExecute: false,
      authExecute: true,
      appExecute: false,
    });
    const personal = await proof.inspect.personalFor(user.userId);
    await proof.inspect.makeAdmin(user.userId);
    const cap = new Date(Date.now() + 900000);
    await inspect.seedBearer(id, cap, personal!.orgId);
    const bearerToken = (await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: enrolled.headers }),
    ))!.session.token;
    const bearerHeaders = new Headers({
      authorization: `Bearer ${bearerToken}`,
    });
    await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: bearerHeaders }),
    );
    expect((await inspect.session(id))!.hardExpiresAt).toEqual(cap);
    const disabled = await security.run(
      '/two-factor/disable',
      { password },
      bearerHeaders,
    );
    const next = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: responseCookies(disabled) }),
    );
    expect(next!.session.id).not.toBe(id);
    expect(next!.user.role).toBe('admin');
    expect(await inspect.session(next!.session.id)).toMatchObject({
      channel: 'bearer',
      hardExpiresAt: cap,
      expiresAt: cap,
      activeOrganizationId: personal!.orgId,
      mfaVerifiedAt: null,
      reauthenticatedAt: null,
    });
    expect(
      (
        await proof.integration.transaction((tx) =>
          tx.call('getSession', { headers: user.cookieHeaders }),
        )
      )?.session.mfaVerifiedAt,
    ).toBeNull();
    const other = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: otherFull }),
    );
    expect(other!.session.mfaVerifiedAt).toBeNull();
    expect(other!.session.reauthenticatedAt).toBeNull();
  } finally {
    await inspect.close();
    await proof.close();
  }
});
