import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { TenantDatabase } from '../../src/infrastructure/db/index.js';
import {
  JobExecutor,
  type JobEnvelope,
} from '../../src/modules/platform/index.js';
import {
  QueueProducer,
  QueueConsumer,
  checkValkeyPolicy,
  streamsSmoke,
} from '../../src/infrastructure/queue/index.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
import {
  installEffectFixture,
  createEffectHandler,
  inspectJob,
} from '../../src/infrastructure/db/testing/job-effects.js';
const input = (): JobEnvelope => ({
  outboxId: randomUUID(),
  type: 'platform.noop.v1',
  ctx: { orgId: randomUUID() },
  payload: { probeId: randomUUID() },
});
test.beforeAll(async ({ services }) => {
  await installEffectFixture(services);
});
test('native Nest worker retries with exponential delays, retains IDs, and receipts survive queue removal', async ({
  services,
}) => {
  const options = {
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix,
  };
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 2,
    statementTimeoutMs: 10000,
  });
  const producer = new QueueProducer(options);
  const consumer = new QueueConsumer(options, new JobExecutor(db));
  const queue = new Queue('ai-interactive', {
    connection: { url: options.url },
    prefix: options.prefix,
  });
  const job = input();
  const times: number[] = [];
  try {
    await consumer.start(async (tx, j) => {
      times.push(Date.now());
      if (times.length < 3) throw new Error('fixture transient');
      await createEffectHandler()(tx, j);
    });
    await producer.enqueue(job);
    await expect
      .poll(async () => (await queue.getJob(job.outboxId))?.getState(), {
        timeout: 10000,
      })
      .toBe('completed');
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(240);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(490);
    const stored = (await queue.getJob(job.outboxId))!;
    expect(stored.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 250 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    });
    await producer.enqueue(job);
    expect(await queue.getJobCounts('completed')).toMatchObject({
      completed: 1,
    });
    expect(times).toHaveLength(3);
    await stored.remove();
    await producer.enqueue(job);
    await expect
      .poll(async () => (await queue.getJob(job.outboxId))?.getState())
      .toBe('completed');
    expect((await queue.getJob(job.outboxId))!.returnvalue).toBe('duplicate');
    expect(times).toHaveLength(3);
    expect(await inspectJob(services, job.outboxId)).toMatchObject({
      effects: 1,
      receipts: 1,
    });
    const isolated = new Queue('ai-interactive', {
      connection: { url: options.url },
      prefix: options.prefix + ':other',
    });
    try {
      expect(await isolated.getJob(job.outboxId)).toBeUndefined();
    } finally {
      await isolated.close();
    }
  } finally {
    await consumer.close();
    await producer.close();
    await queue.close();
    await db.close();
  }
});
test('failed jobs are retained after all three attempts, with sanitized reasons', async ({
  services,
}) => {
  const options = {
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix + ':failed',
  };
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  const producer = new QueueProducer(options);
  const consumer = new QueueConsumer(options, new JobExecutor(db));
  const queue = new Queue('ai-interactive', {
    connection: { url: options.url },
    prefix: options.prefix,
  });
  let attempts = 0;
  const job = input();
  try {
    await consumer.start(async () => {
      attempts++;
      throw new Error('secret fixture content');
    });
    await producer.enqueue(job);
    await expect
      .poll(async () => (await queue.getJob(job.outboxId))?.getState(), {
        timeout: 10000,
      })
      .toBe('failed');
    const stored = (await queue.getJob(job.outboxId))!;
    expect(attempts).toBe(3);
    expect(stored.failedReason).toBe('Job execution failed');
    expect(JSON.stringify(stored.stacktrace)).not.toContain(
      'secret fixture content',
    );
    expect(await inspectJob(services, job.outboxId)).toMatchObject({
      effects: 0,
      receipts: 0,
    });
  } finally {
    await consumer.close();
    await producer.close();
    await queue.close();
    await db.close();
  }
});
test('validates real Valkey policy and bounds a stream with TTL', async ({
  services,
}) => {
  expect(await checkValkeyPolicy(services.valkey)).toEqual({
    queue: 'up',
    streams: 'up',
    limiter: 'up',
  });
  expect(
    await streamsSmoke(services.valkey.streamsUrl, services.queuePrefix),
  ).toBe(true);
});
test('producer fails within its budget during a private proxy outage and recovers', async ({
  services,
}) => {
  const proxy = await FaultProxy.start(services.valkey.queueUrl);
  const producer = new QueueProducer({
    url: proxy.url,
    prefix: services.queuePrefix + ':fault',
  });
  try {
    await producer.enqueue(input());
    proxy.disconnect();
    const start = Date.now();
    await expect(producer.enqueue(input(), { timeoutMs: 200 })).rejects.toThrow(
      'Queue enqueue unavailable',
    );
    expect(Date.now() - start).toBeLessThan(1500);
    proxy.restore();
    await expect
      .poll(
        async () => {
          try {
            await producer.enqueue(input(), { timeoutMs: 300 });
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 5000 },
      )
      .toBe(true);
  } finally {
    await producer.close();
    await proxy.close();
  }
});

test('worker progress detects a stalled active handler independently of health polling', async ({
  services,
}) => {
  const options = {
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix + ':progress',
  };
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  const producer = new QueueProducer(options);
  const consumer = new QueueConsumer(options, new JobExecutor(db));
  let entered!: () => void;
  const busy = new Promise<void>((done) => {
    entered = done;
  });
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await consumer.start(async () => {
      entered();
      await done;
    });
    expect(consumer.isProgressing(100)).toBe(true);
    await producer.enqueue(input());
    await busy;
    expect(consumer.isProgressing(100, Date.now() + 101)).toBe(false);
    release();
    await expect
      .poll(() => consumer.isProgressing(100, Date.now() + 101))
      .toBe(true);
  } finally {
    release();
    await consumer.close();
    await producer.close();
    await db.close();
  }
  expect(consumer.isProgressing(100)).toBe(false);
});
