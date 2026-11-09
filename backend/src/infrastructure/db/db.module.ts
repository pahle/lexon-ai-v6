import { Module, type DynamicModule } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository.js';
import { ProcessedJobsRepository } from './processed-jobs.repository.js';
import { TenantDatabase, type DatabaseOptions } from './tenant-database.js';
import { AiRunRepository } from './ai-run.repository.js';
import { AiStepRepository } from './ai-step.repository.js';
import { AiAttemptRepository } from './ai-attempt.repository.js';
import { AiCapacityRepository } from './ai-capacity.repository.js';
import { AiOperationRepository } from './ai-operation.repository.js';
import { UsageEventRepository } from './usage-event.repository.js';

@Module({})
export class DbModule {
  static forOptions(options: DatabaseOptions): DynamicModule {
    return {
      module: DbModule,
      providers: [
        {
          provide: OutboxRepository,
          inject: [TenantDatabase],
          useFactory: (database: TenantDatabase) =>
            new OutboxRepository(database),
        },
        ProcessedJobsRepository,
        AiRunRepository,
        AiStepRepository,
        AiAttemptRepository,
        UsageEventRepository,
        AiOperationRepository,
        {
          provide: AiCapacityRepository,
          inject: [TenantDatabase],
          useFactory: (database: TenantDatabase) =>
            new AiCapacityRepository(database),
        },
        {
          provide: TenantDatabase,
          useFactory: () => new TenantDatabase(options),
        },
      ],
      exports: [
        TenantDatabase,
        OutboxRepository,
        ProcessedJobsRepository,
        AiRunRepository,
        AiStepRepository,
        AiAttemptRepository,
        UsageEventRepository,
        AiOperationRepository,
        AiCapacityRepository,
      ],
    };
  }
}
