import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAccountInspector } from '../../src/infrastructure/db/testing/account-fixture.js';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { AccountService } from '../../src/modules/identity-access/account.service.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { withVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import { createAuthHttp } from '../../src/modules/identity-access/auth-http.js';
import { createAuthLimiter } from '../../src/infrastructure/queue/index.js';

test('HTTP signup and reset use fixed safe responses without waiting for SMTP', async ({
  services,
}) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const proof = await createAuthFixture(services, {
    mailTransport: {
      sendMail: async () => {
        await blocked;
        throw new Error('smtp-private-sentinel');
      },
    },
  });
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:account:rl:auth:`,
  });
  const account = new AccountService(proof.integration, { openSignup: true });
  const http = createAuthHttp(proof.integration, {
    origin: proof.origin,
    correlationSecret: 'a'.repeat(48),
    limiter,
    context: () => ({
      rawPath: '/api/auth/sign-up/email',
      peerAddress: '127.0.0.1',
    }),
    authorize: async (rule, { tx, body }) => {
      if (rule.path === '/sign-up/email')
        await account.authorizeSignup(tx, body);
    },
  });
  try {
    const user = input();
    const send = (body: unknown) =>
      http(
        new Request(`${proof.origin}/api/auth/sign-up/email`, {
          method: 'POST',
          headers: { origin: proof.origin, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    const first = await send(user.body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: true });
    expect(first.headers.getSetCookie()).toEqual([]);
    const duplicate = await send(user.body);
    expect(duplicate.status).toBe(first.status);
    expect(await duplicate.json()).toEqual({ status: true });
    expect(proof.mailDeliveryState().pending).toBeGreaterThan(0);
    release();
    await proof.drainMail();
    expect(proof.mailDeliveryState().failed).toBeGreaterThan(0);
    const resetHttp = createAuthHttp(proof.integration, {
      origin: proof.origin,
      correlationSecret: 'a'.repeat(48),
      limiter,
      context: () => ({
        rawPath: '/api/auth/request-password-reset',
        peerAddress: '127.0.0.1',
      }),
      authorize: async () => {},
    });
    for (const email of [user.body.email, `${randomUUID()}@example.test`]) {
      const response = await resetHttp(
        new Request(`${proof.origin}/api/auth/request-password-reset`, {
          method: 'POST',
          headers: { origin: proof.origin, 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: true });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  } finally {
    release();
    await limiter.close();
    await proof.close();
  }
});

test('own profile accepts only the display name and onboarding is idempotent', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const identity = await proof.signIn(input());
    const personal = await proof.inspect.personalFor(identity.userId);
    const account = new AccountService(proof.integration, { openSignup: true });
    await withVerifiedIdentity(
      {
        userId: identity.userId,
        sessionId: randomUUID(),
        activeOrganizationId: personal!.orgId,
        channel: 'cookie',
        platformAdmin: false,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
      },
      async (verified) => {
        const before = await account.profile(verified);
        expect(before.onboardingCompleted).toBe(false);
        await expect(
          account.updateProfile(verified, {
            name: 'Changed',
            role: 'admin',
          } as never),
        ).rejects.toBeDefined();
        expect(
          await account.updateProfile(verified, { name: ' Changed ' }),
        ).toMatchObject({ id: identity.userId, name: 'Changed' });
        await account.completeOnboarding(verified);
        await account.completeOnboarding(verified);
        expect(await account.profile(verified)).toMatchObject({
          name: 'Changed',
          onboardingCompleted: true,
        });
      },
    );
  } finally {
    await proof.close();
  }
});

test('password reset and its ID-only audit commit together; an audit failure preserves the proof and old credentials', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  let audit = createAuditInspector(services);
  const inspect = createAccountInspector(services);
  try {
    const user = input();
    const identity = await proof.signIn(user);
    const unrelated = await proof.signIn(input());
    await proof.integration.transaction((tx) =>
      tx.call('requestPasswordReset', {
        body: { email: user.body.email, redirectTo: proof.origin },
      }),
    );
    const token = new URL(
      proof.dispatchedLink(user.body.email, 'reset')!,
    ).pathname
      .split('/')
      .at(-1)!;
    const body = { token, newPassword: 'Reset-audit-password-42!' };
    const account = new AccountService(proof.integration, { openSignup: true });
    const reset = () =>
      proof.integration.transaction(async (tx) => {
        const done = await account.prepareOperation(
          tx,
          '/reset-password',
          body,
          unrelated.cookieHeaders,
        );
        const response = await tx.call('resetPassword', {
          body,
          asResponse: true,
        });
        await done(response);
      });
    const before = await audit.count('identity.account_changed.v1');
    await audit.rejectInserts();
    await expect(reset()).rejects.toBeDefined();
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: identity.cookieHeaders }),
      ),
    ).not.toBeNull();
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('signInEmail', { body: { email: user.body.email, password } }),
      ),
    ).resolves.toHaveProperty('user.id');
    await audit.close();
    audit = createAuditInspector(services);
    await reset();
    expect(await audit.count('identity.account_changed.v1')).toBe(before + 1);
    expect(await inspect.lastAccountChange()).toEqual({
      subject_user_id: identity.userId,
      actor_user_id: null,
    });
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: identity.cookieHeaders }),
      ),
    ).toBeNull();
  } finally {
    await inspect.close();
    await audit.close();
    await proof.close();
  }
});

const password = 'Account-password-42!';
const input = () => ({
  body: {
    email: `${randomUUID()}@example.test`,
    name: 'Account user',
    password,
  },
});

test('configured cookie and link lifetimes reach the pinned auth engine', async ({
  services,
}) => {
  const proof = await createAuthFixture(services, {
    policy: {
      cookieSeconds: 7200,
      cookieRefreshSeconds: 3600,
      reauthSeconds: 120,
      verificationSeconds: 60,
      resetSeconds: 180,
    },
  });
  const migrator = createAccountInspector(services);
  try {
    const user = input();
    const identity = await proof.signIn(user);
    const session = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: identity.cookieHeaders }),
    );
    const lifetime =
      session!.session.expiresAt.getTime() -
      session!.session.createdAt.getTime();
    expect(lifetime).toBeLessThanOrEqual(7200000);
    expect(lifetime).toBeGreaterThan(7199950);
    const token = new URL(
      proof.dispatchedLink(user.body.email)!,
    ).searchParams.get('token')!;
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1]!, 'base64url').toString(),
    ) as { exp: number; iat: number };
    expect(payload.exp - payload.iat).toBe(60);
    await proof.integration.transaction((tx) =>
      tx.call('requestPasswordReset', { body: { email: user.body.email } }),
    );
    const reset = new URL(
      proof.dispatchedLink(user.body.email, 'reset')!,
    ).pathname
      .split('/')
      .at(-1)!;
    const seconds = await migrator.resetLifetime(reset);
    expect(seconds).toBeGreaterThan(179);
    expect(seconds).toBeLessThanOrEqual(180);
  } finally {
    await migrator.close();
    await proof.close();
  }
});

test('expired verification can be resent; wrong password and disabled account have one generic response and separate audit', async ({
  services,
}) => {
  const proof = await createAuthFixture(services, {
    policy: { verificationSeconds: 3600 },
  });
  const migrator = createAccountInspector(services);
  const audit = createAuditInspector(services);
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:signin:rl:auth:`,
  });
  try {
    const user = input();
    await proof.integration.transaction((tx) => tx.call('signUpEmail', user));
    const url = new URL(proof.dispatchedLink(user.body.email)!);
    url.searchParams.delete('callbackURL');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 7200000);
    expect((await proof.integration.handle(new Request(url))).status).toBe(401);
    vi.useRealTimers();
    await proof.integration.transaction((tx) =>
      tx.call('sendVerificationEmail', { body: { email: user.body.email } }),
    );
    const fresh = new URL(proof.dispatchedLink(user.body.email)!);
    fresh.searchParams.delete('callbackURL');
    expect((await proof.integration.handle(new Request(fresh))).status).toBe(
      200,
    );
    const account = new AccountService(proof.integration, {
      openSignup: true,
      audit: { secret: 'h'.repeat(48), keyId: 'test-v1' },
    });
    const http = createAuthHttp(proof.integration, {
      origin: proof.origin,
      correlationSecret: 'a'.repeat(48),
      limiter,
      context: () => ({
        rawPath: '/api/auth/sign-in/email',
        peerAddress: '127.0.0.1',
      }),
      authorize: async (_rule, { tx, body, request }) =>
        account.prepareOperation(tx, '/sign-in/email', body, request.headers),
      failed: async (_rule, body) =>
        account.recordFailedSignIn(String(body.email)),
    });
    const send = (email: string, pass: string) =>
      http(
        new Request(`${proof.origin}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { origin: proof.origin, 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: pass }),
        }),
      );
    const before = await audit.count('identity.sign_in_failed.v1');
    const wrong = await send(user.body.email, 'Wrong-password-42!');
    expect(wrong.status).toBe(401);
    await migrator.banByEmail(user.body.email);
    const disabled = await send(user.body.email, password);
    expect(disabled.status).toBe(wrong.status);
    expect(await disabled.json()).toEqual(await wrong.json());
    const absent = await send(`${randomUUID()}@example.test`, password);
    expect(absent.status).toBe(401);
    expect(await audit.count('identity.sign_in_failed.v1')).toBe(before + 3);
    const record = await migrator.lastFailedSignIn();
    expect(record.subject_user_id).toBeNull();
    expect(record.metadata.subjectHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain('@');
  } finally {
    vi.useRealTimers();
    await limiter.close();
    await audit.close();
    await migrator.close();
    await proof.close();
  }
});

test('a wrong current password preserves sessions; a correct change revokes other sessions', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const user = input();
    const identity = await proof.signIn(user);
    const other = await proof.integration.transaction((tx) =>
      tx.call('signInEmail', { body: { email: user.body.email, password } }),
    );
    const secondHeaders = new Headers({
      authorization: `Bearer ${other.token}`,
    });
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('changePassword', {
          headers: identity.cookieHeaders,
          body: {
            currentPassword: 'Wrong-password-42!',
            newPassword: 'Changed-password-42!',
            revokeOtherSessions: true,
          },
        }),
      ),
    ).rejects.toBeDefined();
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: secondHeaders }),
      ),
    ).not.toBeNull();
    await proof.integration.transaction((tx) =>
      tx.call('changePassword', {
        headers: identity.cookieHeaders,
        body: {
          currentPassword: password,
          newPassword: 'Changed-password-42!',
          revokeOtherSessions: true,
        },
      }),
    );
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: secondHeaders }),
      ),
    ).toBeNull();
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('signInEmail', {
          body: { email: user.body.email, password: 'Changed-password-42!' },
        }),
      ),
    ).resolves.toHaveProperty('user.id');
  } finally {
    await proof.close();
  }
});

test('signup requires verification; duplicate signup has no additional effect', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const user = input();
    const signup = await proof.integration.transaction((tx) =>
      tx.call('signUpEmail', { ...user, asResponse: true }),
    );
    expect(signup.status).toBe(200);
    expect(signup.headers.getSetCookie()).toEqual([]);
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('signInEmail', { body: { email: user.body.email, password } }),
      ),
    ).rejects.toBeDefined();
    const duplicate = await proof.integration.transaction((tx) =>
      tx.call('signUpEmail', { ...user, asResponse: true }),
    );
    expect(duplicate.status).toBe(signup.status);
    expect(await proof.inspect.countUsers(user.body.email)).toBe(1);
    const url = new URL(proof.dispatchedLink(user.body.email)!);
    url.searchParams.delete('callbackURL');
    const verified = await proof.integration.handle(new Request(url));
    expect(verified.status).toBe(200);
    expect(verified.headers.getSetCookie()).toEqual([]);
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('signInEmail', { body: { email: user.body.email, password } }),
      ),
    ).resolves.toHaveProperty('user.id');
  } finally {
    await proof.close();
  }
});

test('password reset consumes its proof and revokes every session atomically', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const user = input();
    const identity = await proof.signIn(user);
    await proof.integration.transaction((tx) =>
      tx.call('requestPasswordReset', {
        body: { email: user.body.email, redirectTo: proof.origin },
      }),
    );
    const link = new URL(proof.dispatchedLink(user.body.email, 'reset')!);
    const token = link.pathname.split('/').at(-1)!;
    const body = { token, newPassword: 'Replacement-password-42!' };
    await proof.integration.transaction((tx) =>
      tx.call('resetPassword', { body }),
    );
    expect(
      await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: identity.cookieHeaders }),
      ),
    ).toBeNull();
    await expect(
      proof.integration.transaction((tx) => tx.call('resetPassword', { body })),
    ).rejects.toBeDefined();
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('signInEmail', { body: { email: user.body.email, password } }),
      ),
    ).rejects.toBeDefined();
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('signInEmail', {
          body: { email: user.body.email, password: body.newPassword },
        }),
      ),
    ).resolves.toHaveProperty('user.id');
  } finally {
    await proof.close();
  }
});

test('email changes only when the new address is verified', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const user = input();
    const identity = await proof.signIn(user);
    const competing = input();
    await proof.signIn(competing);
    const beforeCount = await proof.inspect.countSessions(user.body.email);
    const competingResponse = await proof.integration.transaction((tx) =>
      tx.call('changeEmail', {
        headers: identity.cookieHeaders,
        body: { newEmail: competing.body.email },
        asResponse: true,
      }),
    );
    expect(competingResponse.status).toBe(200);
    expect(await competingResponse.json()).toEqual({ status: true });
    expect(await proof.inspect.countSessions(user.body.email)).toBe(
      beforeCount,
    );
    const newEmail = `${randomUUID()}@example.test`;
    await proof.integration.transaction((tx) =>
      tx.call('changeEmail', {
        headers: identity.cookieHeaders,
        body: { newEmail },
      }),
    );
    const before = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: identity.cookieHeaders }),
    );
    expect(before?.user.email).toBe(user.body.email);
    const url = new URL(proof.dispatchedLink(newEmail)!);
    url.searchParams.delete('callbackURL');
    expect((await proof.integration.handle(new Request(url))).status).toBe(200);
    const after = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: identity.cookieHeaders }),
    );
    expect(after?.user.email).toBe(newEmail);
    expect(after?.user.id).toBe(identity.userId);
  } finally {
    await proof.close();
  }
});

test('changing an email preserves consumed invitation ownership by user ID', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const migrator = createAccountInspector(services);
  try {
    const user = input();
    const identity = await proof.signIn(user);
    const organization = await proof.integration.transaction((tx) =>
      tx.call('createOrganization', {
        body: {
          name: 'Inviting firm',
          slug: `firm-${randomUUID()}`,
          userId: identity.userId,
        },
      }),
    );
    const invitationId = randomUUID();
    await migrator.seedConsumedInvitation({
      id: invitationId,
      organizationId: organization!.id,
      email: user.body.email,
      userId: identity.userId,
    });
    const newEmail = `${randomUUID()}@example.test`;
    await proof.integration.transaction((tx) =>
      tx.call('changeEmail', {
        headers: identity.cookieHeaders,
        body: { newEmail },
      }),
    );
    const url = new URL(proof.dispatchedLink(newEmail)!);
    url.searchParams.delete('callbackURL');
    const account = new AccountService(proof.integration, { openSignup: true });
    await proof.integration.transaction(async (tx) => {
      const done = await account.prepareOperation(
        tx,
        '/verify-email',
        { token: url.searchParams.get('token') },
        identity.cookieHeaders,
      );
      await done(
        await proof.integration.handle(
          new Request(url, { headers: identity.cookieHeaders }),
        ),
      );
    });
    const row = await migrator.invitationBinding(invitationId);
    expect(row).toEqual({
      accepted_by_user_id: identity.userId,
      email: user.body.email,
    });
  } finally {
    await migrator.close();
    await proof.close();
  }
});

test('email-change link commits its ID-only audit without issuing a session when opened signed out', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const audit = createAuditInspector(services);
  try {
    const user = input();
    const identity = await proof.signIn(user);
    const newEmail = `${randomUUID()}@example.test`;
    await proof.integration.transaction((tx) =>
      tx.call('changeEmail', {
        headers: identity.cookieHeaders,
        body: { newEmail },
      }),
    );
    const url = new URL(proof.dispatchedLink(newEmail)!);
    url.searchParams.delete('callbackURL');
    const account = new AccountService(proof.integration, { openSignup: true });
    const before = await proof.inspect.countSessions(user.body.email);
    const eventCount = await audit.count('identity.account_changed.v1');
    const response = await proof.integration.transaction(async (tx) => {
      const done = await account.prepareOperation(
        tx,
        '/verify-email',
        { token: url.searchParams.get('token') },
        new Headers(),
      );
      return done(await proof.integration.handle(new Request(url)));
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.has('set-auth-token')).toBe(false);
    expect(await proof.inspect.countSessions(newEmail)).toBe(before);
    expect(await audit.count('identity.account_changed.v1')).toBe(
      eventCount + 1,
    );
    const updated = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: identity.cookieHeaders }),
    );
    expect(updated?.user).toMatchObject({
      id: identity.userId,
      email: newEmail,
    });
  } finally {
    await audit.close();
    await proof.close();
  }
});
