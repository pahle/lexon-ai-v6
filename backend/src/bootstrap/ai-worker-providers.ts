import type { Provider } from '@nestjs/common';
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

export function aiWorkerProviders(
  config: Extract<RuntimeConfig, { runtime: 'ai-worker' }>,
): Provider[] {
  return [
    {
      provide: CancelSignals,
      inject: [TenantDatabase, AiRunRepository],
      useFactory: (db: TenantDatabase, runs: AiRunRepository) =>
        new CancelSignals({
          url: config.valkey.streamsUrl,
          prefix: config.queuePrefix,
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
        });
      },
    },
  ];
}
