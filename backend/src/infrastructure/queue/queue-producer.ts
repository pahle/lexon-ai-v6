import { Queue } from 'bullmq';
import {
  isJobQueue,
  parseJobEnvelope,
  type JobEnvelope,
  type JobQueue,
} from '../db/index.js';
export interface QueueOptions {
  url: string;
  limiterUrl?: string;
  prefix: string;
}
export const QUEUE_NAME = 'ai-interactive';
export const QUEUE_NAMES: readonly JobQueue[] = ['ai-interactive', 'ai-batch'];
export class QueueProducer {
  readonly #queues: ReadonlyMap<JobQueue, Queue>;
  constructor(options: QueueOptions) {
    this.#queues = new Map(
      QUEUE_NAMES.map((name) => {
        const queue = new Queue(name, {
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
        queue.on('error', () => undefined);
        return [name, queue];
      }),
    );
  }
  async enqueue(
    input: JobEnvelope,
    options: {
      queue?: JobQueue;
      priority?: number;
      timeoutMs: number;
    } = { timeoutMs: 2000 },
  ): Promise<void> {
    const job = parseJobEnvelope(input);
    const queueName = options.queue ?? QUEUE_NAME;
    if (
      !isJobQueue(queueName) ||
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs <= 0 ||
      (options.priority !== undefined &&
        (!Number.isSafeInteger(options.priority) ||
          options.priority < 1 ||
          options.priority > 10))
    )
      throw new Error('Invalid enqueue options');
    const queue = this.#queues.get(queueName);
    if (!queue) throw new Error('Invalid queue routing');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        queue.add(job.type, job, {
          jobId: job.outboxId,
          ...(job.type === 'run.start.v1' ||
          job.type === 'run.advance.v1' ||
          job.type === 'run.resume.v1'
            ? { removeOnFail: false }
            : {}),
          ...(options.priority === undefined
            ? {}
            : { priority: options.priority }),
        }),
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
    await Promise.all([...this.#queues.values()].map((queue) => queue.close()));
  }
}
