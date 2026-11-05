import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  DispatcherSession,
  OutboxRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import { OutboxDispatcher } from '../../src/modules/platform/index.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import {
  QueueConsumer,
  QueueProducer,
} from '../../src/infrastructure/queue/index.js';
import { StepPermitManager } from '../../src/infrastructure/queue/step-permits.js';
import {
  AiStepRepository,
  type JobEnvelope,
} from '../../src/infrastructure/db/index.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import { JobExecutor, JobRegistry } from '../../src/modules/platform/index.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';

test('durable busy claims are delayed without consuming BullMQ failure attempts', async ({
  services,
}) => {
  const options = {
    url: services.valkey.queueUrl,
    limiterUrl: services.valkey.limiterUrl,
    prefix: services.queuePrefix,
  };
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 3,
    statementTimeoutMs: 10000,
  });
  const producer = new QueueProducer(options);
  const queue = new Queue('ai-batch', {
    connection: { url: options.url },
    prefix: options.prefix,
  });
  const registry = new JobRegistry();
  const jobId = randomUUID();
  let calls = 0;
  const busyUntil = Date.now() + 1000;
  const consumer = new QueueConsumer(options, new JobExecutor(database), {
    lockDuration: 1000,
    stalledInterval: 1000,
    interactiveConcurrency: 1,
    batchConcurrency: 1,
    stepLeaseMs: 300,
    busyRetryMs: 100,
  });
  registry.register('run.advance.v1', {
    strategy: 'durable-step',
    handle: async () =>
      ++calls && Date.now() < busyUntil
        ? { kind: 'busy', retryAtMs: Date.now() + 100 }
        : { kind: 'done' },
  });
  try {
    await consumer.start(registry);
    await producer.enqueue(
      {
        outboxId: jobId,
        type: 'run.advance.v1',
        ctx: { orgId: randomUUID(), userId: randomUUID() },
        payload: { runId: randomUUID(), sequence: 1, expectedVersion: 1 },
      },
      { queue: 'ai-batch', priority: 4, timeoutMs: 1000 },
    );
    await expect
      .poll(async () => (await queue.getJob(jobId))?.getState())
      .toBe('delayed');
    expect((await queue.getJob(jobId))?.attemptsMade).toBe(0);
    await expect
      .poll(async () => (await queue.getJob(jobId))?.getState(), {
        timeout: 5000,
      })
      .toBe('completed');
    expect(calls).toBeGreaterThan(3);
    expect((await queue.getJob(jobId))?.attemptsMade).toBe(1);
  } finally {
    await consumer.close();
    await producer.close();
    await queue.close();
    await database.close();
  }
});

test('confirmed permit loss aborts a durable handler into delayed DB-fenced reclaim', async ({
  services,
}) => {
  const fixture = await createAiFixture(services);
  const run = await fixture.start(0);
  await fixture.seedPendingStep(0, run.id);
  const options = {
    url: services.valkey.queueUrl,
    limiterUrl: services.valkey.limiterUrl,
    prefix: services.queuePrefix,
  };
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 3,
    statementTimeoutMs: 10000,
  });
  const producer = new QueueProducer(options);
  const queue = new Queue('ai-batch', {
    connection: { url: options.url },
    prefix: options.prefix,
  });
  const id = randomUUID();
  const fences: number[] = [];
  let abortObserved = false;
  const registry = new JobRegistry();
  registry.register('run.advance.v1', {
    strategy: 'durable-step',
    handle: async (_job, { signal, permit }) => {
      const claim = await fixture.claim(0, run.id, 1, 1, 1800);
      if (!claim) return { kind: 'busy', retryAtMs: Date.now() + 100 };
      fences.push(claim.fence);
      if (fences.length === 1) {
        await permit.release();
        try {
          await new Promise<void>((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            else
              signal.addEventListener('abort', () => reject(signal.reason), {
                once: true,
              });
          });
        } catch (error) {
          abortObserved = signal.aborted && error === signal.reason;
          throw error;
        }
      }
      return { kind: 'done' };
    },
  });
  const consumer = new QueueConsumer(options, new JobExecutor(database), {
    interactiveConcurrency: 1,
    batchConcurrency: 2,
    stepLeaseMs: 300,
    busyRetryMs: 100,
  });
  try {
    await consumer.start(registry);
    await producer.enqueue(
      {
        outboxId: id,
        type: 'run.advance.v1',
        ctx: {
          orgId: fixture.tenants[0]!.orgId,
          userId: fixture.tenants[0]!.userId,
        },
        payload: { runId: run.id, sequence: 1, expectedVersion: 1 },
      },
      { queue: 'ai-batch', priority: 4, timeoutMs: 1000 },
    );
    await expect
      .poll(async () => (await queue.getJob(id))?.getState())
      .toBe('delayed');
    expect(abortObserved).toBe(true);
    expect((await queue.getJob(id))?.attemptsMade).toBe(0);
    await expect
      .poll(async () => (await queue.getJob(id))?.getState(), { timeout: 6000 })
      .toBe('completed');
    expect(fences.length).toBe(2);
    expect(fences[1]).toBeGreaterThan(fences[0]!);
    expect((await queue.getJob(id))?.attemptsMade).toBe(1);
    expect(await fixture.receiptCount(id)).toBe(0);
  } finally {
    await consumer.close();
    await producer.close();
    await queue.close();
    await database.close();
    await fixture.close();
  }
});

test('durable consumer progresses through limiter disconnect and same consumer recovers', async ({
  services,
}) => {
  const proxy = await FaultProxy.start(services.valkey.limiterUrl);
  const options = {
    url: services.valkey.queueUrl,
    limiterUrl: proxy.url,
    prefix: services.queuePrefix,
  };
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 3,
    statementTimeoutMs: 10000,
  });
  const producer = new QueueProducer(options);
  const queue = new Queue('ai-batch', {
    connection: { url: options.url },
    prefix: options.prefix,
  });
  const ids = [randomUUID(), randomUUID()];
  let entered!: () => void;
  let finishFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => (entered = resolve));
  const finish = new Promise<void>((resolve) => (finishFirst = resolve));
  let aborted = false;
  let calls = 0;
  const registry = new JobRegistry();
  registry.register('run.advance.v1', {
    strategy: 'durable-step',
    handle: async (_job, { signal }) => {
      calls++;
      if (calls === 1) {
        entered();
        signal.addEventListener('abort', () => (aborted = true), {
          once: true,
        });
        await finish;
      }
      return { kind: 'done' };
    },
  });
  const consumer = new QueueConsumer(options, new JobExecutor(database), {
    interactiveConcurrency: 1,
    batchConcurrency: 2,
    stepLeaseMs: 300,
    busyRetryMs: 100,
  });
  const ctx = { orgId: randomUUID(), userId: randomUUID() };
  try {
    await consumer.start(registry);
    const enqueue = (id: string) =>
      producer.enqueue(
        {
          outboxId: id,
          type: 'run.advance.v1',
          ctx,
          payload: { runId: randomUUID(), sequence: 1, expectedVersion: 1 },
        },
        { queue: 'ai-batch', priority: 4, timeoutMs: 1000 },
      );
    await enqueue(ids[0]!);
    await firstStarted;
    proxy.disconnect();
    await enqueue(ids[1]!);
    await expect
      .poll(async () => (await queue.getJob(ids[1]!))?.getState())
      .toBe('delayed');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(aborted).toBe(false);
    finishFirst();
    await expect
      .poll(async () => (await queue.getJob(ids[0]!))?.getState())
      .toBe('completed');
    proxy.restore();
    await expect
      .poll(async () => (await queue.getJob(ids[1]!))?.getState(), {
        timeout: 5000,
      })
      .toBe('completed');
    expect(calls).toBe(2);
  } finally {
    finishFirst();
    await consumer.close();
    await producer.close();
    await queue.close();
    await database.close();
    await proxy.close();
  }
});

test('two held permits defer a third job for one organization while another organization runs', async ({
  services,
}) => {
  const options = {
    url: services.valkey.queueUrl,
    limiterUrl: services.valkey.limiterUrl,
    prefix: services.queuePrefix,
  };
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 3,
    statementTimeoutMs: 10000,
  });
  const producer = new QueueProducer(options);
  const consumer = new QueueConsumer(options, new JobExecutor(database), {
    interactiveConcurrency: 4,
    batchConcurrency: 2,
    stepLeaseMs: 300,
    busyRetryMs: 100,
  });
  const queues = ['ai-interactive', 'ai-batch'].map(
    (name) =>
      new Queue(name, {
        connection: { url: options.url },
        prefix: options.prefix,
      }),
  );
  const orgA = randomUUID();
  const orgB = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  let releaseA!: () => void;
  let resolveTwoA!: () => void;
  let resolveOrgB!: () => void;
  const releaseHeldJobs = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const twoAStarted = new Promise<void>((resolve) => {
    resolveTwoA = resolve;
  });
  const orgBStarted = new Promise<void>((resolve) => {
    resolveOrgB = resolve;
  });
  let heldA = 0;
  let thirdA = 0;
  const registry = new JobRegistry();
  const handle = async (job: JobEnvelope) => {
    if (job.ctx.orgId === orgB) {
      resolveOrgB();
      return { kind: 'done' as const };
    }
    if (job.type === 'platform.noop.v1')
      throw new Error('Unexpected short transaction job');
    if (job.payload.sequence === 3) {
      thirdA++;
      return { kind: 'done' as const };
    }
    if (++heldA === 2) resolveTwoA();
    await releaseHeldJobs;
    return { kind: 'done' as const };
  };
  for (const type of [
    'run.start.v1',
    'run.advance.v1',
    'run.resume.v1',
  ] as const)
    registry.register(type, { strategy: 'durable-step', handle });
  const work = [
    {
      queue: 'ai-interactive' as const,
      type: 'run.start.v1' as const,
      orgId: orgA,
      sequence: 1,
    },
    {
      queue: 'ai-batch' as const,
      type: 'run.advance.v1' as const,
      orgId: orgA,
      sequence: 2,
    },
    {
      queue: 'ai-interactive' as const,
      type: 'run.resume.v1' as const,
      orgId: orgA,
      sequence: 3,
    },
    {
      queue: 'ai-batch' as const,
      type: 'run.advance.v1' as const,
      orgId: orgB,
      sequence: 1,
    },
  ];
  try {
    await consumer.start(registry);
    await Promise.all(
      work.map((item, index) =>
        producer.enqueue(
          {
            outboxId: ids[index]!,
            type: item.type,
            ctx: { orgId: item.orgId, userId: randomUUID() },
            payload: {
              runId: randomUUID(),
              sequence: item.sequence,
              expectedVersion: 1,
            },
          },
          { queue: item.queue, priority: 3, timeoutMs: 1000 },
        ),
      ),
    );
    await Promise.all([twoAStarted, orgBStarted]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect
      .poll(async () => (await queues[0]!.getJob(ids[2]!))?.getState())
      .toBe('delayed');
    expect(heldA).toBe(2);
    expect(thirdA).toBe(0);
    expect((await queues[0]!.getJob(ids[2]!))?.attemptsMade).toBe(0);
    releaseA();
    await expect
      .poll(
        async () => {
          const states = await Promise.all(
            ids.map(async (id, index) =>
              (
                await queues[
                  work[index]!.queue === 'ai-interactive' ? 0 : 1
                ]!.getJob(id)
              )?.getState(),
            ),
          );
          return states.filter((state) => state === 'completed').length;
        },
        { timeout: 5000 },
      )
      .toBe(4);
    expect(thirdA).toBe(1);
  } finally {
    releaseA();
    await consumer.close();
    await producer.close();
    await Promise.all(queues.map((queue) => queue.close()));
    await database.close();
  }
});

test('database tenant guard keeps no more than two live step claims while other tenants remain runnable', async ({
  services,
}) => {
  const fixture = await createAiFixture(services);
  const steps = new AiStepRepository();
  try {
    const runs = await Promise.all([
      fixture.start(0),
      fixture.start(0),
      fixture.start(0),
      fixture.start(1),
    ]);
    await Promise.all(
      runs.map((run, index) =>
        fixture.seedPendingStep(index === 3 ? 1 : 0, run.id),
      ),
    );
    const initialClaims = await Promise.all([
      fixture.claim(0, runs[0]!.id, 1, 1, 3000),
      fixture.claim(0, runs[1]!.id, 1, 1, 3000),
      fixture.claim(0, runs[2]!.id, 1, 1, 3000),
    ]);
    expect(initialClaims.filter(Boolean)).toHaveLength(2);
    const liveClaim = initialClaims.find(
      (claim): claim is NonNullable<typeof claim> => claim !== null,
    )!;
    const deferredRunIndex = initialClaims.findIndex((claim) => claim === null);
    const deferredRun = runs[deferredRunIndex]!;
    const concurrentRenewAndClaim = await Promise.all([
      fixture.withTenant(0, (tx) => steps.renew(tx, liveClaim, 30000)),
      fixture.claim(0, deferredRun.id, 1, 1, 3000),
    ]);
    expect(concurrentRenewAndClaim).toEqual([true, null]);
    expect(await fixture.claim(1, runs[3]!.id, 1, 1, 3000)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 3100));
    expect(await fixture.claim(0, deferredRun.id, 1, 1, 3000)).not.toBeNull();
  } finally {
    await fixture.close();
  }
});

test('organization step permits are isolated, renew by owner, and expire after worker death', async ({
  services,
}) => {
  const manager = await StepPermitManager.create({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:limiter`,
    leaseMs: 180,
  });
  const orgA = randomUUID();
  const orgB = randomUUID();
  let first: Awaited<ReturnType<StepPermitManager['acquire']>> = null;
  let second: Awaited<ReturnType<StepPermitManager['acquire']>> = null;
  let replacement: Awaited<ReturnType<StepPermitManager['acquire']>> = null;
  try {
    first = await manager.acquire(orgA);
    second = await manager.acquire(orgA);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.leaseMs).toBe(180);
    expect(await manager.acquire(orgA)).toBeNull();
    expect(await manager.acquire(orgB)).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await first!.renew()).toBe('renewed');
    await new Promise((resolve) => setTimeout(resolve, 100));
    replacement = await manager.acquire(orgA);
    expect(replacement).not.toBeNull();
    expect(await second!.renew()).toBe('lost');
    expect(await second!.release()).toBe(false);
    second = null;
    expect(await manager.acquire(orgA)).toBeNull();
    await first!.release();
    first = null;
    expect(await manager.acquire(orgA)).not.toBeNull();
  } finally {
    await first?.release();
    await second?.release();
    await replacement?.release();
    await manager.close();
  }
});

test('permit renewal distinguishes limiter transport outage from lost ownership', async ({
  services,
}) => {
  const proxy = await FaultProxy.start(services.valkey.limiterUrl);
  const manager = await StepPermitManager.create({
    url: proxy.url,
    prefix: `${services.queuePrefix}:permit-reconnect`,
    leaseMs: 600,
  });
  const permit = await manager.acquire(randomUUID());
  try {
    expect(permit).not.toBeNull();
    proxy.disconnect();
    await expect
      .poll(() => permit!.renew(), { timeout: 3000 })
      .toBe('unavailable');
    proxy.restore();
    await expect.poll(() => permit!.renew(), { timeout: 5000 }).toBe('renewed');
  } finally {
    await permit?.release();
    await manager.close();
    await proxy.close();
  }
});

test('outbox routing carries deterministic run-step IDs and priority into both BullMQ queues', async ({
  services,
}) => {
  const ctx = { orgId: randomUUID(), userId: randomUUID() };
  const runId = randomUUID();
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 3,
    statementTimeoutMs: 10000,
  });
  const repository = new OutboxRepository(database);
  const producer = new QueueProducer({
    url: services.valkey.queueUrl,
    limiterUrl: services.valkey.limiterUrl,
    prefix: services.queuePrefix,
  });
  const queues = ['ai-interactive', 'ai-batch'].map(
    (name) =>
      new Queue(name, {
        connection: { url: services.valkey.queueUrl },
        prefix: services.queuePrefix,
      }),
  );
  const entries = [
    {
      type: 'run.start.v1' as const,
      sequence: 1,
      queue: 'ai-interactive' as const,
      priority: 3,
    },
    {
      type: 'run.advance.v1' as const,
      sequence: 2,
      queue: 'ai-batch' as const,
      priority: 5,
    },
    {
      type: 'run.resume.v1' as const,
      sequence: 3,
      queue: 'ai-interactive' as const,
      priority: 2,
    },
  ];
  const ids: string[] = [];
  const session = new DispatcherSession(services.appUrl);
  const dispatcher = new OutboxDispatcher(repository, session, producer, {
    pollMs: 30,
    retryBaseMs: 50,
    retryCapMs: 200,
    batchSize: 10,
    leaseMs: 1000,
    enqueueTimeoutMs: 500,
  });
  const abort = new AbortController();
  const task = dispatcher.start(abort.signal);
  try {
    for (const entry of entries) {
      const payload = {
        runId,
        sequence: entry.sequence,
        expectedVersion: entry.sequence,
      };
      const input = {
        type: entry.type,
        ctx,
        payload,
      };
      const id = await database.withTenant(ctx, (tx) =>
        repository.append(tx, input, {
          id: stepJobId(runId, entry.sequence),
          queue: entry.queue,
          priority: entry.priority,
        }),
      );
      ids.push(id);
      expect(
        await database.withTenant(ctx, (tx) =>
          repository.append(tx, input, {
            id,
            queue: entry.queue,
            priority: entry.priority,
          }),
        ),
      ).toBe(id);
    }
    await expect
      .poll(
        async () => {
          const found = await Promise.all(
            entries.map(async (entry, index) => {
              const queue = queues[entry.queue === 'ai-interactive' ? 0 : 1]!;
              return queue.getJob(ids[index]!);
            }),
          );
          return found.filter(Boolean).length;
        },
        { timeout: 10000 },
      )
      .toBe(3);

    for (const [index, entry] of entries.entries()) {
      const queue = queues[entry.queue === 'ai-interactive' ? 0 : 1]!;
      const bullJob = await queue.getJob(ids[index]!);
      expect(bullJob?.id).toBe(ids[index]);
      expect(bullJob?.opts.priority).toBe(entry.priority);
      expect(bullJob?.data.outboxId).toBe(ids[index]);
    }

    const conflicting = entries[0]!;
    await expect(
      database.withTenant(ctx, (tx) =>
        repository.append(
          tx,
          {
            type: conflicting.type,
            ctx,
            payload: { runId, sequence: 1, expectedVersion: 99 },
          },
          {
            id: ids[0]!,
            queue: conflicting.queue,
            priority: conflicting.priority,
          },
        ),
      ),
    ).rejects.toThrow('Outbox ID conflicts with existing job');
    await expect(
      database.withTenant(ctx, (tx) =>
        repository.append(
          tx,
          {
            type: conflicting.type,
            ctx,
            payload: { runId, sequence: 1, expectedVersion: 1 },
          },
          { id: ids[0]!, queue: 'ai-batch', priority: conflicting.priority },
        ),
      ),
    ).rejects.toThrow('Outbox ID conflicts with existing job');
    await expect(
      database.withTenant(ctx, (tx) =>
        repository.append(
          tx,
          {
            type: conflicting.type,
            ctx,
            payload: { runId, sequence: 1, expectedVersion: 1 },
          },
          { id: ids[0]!, queue: conflicting.queue, priority: 1 },
        ),
      ),
    ).rejects.toThrow('Outbox ID conflicts with existing job');
  } finally {
    abort.abort();
    await task;
    await session.close();
    await Promise.all(queues.map((queue) => queue.close()));
    await producer.close();
    await database.close();
  }
});
