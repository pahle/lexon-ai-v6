import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect, vi } from 'vitest';
import { SseConnectionRegistry } from '../../src/infrastructure/queue/sse-connection-registry.js';
import { test } from '../setup/file-services.js';

test('concurrent registry instances cap a user and stale owners cannot touch replacements', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const first = new SseConnectionRegistry(
    services.valkey.streamsUrl,
    services.queuePrefix,
  );
  const second = new SseConnectionRegistry(
    services.valkey.streamsUrl,
    services.queuePrefix,
  );
  const userId = randomUUID();
  const ownerIds = Array.from({ length: 18 }, () => randomUUID());
  try {
    const admitted = await Promise.all(
      ownerIds.map((id, index) =>
        (index % 2 ? first : second).admit(userId, id, randomUUID(), 6),
      ),
    );
    expect(
      await redis.zcard(`${services.queuePrefix}:{sse-connections}:${userId}`),
    ).toBe(6);
    expect(admitted).toHaveLength(ownerIds.length);

    const replacementUser = randomUUID();
    const old = await first.admit(
      replacementUser,
      randomUUID(),
      randomUUID(),
      1,
    );
    const replacement = await second.admit(
      replacementUser,
      randomUUID(),
      randomUUID(),
      1,
    );
    expect(replacement.evicted?.ownerToken).toBe(old.lease.ownerToken);
    expect(await first.renew(old.lease)).toBeUndefined();
    expect(await first.release(old.lease)).toBe(false);
    expect(await second.renew(replacement.lease)).toBeDefined();
  } finally {
    await first.close();
    await second.close();
    redis.disconnect();
  }
});

test('registry admission order survives tied caller clocks and renew does not revive expiry', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const registry = new SseConnectionRegistry(
    services.valkey.streamsUrl,
    services.queuePrefix,
    60,
  );
  const userId = randomUUID();
  const firstId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const secondId = '11111111-1111-4111-8111-111111111111';
  const thirdId = '22222222-2222-4222-8222-222222222222';
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  try {
    const oldest = await registry.admit(userId, firstId, randomUUID(), 2);
    await registry.admit(userId, secondId, randomUUID(), 2);
    const newConnection = await registry.admit(
      userId,
      thirdId,
      randomUUID(),
      2,
    );
    expect(newConnection.evicted?.connectionId).toBe(firstId);
    now.mockRestore();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await registry.renew(oldest.lease)).toBeUndefined();
  } finally {
    now.mockRestore();
    await registry.close();
    redis.disconnect();
  }
});

test('empty registry metadata expires after all admission leases expire', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const registry = new SseConnectionRegistry(
    services.valkey.streamsUrl,
    services.queuePrefix,
    60,
  );
  const userId = randomUUID();
  const zsetKey = `${services.queuePrefix}:{sse-connections}:${userId}`;
  const ownersKey = `${zsetKey}:owners`;
  const orderKey = `${zsetKey}:order`;
  const metadataKeys = [zsetKey, ownersKey, orderKey];
  try {
    await registry.admit(userId, randomUUID(), randomUUID(), 6);
    const ttls = await Promise.all(metadataKeys.map((key) => redis.pttl(key)));
    expect(ttls.every((ttl) => ttl > 0 && ttl <= 180)).toBe(true);
    await vi.waitFor(
      async () => {
        expect(await redis.exists(...metadataKeys)).toBe(0);
      },
      { timeout: 1000, interval: 20 },
    );
  } finally {
    await registry.close();
    redis.disconnect();
  }
});
