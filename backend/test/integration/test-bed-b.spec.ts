import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { databaseProbe } from '../../src/infrastructure/db/testing/inspect.js';
import { Redis } from 'ioredis';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

test('isolates file B database, keys and bucket', async ({ services }) => {
  expect(await databaseProbe(services, 'B')).toBe('B');
  const redis = new Redis(services.valkey.queueUrl);
  const client = new S3Client({
    endpoint: services.s3.endpoint,
    region: 'us-east-1',
    credentials: services.s3.credentials,
    forcePathStyle: true,
  });
  try {
    await redis.set(services.queuePrefix + ':same-key', 'B');
    await client.send(
      new PutObjectCommand({
        Bucket: services.s3.bucket,
        Key: 'same-key',
        Body: 'B',
      }),
    );
    expect(await redis.get(services.queuePrefix + ':same-key')).toBe('B');
    const result = await client.send(
      new GetObjectCommand({ Bucket: services.s3.bucket, Key: 'same-key' }),
    );
    expect(await result.Body?.transformToString()).toBe('B');
  } finally {
    await redis.quit();
    client.destroy();
  }
});
