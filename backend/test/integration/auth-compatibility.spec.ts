import { randomUUID } from 'node:crypto';
import { expect, expectTypeOf } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  createAuthFixture as fixture,
  type AuthCommandSession,
} from '../../src/infrastructure/db/testing/auth-fixture.js';

const signup = (prefix: string) => ({
  body: {
    name: 'Compatibility probe',
    email: `${prefix}-${randomUUID()}@example.test`,
    password: 'Compatibility-password-42!',
  },
});

// These tests exercise native APIs and PostgreSQL, not mocked adapters.
test('boots Nest 12 ESM with four plugins, preserves auth body and parses normal JSON', async ({
  services,
}) => {
  const proof = await fixture(services);
  try {
    const origin = await proof.startNest();
    expect(proof.pluginIds()).toEqual(
      expect.arrayContaining(['organization', 'admin', 'two-factor', 'bearer']),
    );
    const input = signup('http');
    const response = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: proof.origin },
      body: JSON.stringify(input.body),
    });
    expect(response.status).toBe(200);
    expect(await proof.inspect.countUsers(input.body.email)).toBe(1);
    const json = await fetch(`${origin}/api/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"value":"parsed"}',
    });
    expect(json.status).toBe(201);
    expect(await json.json()).toEqual({ value: 'parsed' });
    expect(
      (
        await fetch(`${origin}/api/probe`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: 'x'.repeat(2000) }),
        })
      ).status,
    ).toBe(413);
  } finally {
    await proof.close();
  }
});

test('uses only auth-schema tables and the non-owner auth role', async ({
  services,
}) => {
  const proof = await fixture(services);
  try {
    expect(await proof.inspect.storage()).toEqual({
      role: 'lexon_auth',
      owner: 'lexon_migrator',
      schemas: ['auth'],
      tables: [
        'account',
        'invitation',
        'member',
        'organization',
        'session',
        'two_factor',
        'user',
        'verification',
      ],
      appUsage: false,
      opsUsage: false,
      appCanReadSession: false,
    });
  } finally {
    await proof.close();
  }
});

test('resolves native cookie and Bearer sessions through getSession', async ({
  services,
}) => {
  const proof = await fixture(services);
  try {
    const identity = await proof.signIn(signup('session'));
    const cookie = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: identity.cookieHeaders }),
    );
    const bearer = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: identity.bearerHeaders }),
    );
    const response = await proof.integration.transaction((tx) =>
      tx.call('getSession', {
        headers: identity.cookieHeaders,
        asResponse: true,
      }),
    );
    expectTypeOf(response).toEqualTypeOf<Response>();
    expect(response.status).toBe(200);
    const withHeaders = await proof.integration.transaction((tx) =>
      tx.call('getSession', {
        headers: identity.cookieHeaders,
        returnHeaders: true,
      }),
    );
    expectTypeOf(withHeaders.headers).toEqualTypeOf<Headers>();
    expect(withHeaders.response?.user.id).toBe(identity.userId);
    expect(cookie?.user.id).toBe(identity.userId);
    expect(bearer?.session.id).toBe(cookie?.session.id);
  } finally {
    await proof.close();
  }
});

test('rolls back multiple native APIs and rejects a retained command capability', async ({
  services,
}) => {
  const proof = await fixture(services);
  const input = signup('rollback');
  const slug = `rollback-${randomUUID()}`;
  let retained: AuthCommandSession | undefined;
  try {
    await expect(
      proof.integration.transaction(async (tx) => {
        retained = tx;
        const user = await tx.call('signUpEmail', input);
        await tx.call('createOrganization', {
          body: { name: 'Rollback', slug, userId: user.user.id },
        });
        expect(await proof.inspect.countUsers(input.body.email)).toBe(0);
        throw new Error('rollback-probe');
      }),
    ).rejects.toThrow('rollback-probe');
    expect(await proof.inspect.countUsers(input.body.email)).toBe(0);
    expect(await proof.inspect.countOrganizations(slug)).toBe(0);
    await expect(retained!.call('signUpEmail', input)).rejects.toThrow(
      'Auth command session expired',
    );
  } finally {
    await proof.close();
  }
});

test('rolls back native TOTP direct base-adapter writes', async ({
  services,
}) => {
  const proof = await fixture(services);
  const input = signup('totp');
  try {
    const identity = await proof.signIn(input);
    await expect(
      proof.integration.transaction(async (tx) => {
        const result = await tx.call('enableTwoFactor', {
          headers: identity.cookieHeaders,
          body: { password: input.body.password },
        });
        expect(result.method).toBe('totp');
        if (result.method !== 'totp')
          throw new Error('Expected native TOTP enrollment');
        expect(result.totpURI).toMatch(/^otpauth:/);
        throw new Error('totp-rollback');
      }),
    ).rejects.toThrow('totp-rollback');
    expect(await proof.inspect.countTwoFactors(identity.userId)).toBe(0);
  } finally {
    await proof.close();
  }
});

test('isolates simultaneous command callbacks and commits only the successful one', async ({
  services,
}) => {
  const proof = await fixture(services);
  const first = signup('concurrent-a');
  const second = signup('concurrent-b');
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function rendezvous() {
    if (++arrived === 2) release();
    await barrier;
  }
  try {
    const results = await Promise.allSettled([
      proof.integration.transaction(async (tx) => {
        await tx.call('signUpEmail', first);
        await rendezvous();
        throw new Error('one-aborts');
      }),
      proof.integration.transaction(async (tx) => {
        await tx.call('signUpEmail', second);
        await rendezvous();
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'fulfilled',
    ]);
    expect(await proof.inspect.countUsers(first.body.email)).toBe(0);
    expect(await proof.inspect.countUsers(second.body.email)).toBe(1);
  } finally {
    await proof.close();
  }
});

test('withholds a successful Response and its credentials when commit fails', async ({
  services,
}) => {
  const proof = await fixture(services);
  const input = signup('commit');
  try {
    await proof.signIn(input);
    await proof.inspect.rejectSessionCommits();
    let released: Response | undefined;
    await expect(
      proof.integration
        .handle(
          new Request(`${proof.origin}/api/auth/sign-in/email`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: proof.origin,
            },
            body: JSON.stringify({
              email: input.body.email,
              password: input.body.password,
            }),
          }),
        )
        .then((response) => {
          released = response;
        }),
    ).rejects.toThrow();
    expect(released).toBeUndefined();
    expect(proof.lastNativeResponse()?.status).toBe(200);
    expect(proof.lastNativeResponse()?.headers.has('set-cookie')).toBe(true);
    expect(await proof.inspect.countSessions(input.body.email)).toBe(1);
  } finally {
    await proof.close();
  }
});

test('rolls back handler writes when native dispatch converts an error into a Response', async ({
  services,
}) => {
  const proof = await fixture(services, { rejectSignupResponse: true });
  const input = signup('failed-response');
  try {
    const response = await proof.integration.handle(
      new Request(`${proof.origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: proof.origin },
        body: JSON.stringify(input.body),
      }),
    );
    expect(response.status).toBe(400);
    expect(await proof.inspect.countUsers(input.body.email)).toBe(0);
    expect(proof.mailWasDispatched(input.body.email)).toBe(false);
  } finally {
    await proof.close();
  }
});

test('defers injected mail callbacks until the outer commit and discards them on rollback', async ({
  services,
}) => {
  const proof = await fixture(services);
  const committed = signup('mail-commit');
  const aborted = signup('mail-abort');
  try {
    await proof.integration.transaction(async (tx) => {
      await tx.call('signUpEmail', committed);
      expect(proof.mailWasDispatched(committed.body.email)).toBe(false);
    });
    expect(proof.mailWasDispatched(committed.body.email)).toBe(true);
    await expect(
      proof.integration.transaction(async (tx) => {
        await tx.call('signUpEmail', aborted);
        throw new Error('mail-rollback');
      }),
    ).rejects.toThrow('mail-rollback');
    expect(proof.mailWasDispatched(aborted.body.email)).toBe(false);
  } finally {
    await proof.close();
  }
});

test('rolls back a server command that requests an error Response', async ({
  services,
}) => {
  const proof = await fixture(services, { rejectSignupResponse: true });
  const input = signup('command-response');
  try {
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('signUpEmail', {
          ...input,
          asResponse: true,
        }),
      ),
    ).rejects.toThrow('Auth command failed');
    expect(await proof.inspect.countUsers(input.body.email)).toBe(0);
    expect(proof.mailWasDispatched(input.body.email)).toBe(false);
  } finally {
    await proof.close();
  }
});
