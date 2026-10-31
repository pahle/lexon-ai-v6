import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';
import type { RuntimeName } from '../../config/runtime-config.js';

const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
const events = new Set([
  'job_processed',
  'http_request_failed',
  'boot_failed',
  'health_write_failed',
  'runtime_started',
  'runtime_stopped',
  'dispatcher_active',
  'dispatcher_standby',
  'dispatcher_retry',
]);

export function createLoggingOptions(
  runtime: RuntimeName,
): Params & { pinoHttp: Options } {
  return {
    pinoHttp: {
      base: { runtime },
      redact: {
        paths: [
          'authorization',
          'cookie',
          'password',
          'token',
          'secret',
          'apiKey',
          'prompt',
          'message',
          'body',
          'documentText',
          'payload',
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.x-lexon-client-address',
          'res.headers.set-cookie',
          'res.headers.set-auth-token',
          'set-auth-token',
          'totp',
          'recoveryCode',
          'backupCodes',
        ],
        censor: '[REDACTED]',
      },
      genReqId: assignRequestId,
      customAttributeKeys: { reqId: 'requestId' },
      wrapSerializers: false,
      serializers: {
        req: (req: { id?: unknown; method?: unknown }) => ({
          id: req.id,
          method: req.method,
        }),
        res: (res: { statusCode?: unknown }) => ({
          statusCode: res.statusCode,
        }),
        err: () => ({ type: 'Error' }),
      },
      formatters: {
        bindings(object) {
          const safe: Record<string, unknown> = {};
          if (object.runtime === runtime) safe.runtime = runtime;
          for (const name of [
            'requestId',
            'reqId',
            'jobId',
            'orgId',
            'userId',
          ]) {
            const value = object[name];
            if (typeof value === 'string' && identifier.test(value))
              safe[name === 'reqId' ? 'requestId' : name] = value;
          }
          return safe;
        },
        log(object) {
          const safe: Record<string, unknown> = {};
          for (const name of ['req', 'res', 'err'])
            if (object[name]) safe[name] = object[name];
          for (const name of ['requestId', 'jobId', 'orgId', 'userId']) {
            const value = object[name];
            if (typeof value === 'string' && identifier.test(value))
              safe[name] = value;
          }
          if (typeof object.event === 'string' && events.has(object.event))
            safe.event = object.event;
          if (
            typeof object.responseTime === 'number' &&
            Number.isFinite(object.responseTime)
          )
            safe.responseTime = object.responseTime;
          if (Array.isArray(object.fields))
            safe.fields = object.fields.filter(
              (field: unknown) =>
                typeof field === 'string' && /^[A-Z][A-Z0-9_]*$/.test(field),
            );
          return safe;
        },
      },
      hooks: {
        streamWrite(line) {
          // Child bindings bypass the parent's log formatter in Pino 10.
          // Filter the complete serialized record as the final boundary.
          const record = JSON.parse(line) as Record<string, unknown>;
          const safe: Record<string, unknown> = {
            level: record.level,
            time: record.time,
            runtime,
            msg: 'Runtime event',
          };
          if (
            record.req &&
            typeof record.req === 'object' &&
            'id' in record.req &&
            typeof record.req.id === 'string' &&
            identifier.test(record.req.id)
          )
            safe.requestId = record.req.id;
          for (const name of ['requestId', 'jobId', 'orgId', 'userId']) {
            const value = record[name];
            if (typeof value === 'string' && identifier.test(value))
              safe[name] = value;
          }
          if (typeof record.event === 'string' && events.has(record.event))
            safe.event = record.event;
          if (typeof record.responseTime === 'number')
            safe.responseTime = record.responseTime;
          if (Array.isArray(record.fields))
            safe.fields = record.fields.filter(
              (value: unknown) =>
                typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value),
            );
          if (record.err) safe.err = { type: 'Error' };
          if (
            record.res &&
            typeof record.res === 'object' &&
            'statusCode' in record.res
          )
            safe.statusCode = record.res.statusCode;
          return `${JSON.stringify(safe)}\n`;
        },
        logMethod(args, method) {
          // Free-form strings and exception messages can contain client data.
          // Structured allowlisted metadata supplies operational context.
          const object =
            typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
          method.call(this, object, 'Runtime event');
        },
      },
    },
  };
}

export function assignRequestId(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const supplied = req.headers['x-request-id'];
  const requestId =
    typeof supplied === 'string' && identifier.test(supplied)
      ? supplied
      : randomUUID();
  res.setHeader('x-request-id', requestId);
  return requestId;
}
