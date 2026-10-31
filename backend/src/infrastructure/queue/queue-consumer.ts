import 'reflect-metadata';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  JobExecutor,
  type TenantJobHandler,
} from '../../modules/platform/index.js';
import { QUEUE_NAME, type QueueOptions } from './queue-producer.js';

export class QueueConsumer {
  #app: INestApplicationContext | undefined;
  constructor(
    private readonly options: QueueOptions,
    private readonly executor: JobExecutor,
    private readonly timing: {
      lockDuration: number;
      stalledInterval: number;
    } = { lockDuration: 30000, stalledInterval: 30000 },
  ) {}
  async start(handler: TenantJobHandler): Promise<void> {
    if (this.#app) throw new Error('Consumer already started');
    const executor = this.executor;
    @Processor(QUEUE_NAME, this.timing)
    class TenantProcessor extends WorkerHost {
      async process(job: Job): Promise<'processed' | 'duplicate'> {
        try {
          return await executor.execute(job.data, handler);
        } catch {
          throw new Error('Job execution failed');
        }
      }
    }
    @Module({
      imports: [
        BullModule.forRoot({
          connection: { url: this.options.url, maxRetriesPerRequest: null },
          prefix: this.options.prefix,
        }),
        BullModule.registerQueue({ name: QUEUE_NAME }),
      ],
      providers: [TenantProcessor],
    })
    class WorkerModule {}
    const app = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
      abortOnError: false,
    });
    this.#app = app;
    const worker = app.get(TenantProcessor).worker;
    worker.on('error', () => undefined);
    await worker.waitUntilReady();
  }
  async close(): Promise<void> {
    const app = this.#app;
    this.#app = undefined;
    await app?.close();
  }
}
