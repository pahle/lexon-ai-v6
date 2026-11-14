import type { InjectionToken, Provider } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { RuntimeConfig } from '../config/runtime-config.js';
import {
  TenantDatabase,
  OutboxRepository,
  DispatcherSession,
  AiCapacityRepository,
} from '../infrastructure/db/index.js';
import {
  QueueProducer,
  QueueConsumer,
  CancelSignals,
  checkValkeyPolicy,
} from '../infrastructure/queue/index.js';
import { StoragePort } from '../infrastructure/storage/index.js';
import { HealthIndicators } from '../infrastructure/telemetry/index.js';
import { JobExecutor, OutboxDispatcher } from '../modules/platform/index.js';
import { StepExecutor } from '../modules/chat/index.js';
import { RunStreams } from '../infrastructure/queue/index.js';
import { RuntimeLifecycle } from './runtime-lifecycle.js';
import { ChatCleanupWorker } from '../modules/chat/chat-cleanup.worker.js';
import { ChatTitleService } from '../modules/chat/chat-title.service.js';
import { StreamHub } from '../infrastructure/queue/stream-hub.js';
export function runtimeProviders(
  config: RuntimeConfig,
  auth?: { check(): Promise<'up' | 'down'> },
): Provider[] {
  const providers: Provider[] = [
    {
      provide: HealthIndicators,
      inject: [
        TenantDatabase,
        ...(config.runtime === 'api' || config.runtime === 'document-worker'
          ? [StoragePort]
          : []),
      ],
      useFactory: (db: TenantDatabase, storage?: StoragePort) =>
        new HealthIndicators(
          {
            database: db,
            ...(auth ? { auth } : {}),
            valkey: () =>
              checkValkeyPolicy(
                config.valkey,
                undefined,
                config.runtime === 'api' || config.runtime === 'ai-worker'
                  ? config.ai.streamsValkeyMaxMemoryBytes
                  : undefined,
              ),
            ...(storage ? { storage } : {}),
          },
          config.health.dependencyTimeoutMs,
        ),
    },
  ];
  if (config.runtime === 'ai-worker')
    providers.push({
      provide: QueueConsumer,
      inject: [TenantDatabase],
      useFactory: (db: TenantDatabase) =>
        new QueueConsumer(
          {
            url: config.valkey.queueUrl,
            limiterUrl: config.valkey.limiterUrl,
            prefix: config.queuePrefix,
          },
          new JobExecutor(db),
          {},
          db,
        ),
    });
  if (config.runtime === 'dispatcher')
    providers.push({
      provide: OutboxDispatcher,
      inject: [OutboxRepository, QueueProducer],
      useFactory: (repository: OutboxRepository, producer: QueueProducer) =>
        new OutboxDispatcher(
          repository,
          new DispatcherSession(config.database.appUrl),
          producer,
          config.dispatcher,
        ),
    });
  const capacity = config.runtime === 'api' || config.runtime === 'ai-worker';
  const tokens: InjectionToken[] =
    config.runtime === 'api'
      ? [QueueProducer, StoragePort, StreamHub]
      : config.runtime === 'document-worker'
        ? [StoragePort]
        : config.runtime === 'ai-worker'
          ? [
              QueueConsumer,
              StepExecutor,
              RunStreams,
              CancelSignals,
              ChatTitleService,
            ]
          : [QueueProducer, OutboxDispatcher];
  if (capacity) tokens.push(AiCapacityRepository);
  if (config.runtime === 'ai-worker') tokens.push(ChatCleanupWorker);
  providers.push({
    provide: RuntimeLifecycle,
    inject: [TenantDatabase, HealthIndicators, PinoLogger, ...tokens],
    useFactory: (
      db: TenantDatabase,
      indicators: HealthIndicators,
      logger: PinoLogger,
      ...dependencies: (
        | QueueProducer
        | QueueConsumer
        | StoragePort
        | OutboxDispatcher
        | AiCapacityRepository
        | StepExecutor
        | RunStreams
        | CancelSignals
        | StreamHub
        | ChatCleanupWorker
        | ChatTitleService
      )[]
    ) =>
      new RuntimeLifecycle(
        config,
        db,
        indicators,
        logger,
        dependencies.find(
          (x): x is QueueProducer => x instanceof QueueProducer,
        ),
        dependencies.find((x): x is StoragePort => x instanceof StoragePort),
        dependencies.find(
          (x): x is QueueConsumer => x instanceof QueueConsumer,
        ),
        dependencies.find(
          (x): x is OutboxDispatcher => x instanceof OutboxDispatcher,
        ),
        dependencies.find(
          (x): x is AiCapacityRepository => x instanceof AiCapacityRepository,
        ),
        dependencies.find((x): x is StepExecutor => x instanceof StepExecutor),
        dependencies.find((x): x is RunStreams => x instanceof RunStreams),
        dependencies.find(
          (x): x is CancelSignals => x instanceof CancelSignals,
        ),
        dependencies.find((x): x is StreamHub => x instanceof StreamHub),
        dependencies.find(
          (x): x is ChatCleanupWorker => x instanceof ChatCleanupWorker,
        ),
        dependencies.find(
          (x): x is ChatTitleService => x instanceof ChatTitleService,
        ),
      ),
  });
  return providers;
}
