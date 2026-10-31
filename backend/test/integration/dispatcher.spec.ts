import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  TenantDatabase,
  OutboxRepository,
  DispatcherSession,
} from '../../src/infrastructure/db/index.js';
import {
  OutboxDispatcher,
  JobExecutor,
} from '../../src/modules/platform/index.js';
import {
  QueueProducer,
  QueueConsumer,
} from '../../src/infrastructure/queue/index.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
import {
  installEffectFixture,
  createEffectHandler,
  inspectJob,
} from '../../src/infrastructure/db/testing/job-effects.js';
import {
  inspectOutbox,
  insertRawOutbox,
  terminateDispatcherLock,
  dispatcherConnections,
} from '../../src/infrastructure/db/testing/dispatcher.js';
import type { FileServices } from '../setup/provided-context.js';
const settings = {
  pollMs: 40,
  retryBaseMs: 50,
  retryCapMs: 200,
  batchSize: 2,
  leaseMs: 350,
  enqueueTimeoutMs: 100,
};
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function append(db: TenantDatabase) {
  return db.withTenant(
    { orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    (tx) =>
      new OutboxRepository().append(tx, {
        type: 'platform.noop.v1',
        ctx: { orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        payload: { probeId: randomUUID() },
      }),
  );
}
async function fixture(services: FileServices) {
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 4,
    statementTimeoutMs: 10000,
  });
  const repository = new OutboxRepository(db);
  const producer = new QueueProducer({
    url: services.valkey.queueUrl,
    prefix: services.queuePrefix,
  });
  const consumer = new QueueConsumer(
    { url: services.valkey.queueUrl, prefix: services.queuePrefix },
    new JobExecutor(db),
  );
  await consumer.start(createEffectHandler());
  const running: {
    controller: AbortController;
    task: Promise<void>;
    session: DispatcherSession;
  }[] = [];
  const run = (enqueue: Pick<QueueProducer, 'enqueue'> = producer) => {
    const session = new DispatcherSession(services.appUrl);
    const dispatcher = new OutboxDispatcher(
      repository,
      session,
      enqueue,
      settings,
    );
    const controller = new AbortController();
    const task = dispatcher.start(controller.signal);
    running.push({ controller, task, session });
    return { dispatcher, controller, task, session };
  };
  return {
    db,
    repository,
    producer,
    run,
    async close() {
      for (const item of running) item.controller.abort();
      await Promise.all(running.map((item) => item.task));
      await consumer.close();
      await producer.close();
      await db.close();
      expect(await dispatcherConnections(services)).toBe(0);
    },
  };
}
test.beforeAll(async ({ services }) => {
  await installEffectFixture(services);
});
test('one leader, healthy standby, startup scan, omitted notify and rolled-back append', async ({
  services,
}) => {
  const f = await fixture(services);
  try {
    const before = await append(f.db);
    const a = f.run();
    await expect.poll(() => a.dispatcher.status()).toBe('active');
    const b = f.run();
    await expect.poll(() => b.dispatcher.status()).toBe('standby');
    await expect
      .poll(async () => (await inspectJob(services, before)).effects)
      .toBe(1);
    const silent = await insertRawOutbox(services);
    await expect
      .poll(async () => (await inspectJob(services, silent)).effects)
      .toBe(1);
    let rolled = '';
    const rollbackContext = { orgId: randomUUID() };
    await expect(
      f.db.withTenant(rollbackContext, async (tx) => {
        rolled = await f.repository.append(tx, {
          type: 'platform.noop.v1',
          ctx: rollbackContext,
          payload: { probeId: randomUUID() },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await inspectJob(services, rolled)).outbox).toBe(0);
    await terminateDispatcherLock(services);
    a.controller.abort();
    await a.task;
    await expect.poll(() => b.dispatcher.status()).toBe('active');
    expect(a.session.isLeader()).toBe(false);
  } finally {
    await f.close();
  }
});
test('unavailable enqueue backs off unsent rows, permits eligible work and recovers', async ({
  services,
}) => {
  const f = await fixture(services);
  const proxy = await FaultProxy.start(services.valkey.queueUrl);
  const producer = new QueueProducer({
    url: proxy.url,
    prefix: services.queuePrefix,
  });
  try {
    proxy.disconnect();
    const id = await append(f.db);
    const a = f.run(producer);
    await expect
      .poll(async () => (await inspectOutbox(services, id)).attempts)
      .toBeGreaterThanOrEqual(2);
    const failed = await inspectOutbox(services, id);
    expect(failed.sent).toBe(false);
    expect(failed.error).toBe('enqueue_failed');
    expect(failed.delayMs).toBeLessThanOrEqual(settings.retryCapMs + 20);
    expect(a.dispatcher.status()).toBe('unhealthy');
    const later = await append(f.db);
    proxy.restore();
    await expect
      .poll(async () => (await inspectJob(services, later)).effects, {
        timeout: 5000,
      })
      .toBe(1);
    await expect
      .poll(async () => (await inspectOutbox(services, id)).sent)
      .toBe(true);
    expect((await inspectJob(services, id)).effects).toBe(1);
  } finally {
    await f.close();
    await producer.close();
    await proxy.close();
  }
});
test('crash after claim recovers the expired lease; replay after insertion still has one effect', async ({
  services,
}) => {
  const f = await fixture(services);
  const entered = gate();
  const release = gate();
  try {
    const id = await append(f.db);
    const old = f.run({
      async enqueue() {
        entered.resolve();
        await release.promise;
      },
    });
    await entered.promise;
    old.controller.abort();
    release.resolve();
    await old.task;
    expect((await inspectOutbox(services, id)).sent).toBe(false);
    const replacement = f.run();
    await expect
      .poll(async () => (await inspectJob(services, id)).effects)
      .toBe(1);
    replacement.controller.abort();
    await replacement.task;
    const replay = await append(f.db);
    const stopping = f.run({
      async enqueue(job, options) {
        await f.producer.enqueue(job, options);
        stopping.controller.abort();
      },
    });
    await stopping.task;
    expect((await inspectOutbox(services, replay)).sent).toBe(false);
    f.run();
    await expect
      .poll(async () => (await inspectOutbox(services, replay)).sent)
      .toBe(true);
    expect((await inspectJob(services, replay)).effects).toBe(1);
  } finally {
    release.resolve();
    await f.close();
  }
});
test('late enqueue response cannot complete a newer claim after leadership loss', async ({
  services,
}) => {
  const f = await fixture(services);
  const entered = gate();
  const release = gate();
  const newerEntered = gate();
  const newerRelease = gate();
  try {
    const id = await append(f.db);
    let oldCalls = 0;
    const old = f.run({
      async enqueue(job, options) {
        oldCalls++;
        await f.producer.enqueue(job, options);
        entered.resolve();
        await release.promise;
      },
    });
    await entered.promise;
    const token = (await inspectOutbox(services, id)).token!;
    await terminateDispatcherLock(services);
    const replacement = f.run({
      async enqueue(job, options) {
        await f.producer.enqueue(job, options);
        newerEntered.resolve();
        await newerRelease.promise;
      },
    });
    await expect.poll(() => replacement.dispatcher.status()).toBe('active');
    await newerEntered.promise;
    const newer = await inspectOutbox(services, id);
    expect(newer.token).not.toBe(token);
    expect(newer.sent).toBe(false);
    expect(await f.repository.markSent(id, token)).toBe(false);
    expect(await f.repository.reschedule(id, token, new Date())).toBe(false);
    release.resolve();
    await expect.poll(() => old.dispatcher.status()).toBe('standby');
    expect(oldCalls).toBe(1);
    newerRelease.resolve();
    await expect
      .poll(async () => (await inspectOutbox(services, id)).sent)
      .toBe(true);
    expect((await inspectJob(services, id)).effects).toBe(1);
  } finally {
    release.resolve();
    newerRelease.resolve();
    await f.close();
  }
});
test('invalid rows remain with sanitized backoff and do not block valid rows', async ({
  services,
}) => {
  const f = await fixture(services);
  try {
    const invalid = await insertRawOutbox(services, { invalid: true });
    const valid = await append(f.db);
    f.run();
    await expect
      .poll(async () => (await inspectOutbox(services, invalid)).error)
      .toBe('invalid_job');
    await expect
      .poll(async () => (await inspectJob(services, valid)).effects)
      .toBe(1);
    const row = await inspectOutbox(services, invalid);
    expect(row.sent).toBe(false);
    expect(row.attempts).toBeGreaterThan(0);
    expect(JSON.stringify(row)).not.toContain('secret-content');
  } finally {
    await f.close();
  }
});
