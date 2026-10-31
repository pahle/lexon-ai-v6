import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadRuntimeConfig, type RuntimeName } from './runtime-config.js';

export const RUNTIME_CONFIG = Symbol('RuntimeConfig');

@Module({})
export class RuntimeConfigModule {
  static forRuntime(runtime: RuntimeName): DynamicModule {
    const config = loadRuntimeConfig(runtime, process.env);
    return {
      module: RuntimeConfigModule,
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validate: (env: Record<string, string | undefined>) =>
            loadRuntimeConfig(runtime, env),
        }),
      ],
      providers: [{ provide: RUNTIME_CONFIG, useValue: config }],
      exports: [RUNTIME_CONFIG],
    };
  }
}
