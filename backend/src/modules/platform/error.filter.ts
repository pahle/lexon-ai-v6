import { IdentityError } from '../identity-access/index.js';
import { z } from 'zod';
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import type { Request, Response } from 'express';
import type { ErrorResponse } from '@lexon/contracts';

export class ValidationFailure extends HttpException {
  constructor(readonly issues: { path: string; message: string }[]) {
    super('Validation failed', 400);
  }
}
@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();
    let status = 500;
    let detail: ErrorResponse['error'] = {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
    if (error instanceof IdentityError) {
      status = error.status;
      detail = { code: error.code, message: error.message };
    } else if (error instanceof z.ZodError) {
      status = 400;
      detail = { code: 'VALIDATION_ERROR', message: 'Invalid request' };
    } else if (error instanceof ValidationFailure) {
      status = 400;
      detail = {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        issues: error.issues,
      };
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.parse.failed'
    ) {
      status = 400;
      detail = { code: 'INVALID_JSON', message: 'Invalid JSON' };
    } else if (error instanceof HttpException && error.getStatus() === 400) {
      status = 400;
      detail = { code: 'INVALID_JSON', message: 'Invalid JSON' };
    } else if (error instanceof HttpException && error.getStatus() === 404) {
      status = 404;
      detail = { code: 'NOT_FOUND', message: 'Not found' };
    }
    const id = response.getHeader('x-request-id') ?? request.id;
    this.logger.warn({
      event: 'http_request_failed',
      ...(typeof id === 'string' ? { requestId: id } : {}),
    });
    response.status(status).json({
      error: detail,
      ...(typeof id === 'string' ? { requestId: id } : {}),
    });
  }
}
