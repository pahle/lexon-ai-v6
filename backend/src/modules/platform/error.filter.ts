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
import { ChatApiError, SafeErrorMessages } from '@lexon/contracts';

// A 23505 is a client conflict only for constraints we expect callers to hit.
// Any other unique violation stays a 500: chat-branches.spec.ts pins that an
// unexpected outbox uniqueness failure is a server error.
const CONFLICT_CONSTRAINTS = ['organization_slug_unique'];
const CONFLICT_SQLSTATES = ['23P01'];
// The run-capacity triggers (ops.ai_check_run_capacity) raise a 23514 when the
// global or per-organization active-run cap is full: a busy service, not a bug.
const CAPACITY_CONSTRAINTS = ['ai_global_capacity', 'ai_org_capacity'];
const UNAVAILABLE_SQLSTATES = ['57P01', '57P03'];
const UNAVAILABLE_MESSAGES = [
  'timeout exceeded when trying to connect',
  'ECONNREFUSED',
];
function chain(error: unknown): object[] {
  const out: object[] = [];
  let current = error;
  while (
    typeof current === 'object' &&
    current !== null &&
    out.length < 6 &&
    !out.includes(current)
  ) {
    out.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return out;
}
// R3b names http-errors `entity.parse.failed`; the installed Nest 12.3.2
// adapter instead turns body-parser's SyntaxError into a BadRequestException
// that carries the V8 "... JSON ..." message (express-adapter.js mapException).
// Both count as INVALID_JSON, and nothing else does.
function invalidJson(error: unknown): boolean {
  if (chain(error).some((e) => hasType(e, 'entity.parse.failed'))) return true;
  if (!(error instanceof HttpException) || error.getStatus() !== 400)
    return false;
  const body = error.getResponse();
  const message =
    typeof body === 'object' && body !== null
      ? (body as { message?: unknown }).message
      : body;
  return typeof message === 'string' && /\bJSON\b/.test(message);
}
function hasType(error: object, type: string): boolean {
  return (error as { type?: unknown }).type === type;
}
function uniqueConflict(error: unknown): boolean {
  return chain(error).some((e) => {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    return (
      code === '23505' &&
      typeof constraint === 'string' &&
      CONFLICT_CONSTRAINTS.includes(constraint)
    );
  });
}
function capacityExceeded(error: unknown): boolean {
  return chain(error).some((e) => {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    return (
      code === '23514' &&
      typeof constraint === 'string' &&
      CAPACITY_CONSTRAINTS.includes(constraint)
    );
  });
}
function databaseCode(error: unknown, codes: string[]): boolean {
  return chain(error).some((e) =>
    codes.includes(String((e as { code?: unknown }).code)),
  );
}
// R2b: pool waiters time out with a plain Error; R3a: everything else is 500.
function unavailable(error: unknown): boolean {
  return (
    databaseCode(error, [...UNAVAILABLE_SQLSTATES, 'ECONNREFUSED']) ||
    chain(error).some((e) =>
      UNAVAILABLE_MESSAGES.some((m) =>
        String((e as { message?: unknown }).message).includes(m),
      ),
    )
  );
}
function clientStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const raw = error as { status?: unknown; statusCode?: unknown };
  const value = error instanceof HttpException ? error.getStatus() : undefined;
  for (const candidate of [value, raw.statusCode, raw.status])
    if (typeof candidate === 'number' && candidate >= 400 && candidate < 500)
      return candidate;
  return undefined;
}

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
      detail = {
        code: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      };
    } else if (error instanceof ChatApiError) {
      status = error.status;
      detail = {
        code: error.code,
        message: SafeErrorMessages[error.code],
      };
    } else if (error instanceof z.ZodError) {
      status = 400;
      detail = {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        issues: error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: 'Invalid value',
        })),
      };
    } else if (error instanceof ValidationFailure) {
      status = 400;
      detail = {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        issues: error.issues,
      };
    } else if (invalidJson(error)) {
      status = 400;
      detail = { code: 'INVALID_JSON', message: 'Invalid JSON' };
    } else if (capacityExceeded(error)) {
      status = 503;
      detail = {
        code: 'AI_CAPACITY_EXCEEDED',
        message: SafeErrorMessages.AI_CAPACITY_EXCEEDED,
      };
    } else if (unavailable(error)) {
      status = 503;
      detail = {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      };
    } else if (
      uniqueConflict(error) ||
      databaseCode(error, CONFLICT_SQLSTATES)
    ) {
      status = 409;
      detail = { code: 'CONFLICT', message: 'Conflict' };
    } else {
      const kept = clientStatus(error);
      if (kept) {
        status = kept;
        detail =
          kept === 404
            ? { code: 'NOT_FOUND', message: 'Not found' }
            : kept === 400
              ? { code: 'VALIDATION_ERROR', message: 'Invalid request' }
              : { code: 'REQUEST_REJECTED', message: 'Request rejected' };
      } else if (error instanceof HttpException) {
        status = error.getStatus();
      }
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
