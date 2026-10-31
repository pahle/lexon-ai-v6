import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  loadRuntimeConfig,
  type RuntimeName,
  type RuntimeConfig,
} from './runtime-config.js';

export const RUNTIME_CONFIG = Symbol('RuntimeConfig');

@Module({})
export class RuntimeConfigModule {
  static forConfig(config: RuntimeConfig): DynamicModule {
    return {
      module: RuntimeConfigModule,
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, validate: () => config }),
      ],
      providers: [{ provide: RUNTIME_CONFIG, useValue: config }],
      exports: [RUNTIME_CONFIG],
    };
  }
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
