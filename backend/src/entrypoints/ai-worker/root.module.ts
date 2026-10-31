import { Module, type DynamicModule } from '@nestjs/common';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { RuntimeConfigModule } from '../../config/config.module.js';
import { DbModule } from '../../infrastructure/db/index.js';
import { TelemetryModule } from '../../infrastructure/telemetry/index.js';
import { PlatformModule } from '../../modules/platform/index.js';
import { runtimeProviders } from '../../bootstrap/runtime-providers.js';
@Module({})
export class AiWorkerRootModule {
  static forConfig(
    config: Extract<RuntimeConfig, { runtime: 'ai-worker' }>,
  ): DynamicModule {
    return {
      module: AiWorkerRootModule,
      imports: [
        RuntimeConfigModule.forConfig(config),
        TelemetryModule.forRuntime('ai-worker'),
        DbModule.forOptions(config.database),
        PlatformModule,
      ],
      providers: runtimeProviders(config),
    };
  }
}
