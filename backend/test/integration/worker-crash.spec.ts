import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { QueueProducer } from '../../src/infrastructure/queue/index.js';
import {
  installEffectFixture,
  inspectJob,
} from '../../src/infrastructure/db/testing/job-effects.js';
import { spawnFixtureWorker } from '../process/worker-harness.js';

test.beforeAll(async ({ services }) => {
  await installEffectFixture(services);
});
for (const failpoint of ['before-commit', 'after-commit-before-ack'] as const)
  test(`real worker crash at ${failpoint} redelivers with one effect`, async ({
    services,
  }) => {
    const producer = new QueueProducer({
      url: services.valkey.queueUrl,
      prefix: services.queuePrefix,
    });
    const queue = new Queue('ai-interactive', {
      connection: { url: services.valkey.queueUrl },
      prefix: services.queuePrefix,
    });
    const job = {
      outboxId: randomUUID(),
      type: 'platform.noop.v1' as const,
      ctx: { orgId: randomUUID() },
      payload: { probeId: randomUUID() },
    };
    const first = await spawnFixtureWorker({ services, failpoint });
    let replacement: Awaited<ReturnType<typeof spawnFixtureWorker>> | undefined;
    try {
      await producer.enqueue(job);
      await first.checkpoint(failpoint);
      expect(await inspectJob(services, job.outboxId)).toMatchObject(
        failpoint === 'before-commit'
          ? { effects: 0, receipts: 0 }
          : { effects: 1, receipts: 1 },
      );
      await first.kill();
      expect(first.exited()).toBe(true);
      replacement = await spawnFixtureWorker({ services });
      await replacement.checkpoint('delivery');
      await expect
        .poll(async () => (await queue.getJob(job.outboxId))?.getState(), {
          timeout: 10000,
        })
        .toBe('completed');
      expect((await queue.getJob(job.outboxId))!.returnvalue).toBe(
        failpoint === 'before-commit' ? 'processed' : 'duplicate',
      );
      expect(await inspectJob(services, job.outboxId)).toMatchObject({
        effects: 1,
        receipts: 1,
      });
    } finally {
      await first.close();
      await replacement?.close();
      await producer.close();
      await queue.close();
    }
  });
