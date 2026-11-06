import type { InjectionToken, Provider } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { RuntimeConfig } from '../config/runtime-config.js';
import {
  TenantDatabase,
  OutboxRepository,
  DispatcherSession,
  AiCapacityRepository,
  AiRunRepository,
  AiStepRepository,
  RunActorFactsRepository,
} from '../infrastructure/db/index.js';
import {
  QueueProducer,
  QueueConsumer,
  checkValkeyPolicy,
} from '../infrastructure/queue/index.js';
import { StoragePort } from '../infrastructure/storage/index.js';
import { HealthIndicators } from '../infrastructure/telemetry/index.js';
import { JobExecutor, OutboxDispatcher } from '../modules/platform/index.js';
import {
  MODEL_GATEWAY,
  type ModelGateway,
} from '../infrastructure/ai/index.js';
import { RunAuthorizationService } from '../modules/identity-access/index.js';
import {
  RunRegistry,
  StepCoordinator,
  StepExecutor,
} from '../modules/chat/index.js';
import { AttemptService } from '../modules/usage/index.js';
import { RunStreams } from '../infrastructure/queue/index.js';
import { RuntimeLifecycle } from './runtime-lifecycle.js';
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
            valkey: () => checkValkeyPolicy(config.valkey),
            ...(storage ? { storage } : {}),
          },
          config.health.dependencyTimeoutMs,
        ),
    },
  ];
  if (config.runtime === 'ai-worker')
    providers.push(
      {
        provide: RunStreams,
        inject: [TenantDatabase, AiRunRepository, AiStepRepository],
        useFactory: (
          db: TenantDatabase,
          runs: AiRunRepository,
          steps: AiStepRepository,
        ) =>
          new RunStreams({
            url: config.valkey.streamsUrl,
            prefix: config.queuePrefix,
            authority: {
              authorizeActive: (claim) =>
                db.withTenant(
                  { orgId: claim.orgId, userId: claim.userId },
                  (tx) => steps.streamActiveProof(tx, claim),
                ),
              authorizeTerminal: (claim) =>
                db.withTenant(
                  { orgId: claim.orgId, userId: claim.userId },
                  (tx) => steps.streamTerminalProof(tx, claim),
                ),
              reconcile: (entries) =>
                Promise.all(
                  entries.map(async (entry) => {
                    const result = await db.withTenant(
                      { orgId: entry.orgId, userId: entry.userId },
                      (tx) =>
                        runs.streamRegistryState(tx, entry.runId, entry.userId),
                    );
                    return result.state === 'terminal'
                      ? {
                          runId: entry.runId,
                          state: 'terminal' as const,
                          claim: result.claim,
                        }
                      : { runId: entry.runId, state: result.state };
                  }),
                ),
            },
          }),
      },
      {
        provide: StepExecutor,
        inject: [
          TenantDatabase,
          AiRunRepository,
          AiStepRepository,
          OutboxRepository,
          RunRegistry,
          RunAuthorizationService,
          MODEL_GATEWAY,
          RunStreams,
        ],
        useFactory: (
          db: TenantDatabase,
          runs: AiRunRepository,
          steps: AiStepRepository,
          outbox: OutboxRepository,
          registry: RunRegistry,
          authorization: RunAuthorizationService,
          gateway: ModelGateway,
          streams: RunStreams,
        ) => {
          const coordinator = new StepCoordinator(
            db,
            runs,
            steps,
            new AttemptService(),
            outbox,
            new JobExecutor(db),
          );
          return new StepExecutor({
            database: db,
            runs,
            steps,
            facts: new RunActorFactsRepository(),
            authorization,
            coordinator,
            attempts: new AttemptService(),
            registry,
            gateway,
            streams,
          });
        },
      },
    );
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
      ? [QueueProducer, StoragePort]
      : config.runtime === 'document-worker'
        ? [StoragePort]
        : config.runtime === 'ai-worker'
          ? [QueueConsumer, StepExecutor, RunStreams]
          : [QueueProducer, OutboxDispatcher];
  if (capacity) tokens.push(AiCapacityRepository);
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
      ),
  });
  return providers;
}
