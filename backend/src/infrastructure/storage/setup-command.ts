import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import pino from 'pino';
export async function provisionStorage(
  env: Record<string, string | undefined>,
): Promise<void> {
  const value = (key: string) => {
    if (!env[key]) throw new Error('Missing storage setup configuration');
    return env[key];
  };
  const client = new S3Client({
    endpoint: value('S3_ENDPOINT'),
    region: value('S3_REGION'),
    credentials: {
      accessKeyId: value('S3_ACCESS_KEY'),
      secretAccessKey: value('S3_SECRET_KEY'),
    },
    forcePathStyle: true,
    maxAttempts: 1,
  });
  const bucket = value('S3_BUCKET');
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }), {
          abortSignal: AbortSignal.timeout(2000),
        });
        return;
      } catch {
        /* Probe bucket creation or gateway startup without exposing SDK details. */
      }
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }), {
          abortSignal: AbortSignal.timeout(2000),
        });
        return;
      } catch {
        if (attempt === 29) throw new Error('Storage setup failed');
        await setTimeout(250);
      }
    }
  } finally {
    client.destroy();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await provisionStorage(process.env);
  } catch {
    pino({ base: { operation: 'storage_setup' } }).error({
      event: 'setup_failed',
    });
    process.exitCode = 1;
  }
}
