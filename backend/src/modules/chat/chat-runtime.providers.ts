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
import { RunAuthorizationService } from '../identity-access/index.js';
import { createProductionRunRegistry, RunRegistry } from './run-registry.js';
import { ChatHistoryContextProvider } from './chat-history-context.js';
import { RunService } from './run.service.js';
import { ChatService } from './chat.service.js';

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
  ];
}
