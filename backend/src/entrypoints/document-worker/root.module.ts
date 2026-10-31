import { Module, type DynamicModule } from '@nestjs/common';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { RuntimeConfigModule } from '../../config/config.module.js';
import { DbModule } from '../../infrastructure/db/index.js';
import { TelemetryModule } from '../../infrastructure/telemetry/index.js';
import { PlatformModule } from '../../modules/platform/index.js';
import { runtimeProviders } from '../../bootstrap/runtime-providers.js';
import { StorageModule } from '../../infrastructure/storage/index.js';
@Module({})
export class DocumentWorkerRootModule {
  static forConfig(
    config: Extract<RuntimeConfig, { runtime: 'document-worker' }>,
  ): DynamicModule {
    return {
      module: DocumentWorkerRootModule,
      imports: [
        RuntimeConfigModule.forConfig(config),
        TelemetryModule.forRuntime('document-worker'),
        DbModule.forOptions(config.database),
        PlatformModule,
        StorageModule.forOptions({
          endpoint: config.storage.endpoint,
          publicEndpoint: config.storage.publicEndpoint,
          bucket: config.storage.bucket,
          region: config.storage.region,
          credentials: {
            accessKeyId: config.storage.accessKey,
            secretAccessKey: config.storage.secretKey,
          },
          healthTimeoutMs: config.health.dependencyTimeoutMs,
        }),
      ],
      providers: runtimeProviders(config),
    };
  }
}
