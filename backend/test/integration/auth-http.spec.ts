import { DEFAULT_AUTH_RATE_RULES } from '../../src/config/auth-rate-config.js';
import { randomUUID } from 'node:crypto';
import { request as nodeRequest } from 'node:http';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createAuthLimiter } from '../../src/infrastructure/queue/index.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
import {
  createAuthHttp,
  createAuthRequestContext,
  classifyAuthEndpoint,
  IdentityAccessModule,
} from '../../src/modules/identity-access/index.js';

test('entire native endpoint inventory defaults to HTTP denial for both credential channels', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:http:rl:auth:`,
  });
  const context = createAuthRequestContext();
  const http = createAuthHttp(proof.integration, {
    origin: proof.origin,
    correlationSecret: 'a'.repeat(48),
    limiter,
    context: context.read,
    authorize: async () => {},
  });
  try {
    const origin = await proof.startNest({
      handler: http,
      middleware: context.middleware,
      moduleFactory: IdentityAccessModule.forIntegration,
    });
    const input = {
      body: {
        name: 'HTTP test',
        email: `${randomUUID()}@example.test`,
        password: 'HTTP-password-42!',
      },
    };
    const identity = await proof.signIn(input);
    const excluded = proof
      .endpointInventory()
      .filter(
        (endpoint) =>
          !classifyAuthEndpoint(
            endpoint.method,
            `/api/auth${endpoint.path.replace(/:[^/]+/g, 'opaque')}`,
          ),
      );
    expect(excluded.length).toBeGreaterThan(20);
    for (const headers of [identity.cookieHeaders, identity.bearerHeaders]) {
      for (const endpoint of excluded) {
        const path = endpoint.path.replace(/:[^/]+/g, 'opaque');
        const response = await fetch(`${origin}/api/auth${path}`, {
          method: endpoint.method,
          headers,
        });
        expect(response.status, `${endpoint.method} ${endpoint.path}`).toBe(
          404,
        );
      }
    }
    const slug = `internal-${randomUUID()}`;
    await proof.integration.transaction((tx) =>
      tx.call('createOrganization', {
        body: { name: 'Internal', slug, userId: identity.userId },
      }),
    );
    expect(await proof.inspect.countOrganizations(slug)).toBe(1);
    await proof.inspect.makeAdmin(identity.userId);
    const target = await proof.integration.transaction((tx) =>
      tx.call('signUpEmail', {
        body: { ...input.body, email: `${randomUUID()}@example.test` },
      }),
    );
    expect(
      await proof.nativeImpersonationDenied(
        identity.cookieHeaders,
        target.user.id,
      ),
    ).toBe(true);
    await expect(
      proof.integration.transaction((tx) =>
        tx.call('impersonateUser', {
          headers: identity.cookieHeaders,
          body: { userId: target.user.id },
        }),
      ),
    ).rejects.toThrow('Server operation unavailable');
  } finally {
    await Promise.all([limiter.close(), proof.close()]);
  }
});

test('restricted Nest transport bounds bodies and rejects cross-origin, callback and authority injection', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:bounds:rl:auth:`,
  });
  const context = createAuthRequestContext();
  const http = createAuthHttp(proof.integration, {
    origin: proof.origin,
    correlationSecret: 'a'.repeat(48),
    limiter,
    context: context.read,
    authorize: async () => {},
  });
  try {
    const origin = await proof.startNest({
      handler: http,
      middleware: context.middleware,
    });
    const post = async (
      body: string,
      source = proof.origin,
      path = '/sign-up/email',
    ) =>
      fetch(`${origin}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: source,
          'x-lexon-internal': 'true',
        },
        body,
      });
    expect((await post('x'.repeat(32769))).status).toBe(413);
    const raw = async (path: string, body: string) =>
      new Promise<number>((resolve, reject) => {
        const target = new URL(origin);
        const request = nodeRequest(
          {
            hostname: target.hostname,
            port: target.port,
            path,
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: proof.origin,
            },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode!);
          },
        );
        request.on('error', reject);
        request.write(body.slice(0, 20000));
        request.end(body.slice(20000));
      });
    expect(await raw('/api/auth/sign-up/email', 'x'.repeat(32769))).toBe(413);
    expect(await raw('/api/auth/../auth/sign-up/email', '{}')).toBe(404);
    expect(await raw('/api/auth/sign-up%2femail', '{}')).toBe(404);
    expect((await post('{malformed')).status).toBe(400);
    const body = {
      name: 'Person',
      email: `${randomUUID()}@example.test`,
      password: 'HTTP-password-42!',
    };
    const foreign = await post(JSON.stringify(body), 'https://other.example');
    expect(foreign.status).toBe(403);
    const callback = await post(
      JSON.stringify({ ...body, callbackURL: 'https://other.example' }),
    );
    expect(callback.status).toBe(400);
    const escalation = await post(JSON.stringify({ ...body, role: 'admin' }));
    expect(escalation.status).toBe(400);
    const bypass = await post(
      JSON.stringify(body),
      proof.origin,
      '/organization/create',
    );
    expect(bypass.status).toBe(404);
    const response = await post(JSON.stringify(body));
    expect(response.status).toBe(200);
    expect(response.headers.has('set-auth-token')).toBe(false);
    expect('token' in (await response.json())).toBe(false);
    expect(await proof.inspect.countUsers(body.email)).toBe(1);
  } finally {
    await Promise.all([limiter.close(), proof.close()]);
  }
});

test('native error responses roll back authorization-side work in the same transaction', async ({
  services,
}) => {
  const setup = await createAuthFixture(services);
  const actor = await setup.integration.transaction((tx) =>
    tx.call('signUpEmail', {
      body: {
        name: 'Actor',
        email: `${randomUUID()}@example.test`,
        password: 'Actor-password-42!',
      },
    }),
  );
  await setup.close();
  const proof = await createAuthFixture(services, {
    rejectSignupResponse: true,
  });
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:rollback:rl:auth:`,
  });
  const context = createAuthRequestContext();
  const slug = `policy-${randomUUID()}`;
  const email = `${randomUUID()}@example.test`;
  const handler = createAuthHttp(proof.integration, {
    origin: proof.origin,
    correlationSecret: 'a'.repeat(48),
    limiter,
    context: context.read,
    authorize: async (_rule, { tx }) => {
      await tx.call('createOrganization', {
        body: { name: 'Authorization effect', slug, userId: actor.user.id },
      });
    },
  });
  try {
    const origin = await proof.startNest({
      handler,
      middleware: context.middleware,
      moduleFactory: IdentityAccessModule.forIntegration,
    });
    const response = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: proof.origin },
      body: JSON.stringify({
        name: 'Rollback',
        email,
        password: 'Rollback-password-42!',
      }),
    });
    expect(response.status).toBe(400);
    expect(await proof.inspect.countUsers(email)).toBe(0);
    expect(await proof.inspect.countOrganizations(slug)).toBe(0);
  } finally {
    await Promise.all([limiter.close(), proof.close()]);
  }
});

for (const mode of ['disconnect', 'hang', 'oom'] as const) {
  test(`session auth routes fail closed on limiter ${mode} without spending a sign-in attempt`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    const proxy = await FaultProxy.start(services.valkey.limiterUrl);
    const limiter = await createAuthLimiter({
      url: proxy.url,
      prefix: `${services.queuePrefix}:session-${mode}:rl:auth:`,
    });
    const context = createAuthRequestContext();
    let authorized = 0;
    const handler = createAuthHttp(proof.integration, {
      origin: proof.origin,
      correlationSecret: 'a'.repeat(48),
      limiter,
      context: context.read,
      authorize: async () => {
        authorized++;
      },
    });
    try {
      const email = `${randomUUID()}@example.test`;
      const identity = await proof.signIn({
        body: { name: 'Session gate', email, password: 'Session-password-42!' },
      });
      const origin = await proof.startNest({
        handler,
        middleware: context.middleware,
        moduleFactory: IdentityAccessModule.forIntegration,
      });
      if (mode === 'disconnect') proxy.disconnect();
      else if (mode === 'hang') proxy.hang();
      else proxy.rejectWrites();
      const start = performance.now();
      const response = await fetch(`${origin}/api/auth/get-session`, {
        headers: identity.cookieHeaders,
      });
      expect(response.status).toBe(503);
      expect(performance.now() - start).toBeLessThan(2000);
      expect(authorized).toBe(0);
      expect(await proof.inspect.countSessions(email)).toBe(1);
    } finally {
      await Promise.all([limiter.close(), proof.close(), proxy.close()]);
    }
  });
}

test('healthy session routes preserve sign-in quotas and use expiring availability writes', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const prefix = `${services.queuePrefix}:session-live:rl:auth:`;
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix,
  });
  const inspector = new Redis(services.valkey.limiterUrl);
  const context = createAuthRequestContext();
  const handler = createAuthHttp(proof.integration, {
    origin: proof.origin,
    correlationSecret: 'a'.repeat(48),
    limiter,
    context: context.read,
    authorize: async () => {},
  });
  try {
    expect(proof.nativeSettings()).toEqual({
      cookieCacheDisabled: true,
      secondaryStorageDisabled: true,
      nativeRateLimitDisabled: true,
      telemetryDisabled: true,
    });
    const email = `${randomUUID()}@example.test`;
    const identity = await proof.signIn({
      body: {
        name: 'Healthy session',
        email,
        password: 'Session-password-42!',
      },
    });
    const origin = await proof.startNest({
      handler,
      middleware: context.middleware,
      moduleFactory: IdentityAccessModule.forIntegration,
    });
    const response = await fetch(`${origin}/api/auth/get-session`, {
      headers: identity.cookieHeaders,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.id).toBe(identity.userId);
    expect('token' in body.session).toBe(false);
    expect(await inspector.keys(`${prefix}signin:*`)).toEqual([]);
    expect(await inspector.pttl(`${prefix}availability`)).toBeGreaterThan(0);
    const headers = new Headers(identity.cookieHeaders);
    headers.set('origin', proof.origin);
    headers.set('content-type', 'application/json');
    const out = await fetch(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(out.status).toBe(200);
    expect(await proof.inspect.countSessions(email)).toBe(0);
    expect(out.headers.getSetCookie().length).toBeGreaterThan(0);
  } finally {
    await Promise.all([limiter.close(), proof.close(), inspector.quit()]);
  }
});

test('invalid factor challenges consume the IP ceiling before account resolution', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:invalid-factor:`,
    rules: {
      ...DEFAULT_AUTH_RATE_RULES,
      totp: { account: 5, ip: 2, windowSeconds: 300 },
    },
  });
  const handler = createAuthHttp(proof.integration, {
    origin: proof.origin,
    correlationSecret: 'q'.repeat(48),
    limiter,
    context: () => ({
      rawPath: '/api/auth/two-factor/verify-totp',
      peerAddress: '127.0.0.1',
    }),
    accountKey: async () => undefined,
    authorize: async () => {},
  });
  try {
    const attempt = () =>
      handler(
        new Request(`${proof.origin}/api/auth/two-factor/verify-totp`, {
          method: 'POST',
          headers: { origin: proof.origin, 'content-type': 'application/json' },
          body: JSON.stringify({ code: '123456' }),
        }),
      );
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  } finally {
    await limiter.close();
    await proof.close();
  }
});
