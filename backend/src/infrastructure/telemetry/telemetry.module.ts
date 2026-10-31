import { Module, type DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { RuntimeName } from '../../config/runtime-config.js';
import { createLoggingOptions } from './logging.js';

@Module({})
export class TelemetryModule {
  static forRuntime(runtime: RuntimeName): DynamicModule {
    return {
      module: TelemetryModule,
      imports: [LoggerModule.forRoot(createLoggingOptions(runtime))],
      exports: [LoggerModule],
    };
  }
}
