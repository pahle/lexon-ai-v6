import { Module, type DynamicModule } from '@nestjs/common';
import { StoragePort } from './storage-port.js';
import { S3Storage, type StorageOptions } from './s3-storage.js';
@Module({})
export class StorageModule {
  static forOptions(options: StorageOptions): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        { provide: StoragePort, useFactory: () => new S3Storage(options) },
      ],
      exports: [StoragePort],
    };
  }
}
