import { createHash, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthLimiter } from '../../src/infrastructure/queue/index.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { readAuthConfig } from '../../src/config/auth-config.js';
import { authConfigEnvironment } from '../setup/auth-environment.js';

// Test-only deterministic opaque keys. Production callers use a keyed HMAC.
const key = (value: string) => createHash('sha256').update(value).digest('hex');
test('separate limiter instances share account limits and all keys expire without email', async ({
  services,
}) => {
  const prefix = `${services.queuePrefix}:rl:auth:`;
  const first = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix,
  });
  const second = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix,
  });
  const inspector = new Redis(services.valkey.limiterUrl);
  try {
    const accountKey = key(randomUUID());
    for (let i = 0; i < 5; i++)
      await (i % 2 ? first : second).consume({
        action: 'signin',
        clientAddress: `192.0.2.${i + 1}`,
        accountKey,
      });
    await expect(
      second.consume({
        action: 'signin',
        clientAddress: '198.51.100.1',
        accountKey,
      }),
    ).rejects.toMatchObject({ status: 429, code: 'AUTH_RATE_LIMITED' });
    const keys = await inspector.keys(`${prefix}*`);
    await expect(
      first.consume({
        action: 'signin',
        clientAddress: '192.0.2.99',
        accountKey: 'person@example.test',
      }),
    ).rejects.toThrow('Invalid authentication limit input');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((value) => value.includes('@'))).toBe(false);
    expect(keys.some((value) => value.includes(accountKey))).toBe(true);
    for (const stored of keys)
      expect(await inspector.pttl(stored)).toBeGreaterThan(0);
  } finally {
    await Promise.all([first.close(), second.close(), inspector.quit()]);
  }
});

test('configured limits expire at the configured window', async ({
  services,
}) => {
  const rules = readAuthConfig({
    ...authConfigEnvironment(),
    AUTH_RATE_RULES_JSON: JSON.stringify({
      signin: { account: 1, ip: 5, windowSeconds: 1 },
    }),
  }).rateRules;
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:custom:rl:auth:`,
    rules,
  });
  const input = {
    action: 'signin' as const,
    clientAddress: '192.0.2.1',
    accountKey: key('custom'),
  };
  try {
    await limiter.consume(input);
    await expect(limiter.consume(input)).rejects.toMatchObject({ status: 429 });
    await expect
      .poll(
        async () => {
          try {
            await limiter.consume(input);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 2000, interval: 100 },
      )
      .toBe(true);
  } finally {
    await limiter.close();
  }
});
test('IP limits cannot be evaded by cycling account identifiers', async ({
  services,
}) => {
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:ip:rl:auth:`,
  });
  try {
    for (let i = 0; i < 30; i++)
      await limiter.consume({
        action: 'signin',
        clientAddress: '203.0.113.5',
        accountKey: key(String(i)),
      });
    await expect(
      limiter.consume({
        action: 'signin',
        clientAddress: '203.0.113.5',
        accountKey: key('next'),
      }),
    ).rejects.toMatchObject({ status: 429 });
  } finally {
    await limiter.close();
  }
});
for (const mode of ['disconnect', 'hang', 'oom'] as const) {
  test(`Valkey ${mode} fails closed within two seconds before any auth effect`, async ({
    services,
  }) => {
    const proxy = await FaultProxy.start(services.valkey.limiterUrl);
    const limiter = await createAuthLimiter({
      url: proxy.url,
      prefix: `${services.queuePrefix}:${mode}:rl:auth:`,
    });
    const proof = await createAuthFixture(services);
    const email = `${randomUUID()}@example.test`;
    try {
      if (mode === 'disconnect') proxy.disconnect();
      else if (mode === 'hang') proxy.hang();
      else proxy.rejectWrites();
      const start = performance.now();
      await expect(
        (async () => {
          await limiter.consume({
            action: 'signin',
            clientAddress: '192.0.2.1',
            accountKey: key(email),
          });
          await proof.integration.transaction((tx) =>
            tx.call('signUpEmail', {
              body: {
                email,
                name: 'Limiter proof',
                password: 'Limiter-password-42!',
              },
            }),
          );
        })(),
      ).rejects.toMatchObject({ status: 503, code: 'AUTH_UNAVAILABLE' });
      expect(performance.now() - start).toBeLessThan(2000);
      expect(await proof.inspect.countUsers(email)).toBe(0);
    } finally {
      await Promise.all([limiter.close(), proof.close(), proxy.close()]);
    }
  });
}
