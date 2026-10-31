import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { RuntimeConfig, RuntimeName } from '../config/runtime-config.js';
export async function createRuntimeContext(
  runtime: Exclude<RuntimeName, 'api'>,
  config: RuntimeConfig,
): Promise<INestApplicationContext> {
  if (config.runtime !== runtime)
    throw new Error('Runtime configuration mismatch');
  let root;
  switch (config.runtime) {
    case 'ai-worker':
      root = (
        await import('../entrypoints/ai-worker/root.module.js')
      ).AiWorkerRootModule.forConfig(config);
      break;
    case 'document-worker':
      root = (
        await import('../entrypoints/document-worker/root.module.js')
      ).DocumentWorkerRootModule.forConfig(config);
      break;
    case 'dispatcher':
      root = (
        await import('../entrypoints/dispatcher/root.module.js')
      ).DispatcherRootModule.forConfig(config);
      break;
    default:
      throw new Error('Invalid standalone runtime');
  }
  const app = await NestFactory.createApplicationContext(root, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  return app;
}
