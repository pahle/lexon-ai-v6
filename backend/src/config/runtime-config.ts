import { isAbsolute } from 'node:path';
import { z } from 'zod';

export type RuntimeName =
  'api' | 'ai-worker' | 'document-worker' | 'dispatcher';
const positive = (fallback: number) =>
  z.coerce.number().int().positive().finite().default(fallback);
const url = (protocols: string[]) =>
  z
    .string()
    .url()
    .refine(
      (value) =>
        URL.canParse(value) && protocols.includes(new URL(value).protocol),
    );
const common = z.object({
  DATABASE_APP_URL: url(['postgres:', 'postgresql:']),
  DATABASE_POOL_MAX: positive(5),
  QUEUE_PREFIX: z.string().min(1).default('bull'),
  JOB_RECEIPT_RETENTION_SECONDS: positive(2592000),
  DATABASE_STATEMENT_TIMEOUT_MS: positive(10000),
  VALKEY_QUEUE_URL: url(['redis:', 'rediss:']),
  VALKEY_STREAMS_URL: url(['redis:', 'rediss:']),
  VALKEY_LIMITER_URL: url(['redis:', 'rediss:']),
  HEALTH_FILE: z
    .string()
    .min(1)
    .refine(isAbsolute)
    .default('/run/lexon/health/status.json'),
  HEALTH_WRITE_INTERVAL_MS: positive(5000),
  HEALTH_STALE_MS: positive(20000),
  DEPENDENCY_TIMEOUT_MS: positive(2000),
});
const storageSchema = z.object({
  S3_ENDPOINT: url(['http:', 'https:']),
  S3_PUBLIC_ENDPOINT: url(['http:', 'https:']).optional(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().min(1),
});
const dispatcherSchema = z.object({
  DISPATCHER_POLL_MS: positive(1000),
  DISPATCHER_RETRY_BASE_MS: positive(250),
  DISPATCHER_RETRY_CAP_MS: positive(30000),
  DISPATCHER_BATCH_SIZE: positive(20),
  DISPATCHER_LEASE_MS: positive(15000),
  QUEUE_ENQUEUE_TIMEOUT_MS: positive(2000),
});
const apiSchema = z.object({
  PORT: positive(3001).refine((port) => port <= 65535),
});

function read<S extends z.ZodType>(
  schema: S,
  env: Record<string, string | undefined>,
): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(`Invalid configuration: ${fields.join(', ')}`);
  }
  return result.data;
}

function readCommon(env: Record<string, string | undefined>) {
  const values = read(common, env);
  if (
    values.HEALTH_STALE_MS <=
    values.HEALTH_WRITE_INTERVAL_MS + values.DEPENDENCY_TIMEOUT_MS
  ) {
    throw new Error('Invalid configuration: HEALTH_STALE_MS');
  }
  return {
    queuePrefix: values.QUEUE_PREFIX,
    jobs: { receiptRetentionSeconds: values.JOB_RECEIPT_RETENTION_SECONDS },
    database: {
      appUrl: values.DATABASE_APP_URL,
      poolMax: values.DATABASE_POOL_MAX,
      statementTimeoutMs: values.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    valkey: {
      queueUrl: values.VALKEY_QUEUE_URL,
      streamsUrl: values.VALKEY_STREAMS_URL,
      limiterUrl: values.VALKEY_LIMITER_URL,
    },
    health: {
      path: values.HEALTH_FILE,
      writeIntervalMs: values.HEALTH_WRITE_INTERVAL_MS,
      staleMs: values.HEALTH_STALE_MS,
      dependencyTimeoutMs: values.DEPENDENCY_TIMEOUT_MS,
    },
  };
}
function readStorage(env: Record<string, string | undefined>) {
  const values = read(storageSchema, env);
  return {
    endpoint: values.S3_ENDPOINT,
    publicEndpoint: values.S3_PUBLIC_ENDPOINT ?? values.S3_ENDPOINT,
    bucket: values.S3_BUCKET,
    accessKey: values.S3_ACCESS_KEY,
    secretKey: values.S3_SECRET_KEY,
    region: values.S3_REGION,
  };
}
function readDispatcher(env: Record<string, string | undefined>) {
  const values = read(dispatcherSchema, env);
  if (
    values.DISPATCHER_RETRY_CAP_MS < values.DISPATCHER_RETRY_BASE_MS ||
    values.DISPATCHER_LEASE_MS <= values.QUEUE_ENQUEUE_TIMEOUT_MS
  )
    throw new Error(
      'Invalid configuration: DISPATCHER_RETRY_CAP_MS, DISPATCHER_LEASE_MS',
    );
  return {
    pollMs: values.DISPATCHER_POLL_MS,
    retryBaseMs: values.DISPATCHER_RETRY_BASE_MS,
    retryCapMs: values.DISPATCHER_RETRY_CAP_MS,
    batchSize: values.DISPATCHER_BATCH_SIZE,
    leaseMs: values.DISPATCHER_LEASE_MS,
    enqueueTimeoutMs: values.QUEUE_ENQUEUE_TIMEOUT_MS,
  };
}

type CommonConfig = ReturnType<typeof readCommon>;
export type RuntimeConfig =
  | (CommonConfig & {
      runtime: 'api';
      storage: ReturnType<typeof readStorage>;
      port: number;
    })
  | (CommonConfig & {
      runtime: 'document-worker';
      storage: ReturnType<typeof readStorage>;
    })
  | (CommonConfig & {
      runtime: 'dispatcher';
      dispatcher: ReturnType<typeof readDispatcher>;
    })
  | (CommonConfig & { runtime: 'ai-worker' });
export type ApiConfig = Extract<RuntimeConfig, { runtime: 'api' }>;
export function loadRuntimeConfig<R extends RuntimeName>(
  runtime: R,
  env: Record<string, string | undefined>,
): Extract<RuntimeConfig, { runtime: R }>;
export function loadRuntimeConfig(
  runtime: RuntimeName,
  env: Record<string, string | undefined>,
): RuntimeConfig {
  const config = readCommon(env);
  switch (runtime) {
    case 'api':
      return {
        ...config,
        runtime,
        storage: readStorage(env),
        port: read(apiSchema, env).PORT,
      };
    case 'document-worker':
      return { ...config, runtime, storage: readStorage(env) };
    case 'dispatcher':
      return { ...config, runtime, dispatcher: readDispatcher(env) };
    case 'ai-worker':
      return { ...config, runtime };
  }
}
