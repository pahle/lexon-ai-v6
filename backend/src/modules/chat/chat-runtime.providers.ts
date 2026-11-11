import type { OnModuleDestroy, Provider } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import {
  AiCapacityRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  TenantDatabase,
  RunActorFactsRepository,
} from '../../infrastructure/db/index.js';
import { ModelAllowlistSchema } from '../../infrastructure/ai/index.js';
import {
  RunAuthorizationService,
  RUN_SSE_REVALIDATION,
} from '../identity-access/index.js';
import { createProductionRunRegistry, RunRegistry } from './run-registry.js';
import { ChatHistoryContextProvider } from './chat-history-context.js';
import { RunService } from './run.service.js';
import { ChatService } from './chat.service.js';
import { ChatBranchService } from './chat-branch.service.js';
import { RunEventsService } from './run-events.service.js';
import { SseStreamReader } from '../../infrastructure/queue/sse-stream-reader.js';
import { StreamHub } from '../../infrastructure/queue/stream-hub.js';
import { SseConnectionRegistry } from '../../infrastructure/queue/sse-connection-registry.js';
import { CancelSignals, RunStreams } from '../../infrastructure/queue/index.js';
import { CancelService } from './cancel.service.js';
import { ChatDeletionService } from './chat-deletion.service.js';

export function chatRuntimeProviders(): Provider[] {
  return [
    {
      provide: ChatHistoryContextProvider,
      inject: [TenantDatabase],
      useFactory: (database: TenantDatabase) =>
        new ChatHistoryContextProvider(database),
    },
    {
      provide: RunRegistry,
      inject: [ChatHistoryContextProvider],
      useFactory: (history: ChatHistoryContextProvider) =>
        createProductionRunRegistry([history]),
    },
  ];
}

export function chatRunServiceProvider(
  config: Extract<RuntimeConfig, { runtime: 'api' | 'ai-worker' }>,
): Provider {
  return {
    provide: RunService,
    inject: [
      TenantDatabase,
      AiRunRepository,
      AiStepRepository,
      OutboxRepository,
      RunAuthorizationService,
      RunRegistry,
      AiCapacityRepository,
    ],
    useFactory: (
      database: TenantDatabase,
      runs: AiRunRepository,
      steps: AiStepRepository,
      outbox: OutboxRepository,
      authorization: RunAuthorizationService,
      registry: RunRegistry,
      capacity: AiCapacityRepository,
    ) =>
      new RunService(
        database,
        runs,
        steps,
        outbox,
        new RunActorFactsRepository(),
        authorization,
        registry,
        capacity,
        config.ai,
        ModelAllowlistSchema.parse(
          JSON.parse(
            readFileSync(
              new URL('../../../config/model-allowlist.json', import.meta.url),
              'utf8',
            ),
          ),
        ),
      ),
  };
}

export function chatApiProviders(
  config: Extract<RuntimeConfig, { runtime: 'api' }>,
): Provider[] {
  return [
    {
      provide: CancelSignals,
      inject: [TenantDatabase, AiRunRepository],
      useFactory: (database: TenantDatabase, runs: AiRunRepository) =>
        new CancelSignals({
          url: config.valkey.streamsUrl,
          prefix: config.queuePrefix,
          databaseUrl: config.database.appUrl,
          database,
          runs,
        }),
    },
    {
      provide: RunStreams,
      inject: [TenantDatabase, AiRunRepository, AiStepRepository],
      useFactory: (
        database: TenantDatabase,
        runs: AiRunRepository,
        steps: AiStepRepository,
      ) =>
        new RunStreams({
          url: config.valkey.streamsUrl,
          prefix: config.queuePrefix,
          authority: {
            authorizeActive: (claim) =>
              database.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) => steps.streamActiveProof(tx, claim),
              ),
            advanceStreamGeneration: (claim, observed) =>
              database.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) => steps.advanceStreamGeneration(tx, claim, observed),
                { timeoutMs: 500 },
              ),
            authorizeTerminal: (claim) =>
              database.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) => steps.streamTerminalProof(tx, claim),
              ),
            advanceTerminalStreamGeneration: (claim, observed) =>
              database.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) =>
                  steps.advanceTerminalStreamGeneration(tx, claim, observed),
                { timeoutMs: 500 },
              ),
            authorizeCommitted: (claim, event) =>
              database.withTenant(
                { orgId: claim.orgId, userId: claim.userId },
                (tx) => steps.streamCommittedProof(tx, claim, event),
              ),
            reconcile: (entries) =>
              Promise.all(
                entries.map(async (entry) => {
                  const result = await database.withTenant(
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
      provide: CancelService,
      inject: [
        TenantDatabase,
        AiRunRepository,
        AiStepRepository,
        RunAuthorizationService,
        RunStreams,
        CancelSignals,
      ],
      useFactory: (
        database: TenantDatabase,
        runs: AiRunRepository,
        steps: AiStepRepository,
        authorization: RunAuthorizationService,
        streams: RunStreams,
        signals: CancelSignals,
      ) =>
        new CancelService(
          database,
          runs,
          steps,
          new RunActorFactsRepository(),
          authorization,
          streams,
          signals,
        ),
    },
    {
      provide: ChatDeletionService,
      inject: [
        TenantDatabase,
        RunAuthorizationService,
        CancelSignals,
        RunEventsService,
      ],
      useFactory: (
        database: TenantDatabase,
        authorization: RunAuthorizationService,
        signals: CancelSignals,
        events: RunEventsService,
      ) =>
        new ChatDeletionService(
          database,
          authorization,
          signals,
          config.chat.deleteGraceMs,
          events,
        ),
    },
    {
      provide: ChatApiCancelLifecycle,
      inject: [RunStreams, CancelSignals],
      useFactory: (streams: RunStreams, signals: CancelSignals) =>
        new ChatApiCancelLifecycle(streams, signals),
    },
    {
      provide: SseStreamReader,
      useFactory: () => new SseStreamReader(config.valkey.streamsUrl),
    },
    {
      provide: StreamHub,
      inject: [SseStreamReader],
      useFactory: (reader: SseStreamReader) =>
        new StreamHub(
          reader,
          config.chat.heartbeatMs,
          config.chat.drainTimeoutMs,
        ),
    },
    {
      provide: SseConnectionRegistry,
      useFactory: () =>
        new SseConnectionRegistry(config.valkey.streamsUrl, config.queuePrefix),
    },
    chatRunServiceProvider(config),
    {
      provide: ChatService,
      inject: [TenantDatabase, RunService, RunAuthorizationService],
      useFactory: (
        database: TenantDatabase,
        runs: RunService,
        authorization: RunAuthorizationService,
      ) => new ChatService(database, runs, authorization),
    },
    {
      provide: ChatBranchService,
      inject: [TenantDatabase, RunService, RunAuthorizationService],
      useFactory: (
        database: TenantDatabase,
        runs: RunService,
        authorization: RunAuthorizationService,
      ) => new ChatBranchService(database, runs, authorization),
    },
    {
      provide: RunEventsService,
      inject: [
        TenantDatabase,
        AiRunRepository,
        RunAuthorizationService,
        StreamHub,
        SseConnectionRegistry,
        CancelSignals,
        RUN_SSE_REVALIDATION,
      ],
      useFactory: (
        database: TenantDatabase,
        runs: AiRunRepository,
        authorization: RunAuthorizationService,
        hub: StreamHub,
        registry: SseConnectionRegistry,
        signals: CancelSignals,
        revalidation: ConstructorParameters<typeof RunEventsService>[8],
      ) =>
        new RunEventsService(
          database,
          runs,
          authorization,
          hub,
          registry,
          signals,
          config.queuePrefix,
          config.chat.maxConnectionsPerUser,
          revalidation,
        ),
    },
  ];
}

class ChatApiCancelLifecycle implements OnModuleDestroy {
  constructor(
    private readonly streams: RunStreams,
    private readonly signals: CancelSignals,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.streams.close(), this.signals.close()]);
  }
}
