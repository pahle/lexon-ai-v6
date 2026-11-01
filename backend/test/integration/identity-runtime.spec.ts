import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createApi } from '../../src/bootstrap/api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import type { TransactionalEmail } from '../../src/infrastructure/email/index.js';
test('real API mounts restricted auth once, protects diagnostics and accepts injected in-process mail', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-identity-runtime-'));
  const messages: TransactionalEmail[] = [];
  const config = loadRuntimeConfig(
    'api',
    createAuthEnvironment(services, join(directory, 'health.json')),
  );
  const app = await createApi(config, {
    email: {
      send: async (message) => {
        messages.push(message);
        return { messageId: 'test' };
      },
      drain: async () => {},
    },
  });
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const readiness = await fetch(`${origin}/api/health`);
    expect(
      ((await readiness.json()) as { dependencies: Record<string, string> })
        .dependencies.auth,
    ).toBe('up');
    expect(
      (
        await fetch(`${origin}/api/diagnostics/validation`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ probeId: randomUUID() }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${origin}/api/identity/onboarding/complete`, {
          method: 'POST',
          headers: {
            cookie: 'better-auth.session_token=untrusted',
            origin: 'https://outside.example',
            'content-type': 'application/json',
          },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    const email = `${randomUUID()}@example.test`;
    const response = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: {
        origin: config.auth.origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Runtime identity',
        email,
        password: 'Runtime-identity-42!',
        callbackURL: config.auth.origin + '/verify-email?state=confirmed',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(messages.filter((message) => message.to === email)).toHaveLength(1);
    expect(
      (
        await fetch(`${origin}/api/auth/organization/create`, {
          method: 'POST',
        })
      ).status,
    ).toBe(404);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('auth database loss marks API readiness down while public liveness remains up', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-auth-health-'));
  const proxy = await FaultProxy.start(services.authUrl);
  const config = loadRuntimeConfig('api', {
    ...createAuthEnvironment(services, join(directory, 'health.json')),
    DATABASE_AUTH_URL: proxy.url,
  });
  const app = await createApi(config, {
    email: { send: async () => ({ messageId: 'test' }), drain: async () => {} },
  });
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    expect((await fetch(`${origin}/api/health`)).status).toBe(200);
    proxy.disconnect();
    await expect
      .poll(
        async () => {
          const response = await fetch(`${origin}/api/health`);
          const body = (await response.json()) as {
            dependencies: Record<string, string>;
          };
          return { status: response.status, auth: body.dependencies.auth };
        },
        { timeout: 10000 },
      )
      .toEqual({ status: 503, auth: 'down' });
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
  } finally {
    await app.close();
    await proxy.close();
    await rm(directory, { recursive: true, force: true });
  }
});
