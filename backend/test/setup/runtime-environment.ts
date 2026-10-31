import type { FileServices } from './provided-context.js';
export function runtimeEnvironment(
  services: FileServices,
  healthPath: string,
): Record<string, string> {
  return {
    DATABASE_APP_URL: services.appUrl,
    VALKEY_QUEUE_URL: services.valkey.queueUrl,
    VALKEY_STREAMS_URL: services.valkey.streamsUrl,
    VALKEY_LIMITER_URL: services.valkey.limiterUrl,
    QUEUE_PREFIX: services.queuePrefix,
    S3_ENDPOINT: services.s3.endpoint,
    S3_BUCKET: services.s3.bucket,
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: services.s3.credentials.accessKeyId,
    S3_SECRET_KEY: services.s3.credentials.secretAccessKey,
    HEALTH_FILE: healthPath,
    HEALTH_WRITE_INTERVAL_MS: '50',
    HEALTH_STALE_MS: '1000',
    DEPENDENCY_TIMEOUT_MS: '200',
    DISPATCHER_POLL_MS: '40',
  };
}
