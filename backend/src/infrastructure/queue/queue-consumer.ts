import 'reflect-metadata';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Queue, type Job } from 'bullmq';
import {
  parseJobEnvelope,
  type JobEnvelope,
  type TenantJobHandler,
} from '../db/index.js';
import type { StepClaim, TenantDatabase } from '../db/index.js';
import { StepPermitReferenceRepository } from '../db/index.js';
import type { JobHandlerRegistry, QueueJobHandler } from './job-contracts.js';
import {
  StepPermitManager,
  STEP_PERMIT_RENEWAL_DIVISOR,
} from './step-permits.js';
import { QUEUE_NAMES, type QueueOptions } from './queue-producer.js';

/** Runs short effects through the F0 receipt transaction. */
export interface JobRunner {
  execute(
    job: JobEnvelope,
    handler: TenantJobHandler,
  ): Promise<'processed' | 'duplicate'>;
}

export interface QueueConsumerTiming {
  lockDuration: number;
  stalledInterval: number;
  interactiveConcurrency: number;
  batchConcurrency: number;
  stepLeaseMs: number;
  busyRetryMs: number;
}

const DEFAULT_TIMING: QueueConsumerTiming = {
  lockDuration: 30000,
  stalledInterval: 30000,
  interactiveConcurrency: 4,
  batchConcurrency: 2,
  stepLeaseMs: 30000,
  busyRetryMs: 500,
};

export class QueueConsumer {
  #app: INestApplicationContext | undefined;
  #permitManager: StepPermitManager | undefined;
  #lastProgress = 0;
  #activeJobs = 0;
  readonly #activeControllers = new Set<AbortController>();
  readonly #failedQueues = new Map<string, Queue>();
  #failedTimer: ReturnType<typeof setInterval> | undefined;
  #failedScan: Promise<void> = Promise.resolve();
  #failedCursor = new Map<string, number>();
  #registryValue: JobHandlerRegistry | undefined;
  #closing = false;
  readonly #timing: QueueConsumerTiming;
  readonly #permitReferences?: StepPermitReferenceRepository;

  constructor(
    private readonly options: QueueOptions,
    private readonly executor: JobRunner,
    timing: Partial<QueueConsumerTiming> = {},
    database?: TenantDatabase,
  ) {
    this.#timing = { ...DEFAULT_TIMING, ...timing };
    if (database)
      this.#permitReferences = new StepPermitReferenceRepository(database);
  }

  async start(
    registryOrHandler: JobHandlerRegistry | TenantJobHandler,
  ): Promise<void> {
    if (this.#app) throw new Error('Consumer already started');
    this.#closing = false;
    if (
      Object.values(this.#timing).some(
        (value) => !Number.isSafeInteger(value) || value < 1,
      )
    )
      throw new Error('Invalid queue consumer configuration');
    const registry = this.#registry(registryOrHandler);
    const process = (job: Job) => this.#process(job, registry);
    const workerOptions = (concurrency: number) => ({
      lockDuration: this.#timing.lockDuration,
      stalledInterval: this.#timing.stalledInterval,
      concurrency,
    });
    @Processor(
      'ai-interactive',
      workerOptions(this.#timing.interactiveConcurrency),
    )
    class InteractiveProcessor extends WorkerHost {
      async process(job: Job): Promise<unknown> {
        return process(job);
      }
    }
    @Processor('ai-batch', workerOptions(this.#timing.batchConcurrency))
    class BatchProcessor extends WorkerHost {
      async process(job: Job): Promise<unknown> {
        return process(job);
      }
    }
    @Module({
      imports: [
        BullModule.forRoot({
          connection: { url: this.options.url, maxRetriesPerRequest: null },
          prefix: this.options.prefix,
        }),
        BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
      ],
      providers: [InteractiveProcessor, BatchProcessor],
    })
    class WorkerModule {}

    const permits = await StepPermitManager.create({
      url: this.options.limiterUrl ?? this.options.url,
      prefix: `${this.options.prefix}:limiter`,
      leaseMs: this.#timing.stepLeaseMs,
    });
    let app: INestApplicationContext | undefined;
    try {
      app = await NestFactory.createApplicationContext(WorkerModule, {
        logger: false,
        abortOnError: false,
      });
      this.#app = app;
      this.#permitManager = permits;
      this.#registryValue = registry;
      for (const name of QUEUE_NAMES) {
        const queue = new Queue(name, {
          connection: {
            url: this.options.url,
            maxRetriesPerRequest: 1,
            connectTimeout: 2000,
            commandTimeout: 2000,
            retryStrategy: (attempt: number) => Math.min(attempt * 100, 500),
          },
          prefix: this.options.prefix,
        });
        queue.on('error', () => undefined);
        this.#failedQueues.set(name, queue);
        this.#failedCursor.set(name, 0);
      }
      const interactive = app.get(InteractiveProcessor).worker;
      const batch = app.get(BatchProcessor).worker;
      interactive.on('error', () => undefined);
      batch.on('error', () => undefined);
      await Promise.all([interactive.waitUntilReady(), batch.waitUntilReady()]);
      this.#failedTimer = setInterval(() => this.#scanFailed(), 1000);
      void this.#scanFailed();
    } catch {
      this.#app = undefined;
      this.#permitManager = undefined;
      this.#registryValue = undefined;
      await Promise.all(
        [...this.#failedQueues.values()].map((queue) => queue.close()),
      );
      this.#failedQueues.clear();
      await app?.close();
      await permits.close();
      throw new Error('Queue consumer startup failed');
    }
  }

  isProgressing(staleMs: number, now = Date.now()): boolean {
    return (
      this.#app !== undefined &&
      (this.#activeJobs === 0 || now - this.#lastProgress < staleMs)
    );
  }

  async close(): Promise<void> {
    const app = this.#app;
    const permits = this.#permitManager;
    this.#app = undefined;
    this.#permitManager = undefined;
    this.#closing = true;
    if (this.#failedTimer) clearInterval(this.#failedTimer);
    this.#failedTimer = undefined;
    for (const controller of this.#activeControllers)
      controller.abort(new Error('AI worker shutting down'));
    await app?.close();
    await this.#failedScan;
    await Promise.all(
      [...this.#failedQueues.values()].map((queue) => queue.close()),
    );
    this.#failedQueues.clear();
    this.#registryValue = undefined;
    await permits?.close();
  }

  async #process(job: Job, registry: JobHandlerRegistry): Promise<unknown> {
    this.#beginProgress();
    try {
      let envelope: JobEnvelope;
      let handler: QueueJobHandler;
      try {
        envelope = parseJobEnvelope(job.data);
        if (job.name !== envelope.type) throw new Error('Job type mismatch');
        handler = registry.resolve(job.name);
      } catch {
        throw new Error('Invalid job');
      }
      if (handler.strategy === 'short-transaction')
        return await this.executor.execute(envelope, handler.handle);
      if (handler.strategy === 'cleanup-work') {
        const outcome = await handler.handle(envelope);
        if (outcome === 'pending')
          await this.#delay(job, Date.now() + this.#timing.busyRetryMs);
        return 'processed';
      }
      const outcome = await this.#executeDurable(envelope, handler);
      if (outcome.kind === 'busy') {
        if (!Number.isSafeInteger(outcome.retryAtMs))
          throw new Error('Invalid job outcome');
        await this.#delay(job, outcome.retryAtMs);
      }
      return 'processed';
    } catch (error) {
      if (error instanceof DelayedError) throw error;
      // Error details may contain prompts; retain only the fixed safe message.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Job execution failed');
    } finally {
      this.#endProgress();
    }
  }

  async #executeDurable(
    job: JobEnvelope,
    registration: Extract<QueueJobHandler, { strategy: 'durable-step' }>,
  ): Promise<{ kind: 'done' } | { kind: 'busy'; retryAtMs: number }> {
    const manager = this.#permitManager;
    if (!manager) throw new Error('Step permit manager unavailable');
    const permit = await manager.acquire(job.ctx.orgId);
    if (!permit)
      return { kind: 'busy', retryAtMs: Date.now() + this.#timing.busyRetryMs };

    const controller = new AbortController();
    this.#activeControllers.add(controller);
    const renewIntervalMs = Math.max(
      1,
      Math.floor(manager.leaseMs / STEP_PERMIT_RENEWAL_DIVISOR),
    );
    let leaseLost = false;
    let renewal = Promise.resolve();
    const interval = setInterval(() => {
      renewal = renewal.then(async () => {
        if ((await permit.renew()) === 'lost') {
          leaseLost = true;
          controller.abort();
        }
      });
    }, renewIntervalMs);
    let result: Awaited<ReturnType<typeof registration.handle>> | undefined;
    let handlerError: unknown;
    let handlerFailed = false;
    let recordedClaim: StepClaim | undefined;
    try {
      result = await registration.handle(job, {
        signal: controller.signal,
        permit,
        ...(this.#permitReferences
          ? {
              recordClaim: async (claim: StepClaim) => {
                await this.#permitReferences!.record(
                  permit.ownerReference,
                  claim,
                );
                recordedClaim = claim;
              },
            }
          : {}),
      });
    } catch (error) {
      handlerFailed = true;
      handlerError = error;
    } finally {
      clearInterval(interval);
      try {
        await renewal;
        await permit.release();
        if (recordedClaim)
          await this.#permitReferences?.remove(
            permit.ownerReference,
            recordedClaim,
          );
      } finally {
        this.#activeControllers.delete(controller);
      }
    }
    if (
      handlerFailed &&
      leaseLost &&
      controller.signal.aborted &&
      handlerError === controller.signal.reason
    )
      return { kind: 'busy', retryAtMs: Date.now() + this.#timing.busyRetryMs };
    if (handlerFailed) throw handlerError;
    if (!result) throw new Error('Invalid job outcome');
    if (leaseLost)
      return { kind: 'busy', retryAtMs: Date.now() + this.#timing.busyRetryMs };
    if (result.kind === 'done') return result;
    if (
      result.kind !== 'busy' ||
      !Number.isSafeInteger(result.retryAtMs) ||
      result.retryAtMs < 0
    )
      throw new Error('Invalid job outcome');
    return result;
  }

  async #delay(job: Job, retryAtMs: number): Promise<never> {
    if (!job.token) throw new Error('Queue lock unavailable');
    await job.moveToDelayed(Math.max(Date.now() + 1, retryAtMs), job.token);
    throw new DelayedError();
  }

  #registry(value: JobHandlerRegistry | TenantJobHandler): JobHandlerRegistry {
    if (typeof value !== 'function') return value;
    return {
      resolve: (type) => {
        if (type !== 'platform.noop.v1') throw new Error('Unknown job type');
        return { strategy: 'short-transaction', handle: value };
      },
    };
  }

  #beginProgress(): void {
    this.#activeJobs++;
    this.#lastProgress = Date.now();
  }

  #endProgress(): void {
    this.#activeJobs = Math.max(0, this.#activeJobs - 1);
    this.#lastProgress = Date.now();
  }

  #scanFailed(): void {
    if (this.#failedScanning || !this.#registryValue) return;
    this.#failedScanning = true;
    this.#failedScan = Promise.all(
      [...this.#failedQueues.entries()].map(async ([name, queue]) => {
        const start = this.#failedCursor.get(name) ?? 0;
        try {
          const jobs = await queue.getFailed(start, start + 99);
          this.#failedCursor.set(name, jobs.length === 100 ? start + 100 : 0);
          for (const job of jobs) {
            if (this.#closing) break;
            const result = await this.#reconcileFailed(job);
            if (result === 'done') await job.remove();
          }
        } catch {
          // Failed deliveries remain in BullMQ and are retried by the next scan.
        }
      }),
    )
      .then(() => undefined)
      .finally(() => {
        this.#failedScanning = false;
      });
  }

  #failedScanning = false;

  async #reconcileFailed(job: Job): Promise<'done' | 'retry' | 'retain'> {
    try {
      const envelope = parseJobEnvelope(job.data);
      if (job.name !== envelope.type) return 'retain';
      const handler = this.#registryValue?.resolve(job.name);
      if (handler?.strategy !== 'durable-step') return 'retain';
      if (!handler.exhausted) return 'retry';
      return await handler.exhausted(envelope);
    } catch {
      return 'retry';
    }
  }
}
