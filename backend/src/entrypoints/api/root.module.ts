import { Module, type DynamicModule } from '@nestjs/common';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { RuntimeConfigModule } from '../../config/config.module.js';
import { DbModule } from '../../infrastructure/db/index.js';
import { TelemetryModule } from '../../infrastructure/telemetry/index.js';
import { PlatformModule } from '../../modules/platform/index.js';
import { runtimeProviders } from '../../bootstrap/runtime-providers.js';
import { StorageModule } from '../../infrastructure/storage/index.js';
import { QueueModule } from '../../infrastructure/queue/index.js';
import { HealthController } from '../../modules/platform/health.controller.js';
import { DiagnosticController } from '../../modules/platform/diagnostic.controller.js';
@Module({})
export class ApiRootModule {
  static forConfig(
    config: Extract<RuntimeConfig, { runtime: 'api' }>,
    identityModules: DynamicModule[] = [],
    auth?: { check(): Promise<'up' | 'down'> },
  ): DynamicModule {
    return {
      module: ApiRootModule,
      imports: [
        ...identityModules,
        RuntimeConfigModule.forConfig(config),
        TelemetryModule.forRuntime('api'),
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
        QueueModule.forProducer({
          url: config.valkey.queueUrl,
          prefix: config.queuePrefix,
        }),
      ],
      providers: runtimeProviders(config, auth),
      controllers: [HealthController, DiagnosticController],
    };
  }
}
