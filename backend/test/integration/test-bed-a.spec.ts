import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { databaseProbe } from '../../src/infrastructure/db/testing/inspect.js';
import { Redis } from 'ioredis';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

test('isolates file A database, keys and bucket', async ({ services }) => {
  expect(await databaseProbe(services, 'A')).toBe('A');
  const redis = new Redis(services.valkey.queueUrl);
  const client = new S3Client({
    endpoint: services.s3.endpoint,
    region: 'us-east-1',
    credentials: services.s3.credentials,
    forcePathStyle: true,
  });
  try {
    await redis.set(services.queuePrefix + ':same-key', 'A');
    await client.send(
      new PutObjectCommand({
        Bucket: services.s3.bucket,
        Key: 'same-key',
        Body: 'A',
      }),
    );
    expect(await redis.get(services.queuePrefix + ':same-key')).toBe('A');
    const result = await client.send(
      new GetObjectCommand({ Bucket: services.s3.bucket, Key: 'same-key' }),
    );
    expect(await result.Body?.transformToString()).toBe('A');
  } finally {
    await redis.quit();
    client.destroy();
  }
});
