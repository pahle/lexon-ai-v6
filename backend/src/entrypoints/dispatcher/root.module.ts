import { Module, type DynamicModule } from '@nestjs/common';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { RuntimeConfigModule } from '../../config/config.module.js';
import { DbModule } from '../../infrastructure/db/index.js';
import { TelemetryModule } from '../../infrastructure/telemetry/index.js';
import { PlatformModule } from '../../modules/platform/index.js';
import { runtimeProviders } from '../../bootstrap/runtime-providers.js';
import { QueueModule } from '../../infrastructure/queue/index.js';
@Module({})
export class DispatcherRootModule {
  static forConfig(
    config: Extract<RuntimeConfig, { runtime: 'dispatcher' }>,
  ): DynamicModule {
    return {
      module: DispatcherRootModule,
      imports: [
        RuntimeConfigModule.forConfig(config),
        TelemetryModule.forRuntime('dispatcher'),
        DbModule.forOptions(config.database),
        PlatformModule,
        QueueModule.forProducer({
          url: config.valkey.queueUrl,
          prefix: config.queuePrefix,
        }),
      ],
      providers: runtimeProviders(config),
    };
  }
}
