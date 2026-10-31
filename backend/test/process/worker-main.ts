import 'reflect-metadata';
import { TenantDatabase } from '../../src/infrastructure/db/index.js';
import {
  JobExecutor,
  type JobEnvelope,
  type TenantJobHandler,
} from '../../src/modules/platform/index.js';
import type { TenantSession } from '../../src/infrastructure/db/index.js';
import { QueueConsumer } from '../../src/infrastructure/queue/index.js';
import { createEffectHandler } from '../../src/infrastructure/db/testing/job-effects.js';

interface Options {
  appUrl: string;
  queueUrl: string;
  prefix: string;
  failpoint?: string;
}
const send = (checkpoint: string) => process.send?.({ checkpoint });
const pause = () => new Promise<never>(() => undefined);
process.once('message', async (options: Options) => {
  const db = new TenantDatabase({
    appUrl: options.appUrl,
    poolMax: 1,
    statementTimeoutMs: 20000,
  });
  class FixtureExecutor extends JobExecutor {
    override async execute(job: JobEnvelope, handler: TenantJobHandler) {
      send('delivery');
      const result = await super.execute(job, handler);
      if (options.failpoint === 'after-commit-before-ack') {
        send(options.failpoint);
        await pause();
      }
      return result;
    }
  }
  const handler: TenantJobHandler = async (
    tx: TenantSession,
    job: JobEnvelope,
  ) => {
    await createEffectHandler()(tx, job);
    if (options.failpoint === 'before-commit') {
      send(options.failpoint);
      await pause();
    }
  };
  const consumer = new QueueConsumer(
    { url: options.queueUrl, prefix: options.prefix },
    new FixtureExecutor(db),
    { lockDuration: 1000, stalledInterval: 500 },
  );
  process.on('SIGTERM', () => {
    void consumer
      .close()
      .then(() => db.close())
      .then(() => process.exit(0));
  });
  await consumer.start(handler);
  send('ready');
});
