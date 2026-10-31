import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PlatformVersionService } from '../modules/platform/index.js';
import { EvaluationModule } from './evaluation.module.js';
export async function createEvaluationContext(): Promise<{
  version: string;
  close(): Promise<void>;
}> {
  const context = await NestFactory.createApplicationContext(EvaluationModule, {
    logger: false,
    abortOnError: false,
  });
  const version = context.get(PlatformVersionService).version;
  return { version, close: () => context.close() };
}
