import { Module, type DynamicModule } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import type { RuntimeName } from '../../config/runtime-config.js';
import { createLoggingOptions } from './logging.js';

@Module({})
export class TelemetryModule {
  static forRuntime(runtime: RuntimeName): DynamicModule {
    return {
      module: TelemetryModule,
      imports: [
        TerminusModule,
        LoggerModule.forRoot(createLoggingOptions(runtime)),
      ],
      exports: [LoggerModule, TerminusModule],
    };
  }
}
