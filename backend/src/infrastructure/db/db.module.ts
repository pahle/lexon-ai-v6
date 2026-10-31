import { Module, type DynamicModule } from '@nestjs/common';
import { TenantDatabase, type DatabaseOptions } from './tenant-database.js';

@Module({})
export class DbModule {
  static forOptions(options: DatabaseOptions): DynamicModule {
    return {
      module: DbModule,
      providers: [
        {
          provide: TenantDatabase,
          useFactory: () => new TenantDatabase(options),
        },
      ],
      exports: [TenantDatabase],
    };
  }
}
