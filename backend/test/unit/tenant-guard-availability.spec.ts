import { expect, test } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { TenantGuard } from '../../src/modules/identity-access/tenant.guard.js';

// LEX-ARC-001 §5.4: the limiter is fail-closed only for authentication
// endpoints. Ordinary workspace routes must keep working when the limiter
// store is unavailable, and must not write to it on every request.
test('workspace routes do not depend on the auth limiter store', async () => {
  const resolved = {
    identity: { userId: '00000000-0000-4000-8000-000000000001' },
    summary: {},
  };
  const identities = { resolve: async () => resolved };
  let prepared = false;
  const requests = {
    prepare: () => {
      prepared = true;
    },
  };
  const request = {
    headers: { cookie: 'session=1' },
    rawHeaders: ['cookie', 'session=1'],
    query: {},
    body: {},
    method: 'GET',
  };
  const response = { getHeader: () => undefined, setHeader: () => undefined };
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  const guard = new TenantGuard(
    identities as never,
    requests as never,
    new Reflector(),
  );

  await expect(guard.canActivate(context)).resolves.toBe(true);
  expect(prepared).toBe(true);
});
