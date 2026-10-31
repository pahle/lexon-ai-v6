import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { assignRequestId } from '../infrastructure/telemetry/index.js';
import { Logger, PinoLogger } from 'nestjs-pino';
import type { ApiConfig } from '../config/runtime-config.js';
import { ApiRootModule } from '../entrypoints/api/root.module.js';
import {
  SafeErrorFilter,
  ValidationFailure,
} from '../modules/platform/error.filter.js';
export async function createApi(config: ApiConfig): Promise<INestApplication> {
  const app = await NestFactory.create(ApiRootModule.forConfig(config), {
    bufferLogs: true,
    abortOnError: false,
  });
  try {
    app.use(
      (req: Request & { id?: string }, res: Response, next: NextFunction) => {
        const id = assignRequestId(req, res);
        req.id = id;
        req.headers['x-request-id'] = id;
        next();
      },
    );
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new StandardSchemaValidationPipe({
        exceptionFactory: (issues) =>
          new ValidationFailure(
            issues.map((issue) => ({
              path: (issue.path ?? [])
                .map((part) => {
                  const key = typeof part === 'object' ? part.key : part;
                  return key === 'probeId' ? 'probeId' : '';
                })
                .filter(Boolean)
                .join('.'),
              message: 'Invalid value',
            })),
          ),
      }),
    );
    app.useGlobalFilters(new SafeErrorFilter(await app.resolve(PinoLogger)));
    await app.init();
    return app;
  } catch {
    await app.close();
    throw new Error('API startup failed');
  }
}
