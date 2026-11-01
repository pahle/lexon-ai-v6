import { randomBytes } from 'node:crypto';
import { test as base, inject } from 'vitest';
import { Redis } from 'ioredis';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  cloneDatabase,
  dropDatabase,
  roleUrl,
} from '../../src/infrastructure/db/testing/provision.js';
import type { FileServices } from './provided-context.js';

// Vitest parses the fixture dependency pattern and requires destructuring.
export const test = base.extend(
  'services',
  { scope: 'file' },
  // eslint-disable-next-line no-empty-pattern -- Vitest requires an explicit fixture dependency pattern.
  async ({}, { onCleanup }): Promise<FileServices> => {
    const descriptor = inject('infrastructure');
    const id = randomBytes(12).toString('hex');
    const dbName = `lexon_test_${id}`;
    const queuePrefix = `lexon_${descriptor.runId}_${id}`;
    const bucket = `lexon-${descriptor.runId}-${id}`;
    const s3 = new S3Client({
      ...descriptor.s3,
      region: 'us-east-1',
      forcePathStyle: true,
    });
    onCleanup(async () => {
      try {
        let token: string | undefined;
        do {
          const objects = await s3.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              ...(token ? { ContinuationToken: token } : {}),
            }),
          );
          if (objects.Contents?.length)
            await s3.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                  Objects: objects.Contents.map((item) => ({ Key: item.Key! })),
                },
              }),
            );
          token = objects.NextContinuationToken;
        } while (token);
        await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
      } finally {
        s3.destroy();
        const redis = new Redis(descriptor.valkeyUrl, {
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
        });
        try {
          for await (const keys of redis.scanStream({
            match: `${queuePrefix}:*`,
            count: 100,
          })) {
            if (keys.length) await redis.del(...keys);
          }
        } finally {
          redis.disconnect();
          await dropDatabase(descriptor.adminUrl, dbName);
        }
      }
    });
    await cloneDatabase(descriptor.adminUrl, descriptor.template, dbName);
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    return {
      runId: descriptor.runId,
      dbName,
      queuePrefix,
      appUrl: roleUrl(
        descriptor.adminUrl,
        'lexon_app',
        descriptor.passwords.app,
        dbName,
      ),
      authUrl: roleUrl(
        descriptor.adminUrl,
        'lexon_auth',
        descriptor.passwords.auth,
        dbName,
      ),
      migratorUrl: roleUrl(
        descriptor.adminUrl,
        'lexon_migrator',
        descriptor.passwords.migrator,
        dbName,
      ),
      valkey: {
        queueUrl: descriptor.valkeyUrl,
        streamsUrl: descriptor.valkeyUrl,
        limiterUrl: descriptor.valkeyUrl,
      },
      s3: { ...descriptor.s3, bucket },
    };
  },
);
