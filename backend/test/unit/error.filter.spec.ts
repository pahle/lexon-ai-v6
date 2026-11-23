import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, test, vi } from 'vitest';
import { SafeErrorFilter } from '../../src/modules/platform/error.filter.js';
import { IdentityError } from '../../src/modules/identity-access/identity-error.js';

function run(error: unknown, path?: string) {
  const json = vi.fn();
  const status = vi.fn((code: number) => ({ json, code }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        id: 'req-1',
        ...(path !== undefined ? { originalUrl: path } : {}),
      }),
      getResponse: () => ({ status, getHeader: () => undefined }),
    }),
  };
  new SafeErrorFilter({ warn: vi.fn() } as never).catch(error, host as never);
  const sent = status.mock.calls[0]![0];
  return {
    status: sent,
    body: json.mock.calls[0]![0] as { error: { code: string } },
  };
}
function pg(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('raw SELECT failure organization_slug'), {
    code,
    constraint: 'organization_slug_unique',
    ...extra,
  });
}
// ioredis surfaces a plain shaped object, not an Error subclass.
const redisRefused = () => ({ code: 'ECONNREFUSED', syscall: 'connect' });
const pgCrash = () => pg('57P01');
const ID = '00000000-0000-4000-8000-000000000001';
const cases: Array<[string, unknown, number, string, string?]> = [
  [
    'HttpException(418)',
    new HttpException('teapot stack', 418),
    418,
    'REQUEST_REJECTED',
  ],
  [
    'body-parser entity.parse.failed',
    Object.assign(new Error('Unexpected token SELECT'), {
      status: 400,
      statusCode: 400,
      type: 'entity.parse.failed',
    }),
    400,
    'INVALID_JSON',
  ],
  [
    'Better Auth APIError',
    Object.assign(new Error('constraint stack SELECT'), {
      name: 'APIError',
      status: 'FORBIDDEN',
      statusCode: 403,
      body: { code: 'FORBIDDEN', message: 'constraint stack SELECT' },
    }),
    403,
    'REQUEST_REJECTED',
  ],
  [
    'Nest-wrapped body-parser SyntaxError',
    new BadRequestException(
      "Expected property name or '}' in JSON at position 1",
    ),
    400,
    'INVALID_JSON',
  ],
  [
    'other 400 is not INVALID_JSON',
    new BadRequestException('Invalid stream recovery mode'),
    400,
    'VALIDATION_ERROR',
  ],
  ['pg 23505', pg('23505'), 409, 'CONFLICT'],
  [
    'pg 23505 on an unlisted constraint stays a server error',
    pg('23505', { constraint: 'task9_unexpected_outbox_unique' }),
    500,
    'INTERNAL_ERROR',
  ],
  ['pg 23P01', pg('23P01'), 409, 'CONFLICT'],
  [
    'AI global capacity trigger is 503 AI_CAPACITY_EXCEEDED, not 500',
    pg('23514', { constraint: 'ai_global_capacity' }),
    503,
    'AI_CAPACITY_EXCEEDED',
  ],
  [
    'AI organization capacity trigger through a wrapped cause',
    Object.assign(new Error('Failed query'), {
      cause: pg('23514', { constraint: 'ai_org_capacity' }),
    }),
    503,
    'AI_CAPACITY_EXCEEDED',
  ],
  [
    'other check violations stay a server error',
    pg('23514', { constraint: 'some_other_check' }),
    500,
    'INTERNAL_ERROR',
  ],
  // P2: an outage on a non-identity route is SERVICE_UNAVAILABLE; a missing
  // path is never an identity route.
  [
    'pool timeout',
    new Error('timeout exceeded when trying to connect'),
    503,
    'SERVICE_UNAVAILABLE',
  ],
  [
    'ECONNREFUSED',
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    }),
    503,
    'SERVICE_UNAVAILABLE',
  ],
  ['pg 57P01', pg('57P01'), 503, 'SERVICE_UNAVAILABLE'],
  ['pg 57P03', pg('57P03'), 503, 'SERVICE_UNAVAILABLE'],
  ['unknown error', new Error('boom SELECT stack'), 500, 'INTERNAL_ERROR'],
];
describe('SafeErrorFilter', () => {
  test.each(cases)('%s', (_name, error, status, code, path) => {
    const result = run(error, path);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
    expect(JSON.stringify(result.body)).not.toMatch(
      /stack|SELECT|constraint|organization_slug/,
    );
  });
});

describe('SafeErrorFilter outage routing (P2)', () => {
  const serviceRoutes = [
    `/api/chats/${ID}`,
    `/api/runs/${ID}/events`,
    '/api/diagnostics',
    '/api/health',
  ];
  const identityRoutes = [
    '/api/identity/session',
    '/api/organizations',
    `/api/invitations/${ID}`,
    '/api/platform/accounts',
    '/api/auth/sign-in/email',
  ];
  test.each(
    serviceRoutes.flatMap((path) =>
      (['ioredis', '57P01'] as const).map((shape) => [shape, path] as const),
    ),
  )('%s outage on %s is 503 SERVICE_UNAVAILABLE', (shape, path) => {
    const result = run(shape === 'ioredis' ? redisRefused() : pgCrash(), path);
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
  test.each(
    identityRoutes.flatMap((path) =>
      (['ioredis', '57P01'] as const).map((shape) => [shape, path] as const),
    ),
  )('%s outage on %s is 503 AUTH_UNAVAILABLE', (shape, path) => {
    const result = run(shape === 'ioredis' ? redisRefused() : pgCrash(), path);
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('AUTH_UNAVAILABLE');
  });
  test.each(['/api/identityx', '/api/platformer'])(
    'prefix boundary %s is a service route',
    (path) => {
      const result = run(redisRefused(), path);
      expect(result.status).toBe(503);
      expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
    },
  );
  test('an IdentityError passes through unchanged on a service route', () => {
    const result = run(
      new IdentityError('AUTH_UNAVAILABLE', 503),
      `/api/chats/${ID}`,
    );
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('AUTH_UNAVAILABLE');
  });
});
