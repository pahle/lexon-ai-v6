import { expect, it } from 'vitest';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

const base = {
  DATABASE_APP_URL: 'postgresql://app:secret@localhost/test',
  VALKEY_QUEUE_URL: 'redis://:secret@localhost:6379/0',
  VALKEY_STREAMS_URL: 'redis://:secret@localhost:6379/1',
  VALKEY_LIMITER_URL: 'redis://:secret@localhost:6379/2',
};
const storage = {
  S3_ENDPOINT: 'http://localhost:8333',
  S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  S3_REGION: 'us-east-1',
};

it('names invalid configuration fields without printing their supplied values', () => {
  const secret = 'PRIVATE_SENTINEL';
  try {
    loadRuntimeConfig('dispatcher', { ...base, DATABASE_APP_URL: secret });
    expect.unreachable('must reject invalid URL');
  } catch (error) {
    expect(String(error)).toContain('DATABASE_APP_URL');
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  }
});

it('requires the application database URL', () => {
  expect(() =>
    loadRuntimeConfig('dispatcher', { ...base, DATABASE_APP_URL: undefined }),
  ).toThrow('DATABASE_APP_URL');
});

it.each(['api', 'document-worker'] as const)(
  'requires storage only for %s',
  (runtime) => {
    expect(() => loadRuntimeConfig(runtime, base)).toThrow('S3_ENDPOINT');
    expect(
      loadRuntimeConfig(runtime, { ...base, ...storage }).storage.bucket,
    ).toBe('test');
  },
);

it.each(['dispatcher', 'ai-worker'] as const)(
  'boots %s without storage or model credentials',
  (runtime) => {
    const config = loadRuntimeConfig(runtime, base);
    expect(config.runtime).toBe(runtime);
    expect(config.valkey).toEqual({
      queueUrl: base.VALKEY_QUEUE_URL,
      streamsUrl: base.VALKEY_STREAMS_URL,
      limiterUrl: base.VALKEY_LIMITER_URL,
    });
    expect(config).not.toHaveProperty('storage');
  },
);

it.each(['0', '-1', 'NaN', 'Infinity', '', '1.5'])(
  'rejects invalid integer timing %j',
  (value) => {
    expect(() =>
      loadRuntimeConfig('dispatcher', {
        ...base,
        HEALTH_WRITE_INTERVAL_MS: value,
      }),
    ).toThrow('HEALTH_WRITE_INTERVAL_MS');
  },
);

it('rejects a staleness budget shorter than the health cycle', () => {
  expect(() =>
    loadRuntimeConfig('dispatcher', { ...base, HEALTH_STALE_MS: '6000' }),
  ).toThrow('HEALTH_STALE_MS');
});

it('sets explicit bounded defaults and a tmpfs-ready health path', () => {
  const config = loadRuntimeConfig('dispatcher', base);
  expect(config.health).toEqual({
    path: '/run/lexon/health/status.json',
    writeIntervalMs: 5000,
    staleMs: 20000,
    dependencyTimeoutMs: 2000,
  });
  expect(config.database).toEqual({
    appUrl: base.DATABASE_APP_URL,
    poolMax: 5,
    statementTimeoutMs: 10000,
  });
  expect(config.dispatcher).toEqual({
    pollMs: 1000,
    retryBaseMs: 250,
    retryCapMs: 30000,
    batchSize: 20,
    leaseMs: 15000,
    enqueueTimeoutMs: 2000,
  });
});

it('does not validate settings unused by a runtime', () => {
  expect(
    loadRuntimeConfig('ai-worker', {
      ...base,
      S3_ENDPOINT: 'bad',
      DISPATCHER_POLL_MS: 'NaN',
    }).runtime,
  ).toBe('ai-worker');
});

it('records retention metadata without enabling receipt cleanup', () => {
  expect(
    loadRuntimeConfig('ai-worker', base).jobs.receiptRetentionSeconds,
  ).toBe(2592000);
  for (const value of ['0', '-1', 'NaN', '1.5'])
    expect(() =>
      loadRuntimeConfig('ai-worker', {
        ...base,
        JOB_RECEIPT_RETENTION_SECONDS: value,
      }),
    ).toThrow('JOB_RECEIPT_RETENTION_SECONDS');
});

it('validates an optional caller-reachable S3 endpoint separately from its internal endpoint', () => {
  expect(
    loadRuntimeConfig('api', {
      ...base,
      ...storage,
      S3_PUBLIC_ENDPOINT: 'http://localhost:8334',
    }).storage.publicEndpoint,
  ).toBe('http://localhost:8334');
  expect(() =>
    loadRuntimeConfig('api', {
      ...base,
      ...storage,
      S3_PUBLIC_ENDPOINT: 'redis://secret-host',
    }),
  ).toThrow('S3_PUBLIC_ENDPOINT');
});

it('configures a queue namespace shared by producers and workers', () => {
  expect(
    loadRuntimeConfig('ai-worker', { ...base, QUEUE_PREFIX: 'lexon_test' })
      .queuePrefix,
  ).toBe('lexon_test');
  expect(() =>
    loadRuntimeConfig('ai-worker', { ...base, QUEUE_PREFIX: '' }),
  ).toThrow('QUEUE_PREFIX');
});
