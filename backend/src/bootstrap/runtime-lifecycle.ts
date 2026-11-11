import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { RuntimeConfig } from '../config/runtime-config.js';
import {
  AiCapacityRepository,
  TenantDatabase,
} from '../infrastructure/db/index.js';
import {
  QueueProducer,
  QueueConsumer,
  CancelSignals,
  checkValkeyPolicy,
  RunStreams,
} from '../infrastructure/queue/index.js';
import { StoragePort } from '../infrastructure/storage/index.js';
import {
  HealthIndicators,
  HealthWriter,
  type HealthSnapshot,
} from '../infrastructure/telemetry/index.js';
import { JobRegistry, OutboxDispatcher } from '../modules/platform/index.js';
import { StepExecutor } from '../modules/chat/index.js';
import { ChatCleanupWorker } from '../modules/chat/chat-cleanup.worker.js';
import type { PinoLogger } from 'nestjs-pino';
import type { StreamHub } from '../infrastructure/queue/stream-hub.js';
export class RuntimeLifecycle implements OnModuleInit, OnModuleDestroy {
  #closed = false;
  #abort = new AbortController();
  #dispatchTask: Promise<void> | undefined;
  #writer: HealthWriter | undefined;
  constructor(
    private readonly config: RuntimeConfig,
    private readonly db: TenantDatabase,
    private readonly indicators: HealthIndicators,
    private readonly logger: PinoLogger,
    private readonly producer?: QueueProducer,
    private readonly storage?: StoragePort,
    private readonly consumer?: QueueConsumer,
    private readonly dispatcher?: OutboxDispatcher,
    private readonly capacity?: AiCapacityRepository,
    private readonly stepExecutor?: StepExecutor,
    private readonly runStreams?: RunStreams,
    private readonly cancelSignals?: CancelSignals,
    private readonly streamHub?: StreamHub,
    private readonly chatCleanupWorker?: ChatCleanupWorker,
  ) {}
  async onModuleInit(): Promise<void> {
    try {
      const policy = await checkValkeyPolicy(
        this.config.valkey,
        undefined,
        this.config.runtime === 'api' || this.config.runtime === 'ai-worker'
          ? this.config.ai.streamsValkeyMaxMemoryBytes
          : undefined,
      );
      if (Object.values(policy).some((status) => status !== 'up'))
        throw new Error('Valkey startup policy unavailable');
      if (
        this.config.runtime === 'api' ||
        this.config.runtime === 'ai-worker'
      ) {
        if (!this.capacity)
          throw new Error('AI capacity repository unavailable');
        await this.capacity.configure(this.config.ai);
      }
      if (this.consumer) {
        const registry = new JobRegistry();
        registry.register('platform.noop.v1', {
          strategy: 'short-transaction',
          handle: async () => undefined,
        });
        if (this.stepExecutor) {
          for (const type of [
            'run.start.v1',
            'run.advance.v1',
            'run.resume.v1',
          ])
            registry.register(type, {
              strategy: 'durable-step',
              handle: (job, context) =>
                this.stepExecutor!.execute(job, context),
              exhausted: (job) => this.stepExecutor!.exhausted(job),
            });
        }
        if (this.chatCleanupWorker)
          registry.register('chat.cleanup.v1', {
            strategy: 'cleanup-work',
            handle: (job) => this.chatCleanupWorker!.advance(job),
          });
        await this.consumer.start(registry);
      }
      if (this.dispatcher)
        this.#dispatchTask = this.dispatcher.start(this.#abort.signal);
      if (this.config.runtime !== 'api') {
        this.#writer = new HealthWriter(
          this.config.health,
          () => this.snapshot(),
          undefined,
          () => this.logger.error({ event: 'health_write_failed' }),
        );
        await this.#writer.cycle();
        this.#writer.start();
      }
      this.logger.info({ event: 'runtime_started' });
    } catch {
      await this.onModuleDestroy();
      throw new Error('Runtime startup failed');
    }
  }
  async snapshot(): Promise<HealthSnapshot> {
    const dependencies = await this.indicators.check(this.config.runtime);
    const state = this.dispatcher?.status() ?? 'active';
    const progressing =
      (!this.dispatcher ||
        this.dispatcher.isProgressing(this.config.health.staleMs)) &&
      (!this.consumer ||
        this.consumer.isProgressing(this.config.health.staleMs));
    const live = !this.#closed && progressing;
    return {
      status: live ? state : 'unhealthy',
      liveness: live ? 'up' : 'down',
      readiness:
        live &&
        state !== 'unhealthy' &&
        Object.values(dependencies).every((value) => value === 'up')
          ? 'up'
          : 'down',
      writtenAt: new Date().toISOString(),
      dependencies,
    };
  }
  async onModuleDestroy(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    await this.#writer?.stop();
    await this.#dispatchTask;
    await this.consumer?.close();
    await this.cancelSignals?.close();
    await this.chatCleanupWorker?.close();
    await this.runStreams?.close();
    await this.streamHub?.close();
    await this.producer?.close();
    await this.storage?.close();
    await this.db.close();
    this.logger.info({ event: 'runtime_stopped' });
  }
}
