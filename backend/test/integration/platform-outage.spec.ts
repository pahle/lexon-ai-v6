import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IdentityErrorResponseSchema } from '@lexon/contracts';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createSelectionInspector } from '../../src/infrastructure/db/testing/selection-fixture.js';
import { createPlatformReadInspector } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { IdentityAccessModule } from '../../src/modules/identity-access/identity-access.module.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/organization-auth.port.js';
import { PlatformConsoleModule } from '../../src/modules/platform-console/index.js';
import { SafeErrorFilter } from '../../src/modules/platform/error.filter.js';
import { securityHarness } from '../setup/security-harness.js';
import { unlimitedLimiter } from '../setup/unlimited-limiter.js';

// Item 14 (F4.3 ledger Minor, platform 503 fail-closed): an auth-database
// outage on a platform route must be 503 AUTH_UNAVAILABLE — never a 2xx and
// never a partial page body.
test('an auth-database outage on GET /api/platform/accounts fails closed with 503 AUTH_UNAVAILABLE', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const sessionInspect = createSelectionInspector(services);
  const readInspect = createPlatformReadInspector(services);
  const port = new OrganizationAuthPort(proof.integration);
  @Module({})
  class Framework {}
  @Module({
    imports: [
      IdentityAccessModule.forPolicy({
        limiter: unlimitedLimiter,
        correlationSecret: 'test-correlation-secret-0123456789',
        integration: proof.integration,
        frameworkModule: { module: Framework },
      }),
      PlatformConsoleModule.forPort(port, {
        limiter: unlimitedLimiter,
        reauthSeconds: 300,
      }),
    ],
  })
  class Root {}
  const app = await NestFactory.create(Root, { logger: false });
  app.useGlobalFilters(new SafeErrorFilter({ warn: vi.fn() } as never));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  try {
    const email = `${randomUUID()}@example.test`;
    const password = 'Platform-outage-42!';
    const user = await proof.signIn({
      body: { name: 'Outage admin', email, password },
    });
    await proof.inspect.makeAdmin(user.userId);
    const full = await securityHarness(proof).enroll(email, password);
    const origin = await app.getUrl();
    const accounts = () =>
      fetch(`${origin}/api/platform/accounts`, { headers: full.headers });

    const healthy = await accounts();
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      items: expect.any(Array),
      total: expect.any(Number),
    });

    // Phase 1 — the session read itself is denied (tenant-guard.spec.ts:231
    // pattern): identity resolution fails before the controller runs.
    await sessionInspect.denySessionReads();
    const denied = await accounts();
    expect(denied.status).toBe(503);
    const deniedBody = IdentityErrorResponseSchema.parse(await denied.json());
    expect(deniedBody.error.code).toBe('AUTH_UNAVAILABLE');
    expect(deniedBody).not.toHaveProperty('items');
    expect(deniedBody).not.toHaveProperty('total');
    await sessionInspect.permitSessionReads();

    // Phase 2 — the platform read function fails with an outage shape
    // (SQLSTATE 57P01): the guard passes, then the read itself fails.
    await readInspect.failAccountsRead();
    const outage = await accounts();
    expect(outage.status).toBe(503);
    const outageBody = IdentityErrorResponseSchema.parse(await outage.json());
    expect(outageBody.error.code).toBe('AUTH_UNAVAILABLE');
    expect(outageBody).not.toHaveProperty('items');
    expect(outageBody).not.toHaveProperty('total');
  } finally {
    await app.close();
    await readInspect.close();
    await sessionInspect.close();
    await proof.close();
  }
});
