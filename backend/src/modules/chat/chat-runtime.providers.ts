import type { Provider } from '@nestjs/common';
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
import { RunEventsService } from './run-events.service.js';
import { SseStreamReader } from '../../infrastructure/queue/sse-stream-reader.js';
import { StreamHub } from '../../infrastructure/queue/stream-hub.js';
import { SseConnectionRegistry } from '../../infrastructure/queue/sse-connection-registry.js';

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

export function chatApiProviders(
  config: Extract<RuntimeConfig, { runtime: 'api' }>,
): Provider[] {
  return [
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
    {
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
                new URL(
                  '../../../config/model-allowlist.json',
                  import.meta.url,
                ),
                'utf8',
              ),
            ),
          ),
        ),
    },
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
      provide: RunEventsService,
      inject: [
        TenantDatabase,
        AiRunRepository,
        RunAuthorizationService,
        StreamHub,
        SseConnectionRegistry,
        RUN_SSE_REVALIDATION,
      ],
      useFactory: (
        database: TenantDatabase,
        runs: AiRunRepository,
        authorization: RunAuthorizationService,
        hub: StreamHub,
        registry: SseConnectionRegistry,
        revalidation: ConstructorParameters<typeof RunEventsService>[7],
      ) =>
        new RunEventsService(
          database,
          runs,
          authorization,
          hub,
          registry,
          config.queuePrefix,
          config.chat.maxConnectionsPerUser,
          revalidation,
        ),
    },
  ];
}
