import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  ChatApiError,
  ErrorResponseSchema,
  IdentityErrorResponseSchema,
} from '@lexon/contracts';
import {
  SafeErrorFilter,
  ValidationFailure,
} from '../../src/modules/platform/error.filter.js';
import { IdentityError } from '../../src/modules/identity-access/identity-error.js';
import {
  sanitizeAuthResponse,
  sanitizeVerifiedSigninFailure,
} from '../../src/modules/identity-access/auth-output.js';

const IDENTITY_PATH = '/api/identity/session';
const SERVICE_PATH = '/api/chats/00000000-0000-4000-8000-000000000001';

function run(error: unknown, path: string) {
  const json = vi.fn();
  const status = vi.fn((code: number) => ({ json, code }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-1', originalUrl: path }),
      getResponse: () => ({ status, getHeader: () => undefined }),
    }),
  };
  new SafeErrorFilter({ warn: vi.fn() } as never).catch(error, host as never);
  return {
    status: status.mock.calls[0]![0],
    body: json.mock.calls[0]![0] as unknown,
  };
}
function pg(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('pg failure'), { code, ...extra });
}
const zodError = () =>
  z.strictObject({ name: z.string() }).safeParse({ name: 1 }).error!;
const invalidJson = () =>
  Object.assign(new Error('Unexpected token'), {
    status: 400,
    statusCode: 400,
    type: 'entity.parse.failed',
  });
const outage = () => ({ code: 'ECONNREFUSED', syscall: 'connect' });
const clientError = (statusCode: number) =>
  Object.assign(new Error('rejected'), { statusCode });

// Every error class the filter maps, with the family it can surface on and the
// body it must produce. Identity rows parse with the identity client schema;
// service rows parse with the chat client schema. AI_CAPACITY_EXCEEDED and
// ChatApiError are service-family branches: the run-capacity triggers and the
// chat services only exist under /api/chats and /api/runs.
const filterTable: Array<{
  name: string;
  error: () => unknown;
  families: Array<'identity' | 'service'>;
  code: string;
  status: number;
}> = [
  {
    name: 'default internal error',
    error: () => new Error('boom'),
    families: ['identity', 'service'],
    code: 'INTERNAL_ERROR',
    status: 500,
  },
  {
    name: '5xx HttpException keeps INTERNAL_ERROR',
    error: () => new HttpException('bad gateway', 502),
    families: ['identity', 'service'],
    code: 'INTERNAL_ERROR',
    status: 502,
  },
  {
    name: 'ZodError',
    error: zodError,
    families: ['identity', 'service'],
    code: 'VALIDATION_ERROR',
    status: 400,
  },
  {
    name: 'ValidationFailure',
    error: () => new ValidationFailure([{ path: 'name', message: 'Invalid' }]),
    families: ['identity', 'service'],
    code: 'VALIDATION_ERROR',
    status: 400,
  },
  {
    name: 'malformed JSON body',
    error: invalidJson,
    families: ['identity', 'service'],
    code: 'INVALID_JSON',
    status: 400,
  },
  {
    name: 'outage (ioredis ECONNREFUSED)',
    error: outage,
    families: ['identity', 'service'],
    code: 'UNAVAILABLE',
    status: 503,
  },
  {
    name: 'unique conflict on a listed constraint',
    error: () => pg('23505', { constraint: 'organization_slug_unique' }),
    families: ['identity', 'service'],
    code: 'CONFLICT',
    status: 409,
  },
  {
    name: '23P01 conflict',
    error: () => pg('23P01'),
    families: ['identity', 'service'],
    code: 'CONFLICT',
    status: 409,
  },
  {
    name: 'run capacity trigger',
    error: () => pg('23514', { constraint: 'ai_global_capacity' }),
    families: ['service'],
    code: 'AI_CAPACITY_EXCEEDED',
    status: 503,
  },
  {
    name: 'ChatApiError',
    error: () => new ChatApiError('CHAT_NOT_FOUND'),
    families: ['service'],
    code: 'CHAT_NOT_FOUND',
    status: 404,
  },
  {
    name: 'client 404',
    error: () => clientError(404),
    families: ['identity', 'service'],
    code: 'NOT_FOUND',
    status: 404,
  },
  {
    name: 'client 400 stays VALIDATION_ERROR',
    error: () => new BadRequestException('Invalid value'),
    families: ['identity', 'service'],
    code: 'VALIDATION_ERROR',
    status: 400,
  },
  {
    name: 'client 403 is REQUEST_REJECTED',
    error: () => clientError(403),
    families: ['identity', 'service'],
    code: 'REQUEST_REJECTED',
    status: 403,
  },
];

describe('identity error contract', () => {
  for (const row of filterTable)
    for (const family of row.families) {
      const path = family === 'identity' ? IDENTITY_PATH : SERVICE_PATH;
      const schema =
        family === 'identity'
          ? IdentityErrorResponseSchema
          : ErrorResponseSchema;
      test(`filter: ${row.name} on a ${family} route produces a contract body`, () => {
        const result = run(row.error(), path);
        expect(result.status).toBe(row.status);
        const parsed = schema.safeParse(result.body);
        if (!parsed.success) expect(parsed.error).toBeUndefined();
        const expected =
          row.code === 'UNAVAILABLE'
            ? family === 'identity'
              ? 'AUTH_UNAVAILABLE'
              : 'SERVICE_UNAVAILABLE'
            : row.code;
        expect(parsed.success && parsed.data.error.code).toBe(expected);
      });
    }

  // Every IdentityError code the server throws on identity routes must be
  // declared in the client's identity schema, on every family it can reach.
  const identityErrorCodes = [
    'AUTH_REQUIRED',
    'AUTH_EMAIL_VERIFICATION_REQUIRED',
    'AUTH_2FA_REQUIRED',
    'AUTH_REAUTH_REQUIRED',
    'AUTH_RATE_LIMITED',
    'AUTH_UNAVAILABLE',
    'ORG_MEMBERSHIP_REQUIRED',
    'ORG_LAST_OWNER',
    'ORG_FORBIDDEN',
    'ORG_SLUG_TAKEN',
    'ORG_STATE_CHANGED',
    'NOT_FOUND',
    'PLATFORM_SELF_ACTION',
    'PLATFORM_LAST_ADMINISTRATOR',
    'PLATFORM_ALREADY_VERIFIED',
    'PLATFORM_INVITATION_CONFLICT',
    'STREAM_UNAVAILABLE',
    'VALIDATION_ERROR',
  ] as const;
  test.each(identityErrorCodes)(
    'IdentityError(%s) parses on the identity contract',
    (code) => {
      const error = new IdentityError(code, 409);
      const result = run(error, IDENTITY_PATH);
      const parsed = IdentityErrorResponseSchema.safeParse(result.body);
      if (!parsed.success) expect(parsed.error).toBeUndefined();
      expect(parsed.success && parsed.data.error.code).toBe(code);
    },
  );
  test('an IdentityError passes through unchanged on a service route', () => {
    const result = run(
      new IdentityError('AUTH_UNAVAILABLE', 503),
      SERVICE_PATH,
    );
    const parsed = ErrorResponseSchema.parse(result.body);
    expect(parsed.error.code).toBe('AUTH_UNAVAILABLE');
  });

  // The /api/auth bridge is an identity-family surface: every sanitized body
  // must parse against the identity client schema.
  const bridgeTable: Array<{
    name: string;
    produce: () => Promise<Response | null>;
    code: string;
    status: number;
  }> = [
    {
      name: 'native 500 is AUTH_UNAVAILABLE',
      produce: () =>
        sanitizeAuthResponse(
          Response.json({ message: 'private' }, { status: 500 }),
          'cookie',
        ),
      code: 'AUTH_UNAVAILABLE',
      status: 503,
    },
    {
      name: 'native 401 is AUTH_REQUIRED',
      produce: () =>
        sanitizeAuthResponse(
          Response.json({ message: 'private' }, { status: 401 }),
          'cookie',
        ),
      code: 'AUTH_REQUIRED',
      status: 401,
    },
    {
      name: 'native 400 is VALIDATION_ERROR',
      produce: () =>
        sanitizeAuthResponse(
          Response.json({ message: 'private' }, { status: 400 }),
          'cookie',
        ),
      code: 'VALIDATION_ERROR',
      status: 400,
    },
    {
      name: 'verified sign-in failure is AUTH_EMAIL_VERIFICATION_REQUIRED',
      produce: () =>
        sanitizeVerifiedSigninFailure(
          Response.json(
            { code: 'EMAIL_NOT_VERIFIED', message: 'private' },
            { status: 403 },
          ),
        ),
      code: 'AUTH_EMAIL_VERIFICATION_REQUIRED',
      status: 403,
    },
  ];
  for (const row of bridgeTable)
    test(`auth bridge: ${row.name}`, async () => {
      const response = await row.produce();
      expect(response).not.toBeNull();
      expect(response!.status).toBe(row.status);
      const parsed = IdentityErrorResponseSchema.safeParse(
        await response!.json(),
      );
      if (!parsed.success) expect(parsed.error).toBeUndefined();
      expect(parsed.success && parsed.data.error.code).toBe(row.code);
    });
});
