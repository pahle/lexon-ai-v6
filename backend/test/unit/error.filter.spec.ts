import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, test, vi } from 'vitest';
import { SafeErrorFilter } from '../../src/modules/platform/error.filter.js';

function run(error: unknown) {
  const json = vi.fn();
  const status = vi.fn((code: number) => ({ json, code }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-1' }),
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
const cases: Array<[string, unknown, number, string]> = [
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
  ['pg 23P01', pg('23P01'), 409, 'CONFLICT'],
  [
    'pool timeout',
    new Error('timeout exceeded when trying to connect'),
    503,
    'AUTH_UNAVAILABLE',
  ],
  [
    'ECONNREFUSED',
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    }),
    503,
    'AUTH_UNAVAILABLE',
  ],
  ['pg 57P01', pg('57P01'), 503, 'AUTH_UNAVAILABLE'],
  ['pg 57P03', pg('57P03'), 503, 'AUTH_UNAVAILABLE'],
  ['unknown error', new Error('boom SELECT stack'), 500, 'INTERNAL_ERROR'],
];
describe('SafeErrorFilter', () => {
  test.each(cases)('%s', (_name, error, status, code) => {
    const result = run(error);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
    expect(JSON.stringify(result.body)).not.toMatch(
      /stack|SELECT|constraint|organization_slug/,
    );
  });
});
