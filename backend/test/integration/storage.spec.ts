import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { S3Storage } from '../../src/infrastructure/storage/index.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
const bytes = new Uint8Array([0, 1, 2, 3, 4]);
test('puts, gets and deletes exact binary data', async ({ services }) => {
  const storage = new S3Storage({ ...services.s3, region: 'us-east-1' });
  const key = randomUUID();
  try {
    await storage.put(key, bytes);
    expect(await storage.get(key)).toEqual(bytes);
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toThrow('Object not found');
  } finally {
    await storage.close();
  }
});
test('returns the requested byte range', async ({ services }) => {
  const storage = new S3Storage({ ...services.s3, region: 'us-east-1' });
  const key = randomUUID();
  try {
    await storage.put(key, bytes);
    expect(await storage.get(key, { start: 1, endInclusive: 3 })).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    for (const range of [
      { start: -1, endInclusive: 3 },
      { start: 2, endInclusive: 1 },
      { start: 0.5, endInclusive: 3 },
    ])
      await expect(storage.get(key, range)).rejects.toThrow(
        'Invalid byte range',
      );
  } finally {
    await storage.close();
  }
});
test('uploads over a caller-reachable presigned PUT and rejects a tampered signature', async ({
  services,
}) => {
  const storage = new S3Storage({
    ...services.s3,
    region: 'us-east-1',
    publicEndpoint: services.s3.endpoint,
  });
  const key = randomUUID();
  try {
    const signed = await storage.presignPut(key, 60);
    const uploaded = await fetch(signed, { method: 'PUT', body: bytes });
    const responseCode =
      (await uploaded.text()).match(/<Code>([^<]+)<\/Code>/)?.[1] ?? null;
    expect({ status: uploaded.status, code: responseCode }).toEqual({
      status: 200,
      code: null,
    });
    expect(await storage.get(key)).toEqual(bytes);
    const tampered = new URL(await storage.presignPut(randomUUID(), 60));
    const signature = tampered.searchParams.get('X-Amz-Signature')!;
    tampered.searchParams.set(
      'X-Amz-Signature',
      (signature[0] === '0' ? '1' : '0') + signature.slice(1),
    );
    const rejected = await fetch(tampered, { method: 'PUT', body: bytes });
    expect(rejected.status).toBe(403);
    for (const ttl of [0, -1, 1.5, 604801])
      await expect(storage.presignPut(key, ttl)).rejects.toThrow(
        'Invalid presign expiry',
      );
  } finally {
    await storage.close();
  }
});
test('probes bucket access without mutations, bounds outages, and sanitizes failures', async ({
  services,
}) => {
  const storage = new S3Storage({ ...services.s3, region: 'us-east-1' });
  const missing = new S3Storage({
    ...services.s3,
    bucket: 'lexon-nonexistent-' + randomUUID(),
    region: 'us-east-1',
  });
  // Proxy forwards TCP only; authentication and S3 policy remain untouched.
  const target = new URL(services.s3.endpoint);
  const proxy = await FaultProxy.start('redis://' + target.host);
  const endpoint = 'http://' + new URL(proxy.url).host;
  const unavailable = new S3Storage({
    ...services.s3,
    endpoint,
    region: 'us-east-1',
    healthTimeoutMs: 100,
  });
  try {
    expect(await storage.check()).toBe('up');
    expect(await missing.check()).toBe('down');
    proxy.disconnect();
    const start = Date.now();
    expect(await unavailable.check()).toBe('down');
    expect(Date.now() - start).toBeLessThan(1500);
    await expect(unavailable.get('secret-key')).rejects.toThrow(
      /^Storage operation failed$/,
    );
  } finally {
    await storage.close();
    await missing.close();
    await unavailable.close();
    await proxy.close();
  }
});
