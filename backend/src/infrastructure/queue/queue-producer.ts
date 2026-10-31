import { Queue } from 'bullmq';
import {
  parseJobEnvelope,
  type JobEnvelope,
} from '../../modules/platform/index.js';
export interface QueueOptions {
  url: string;
  prefix: string;
}
export const QUEUE_NAME = 'ai-interactive';
export class QueueProducer {
  readonly #queue: Queue;
  constructor(options: QueueOptions) {
    this.#queue = new Queue(QUEUE_NAME, {
      prefix: options.prefix,
      connection: {
        url: options.url,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        commandTimeout: 2000,
        retryStrategy: (attempt: number) => Math.min(attempt * 100, 1000),
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 250 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 5000 },
      },
    });
    this.#queue.on('error', () => undefined);
  }
  async enqueue(
    input: JobEnvelope,
    options: { timeoutMs: number } = { timeoutMs: 2000 },
  ): Promise<void> {
    const job = parseJobEnvelope(input);
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
      throw new Error('Invalid enqueue timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#queue.add(job.type, job, { jobId: job.outboxId }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout')),
            options.timeoutMs,
          );
        }),
      ]);
    } catch {
      throw new Error('Queue enqueue unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
  async close(): Promise<void> {
    await this.#queue.close();
  }
}
