import type { Provider } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { RuntimeConfig } from '../config/runtime-config.js';
import {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
  TenantDatabase,
} from '../infrastructure/db/index.js';
import {
  MODEL_GATEWAY,
  type ModelGateway,
} from '../infrastructure/ai/index.js';
import { CancelSignals, RunStreams } from '../infrastructure/queue/index.js';
import { JobExecutor } from '../modules/platform/index.js';
import {
  RunRegistry,
  StepCoordinator,
  StepExecutor,
} from '../modules/chat/index.js';
import { RunAuthorizationService } from '../modules/identity-access/index.js';
import { AttemptService } from '../modules/usage/index.js';
import { ChatCleanupWorker } from '../modules/chat/chat-cleanup.worker.js';
import { ChatTitleService } from '../modules/chat/chat-title.service.js';
import { RunService } from '../modules/chat/run.service.js';
import { chatRunServiceProvider } from '../modules/chat/chat-runtime.providers.js';
import { StepPermitManager } from '../infrastructure/queue/step-permits.js';
import { queueStepPermitPrefix } from '../infrastructure/queue/queue-producer.js';

export function aiWorkerProviders(
  config: Extract<RuntimeConfig, { runtime: 'ai-worker' }>,
): Provider[] {
  return [
    chatRunServiceProvider(config),
    {
      provide: ChatTitleService,
      inject: [TenantDatabase, RunService],
      useFactory: (db: TenantDatabase, runs: RunService) =>
        new ChatTitleService(db, runs),
    },
    {
      provide: CancelSignals,
      inject: [TenantDatabase, AiRunRepository],
      useFactory: (db: TenantDatabase, runs: AiRunRepository) =>
        new CancelSignals({
          url: config.valkey.streamsUrl,
          prefix: config.queuePrefix,
          databaseUrl: config.database.appUrl,
          database: db,
          runs,
        }),
    },
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
            advanceStreamGeneration: (claim, observed) =>
              db.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) => steps.advanceStreamGeneration(tx, claim, observed),
                { timeoutMs: 500 },
              ),
            authorizeTerminal: (claim) =>
              db.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) => steps.streamTerminalProof(tx, claim),
              ),
            advanceTerminalStreamGeneration: (claim, observed) =>
              db.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) =>
                  steps.advanceTerminalStreamGeneration(tx, claim, observed),
                { timeoutMs: 500 },
              ),
            authorizeCommitted: (claim, event) =>
              db.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) => steps.streamCommittedProof(tx, claim, event),
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
      provide: ChatCleanupWorker,
      inject: [TenantDatabase, RunStreams, PinoLogger],
      useFactory: async (
        db: TenantDatabase,
        streams: RunStreams,
        logger: PinoLogger,
      ) =>
        new ChatCleanupWorker(
          db,
          streams,
          await StepPermitManager.create({
            url: config.valkey.limiterUrl,
            prefix: queueStepPermitPrefix(config.queuePrefix),
          }),
          undefined,
          {
            targetMs: config.chat.deleteTargetMs,
            observer: {
              record: (metric) =>
                logger.info({
                  event: 'chat_cleanup_metric',
                  result: metric.event,
                  phase: metric.phase,
                  elapsedMs: metric.elapsedMs,
                  overdueMs: metric.overdueMs,
                }),
            },
          },
        ),
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
        CancelSignals,
        ChatTitleService,
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
        cancelSignals: CancelSignals,
        chatTitles: ChatTitleService,
      ) => {
        const operations = new AiOperationRepository();
        const coordinator = new StepCoordinator(
          db,
          runs,
          steps,
          new AttemptService(),
          outbox,
          new JobExecutor(db),
          undefined,
          operations,
        );
        return new StepExecutor({
          database: db,
          runs,
          steps,
          operations,
          facts: new RunActorFactsRepository(),
          authorization,
          coordinator,
          attempts: new AttemptService(),
          registry,
          gateway,
          streams,
          cancelSignals,
          chatTitles,
        });
      },
    },
  ];
}
