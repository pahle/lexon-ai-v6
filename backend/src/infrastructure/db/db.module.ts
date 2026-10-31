import { Module, type DynamicModule } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository.js';
import { ProcessedJobsRepository } from './processed-jobs.repository.js';
import { TenantDatabase, type DatabaseOptions } from './tenant-database.js';

@Module({})
export class DbModule {
  static forOptions(options: DatabaseOptions): DynamicModule {
    return {
      module: DbModule,
      providers: [
        OutboxRepository,
        ProcessedJobsRepository,
        {
          provide: TenantDatabase,
          useFactory: () => new TenantDatabase(options),
        },
      ],
      exports: [TenantDatabase, OutboxRepository, ProcessedJobsRepository],
    };
  }
}
