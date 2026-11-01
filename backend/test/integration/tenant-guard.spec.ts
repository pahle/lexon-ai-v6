import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Controller,
  Get,
  Post,
  Module,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { TenantDatabase } from '../../src/infrastructure/db/index.js';
import {
  installTenantFixture,
  tenantFixture,
  observeContext,
} from '../../src/infrastructure/db/testing/tenant-fixture.js';
import { createAuthLimiter } from '../../src/infrastructure/queue/index.js';
import { IdentityAccessModule } from '../../src/modules/identity-access/identity-access.module.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { currentTenantContext } from '../../src/modules/identity-access/request-identity.js';
import {
  currentVerifiedIdentity,
  assertVerifiedIdentity,
  type VerifiedIdentity,
} from '../../src/modules/identity-access/identity.types.js';
import {
  PublicRoute,
  AccountRoute,
  PlatformRoute,
} from '../../src/modules/identity-access/route-access.js';
import { IdentityError } from '../../src/modules/identity-access/identity-error.js';
import { createSelectionInspector } from '../../src/infrastructure/db/testing/selection-fixture.js';
import { securityHarness } from '../setup/security-harness.js';

test('Nest guard binds only verified tenant IDs across async controller work and denies overrides', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  await installTenantFixture(services);
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 2,
    statementTimeoutMs: 5000,
  });
  const limiter = await createAuthLimiter({
    url: services.valkey.limiterUrl,
    prefix: `${services.queuePrefix}:guard:rl:auth:`,
  });
  let captured: VerifiedIdentity | undefined;
  @Controller('guard-probe')
  class Probe {
    @Get('live') @PublicRoute() live() {
      return { live: true };
    }
    @Get() async read() {
      await Promise.resolve();
      captured = currentVerifiedIdentity();
      return database.withTenant(currentTenantContext(), async (tx) => ({
        context: await observeContext(tx),
        rows: await tenantFixture(tx).read(),
      }));
    }
    @Post() post() {
      return currentTenantContext();
    }
    @Get('account') @AccountRoute() account() {
      return currentVerifiedIdentity().userId;
    }
    @Get('reauth-state')
    @AccountRoute({ allowIncompleteMfa: true })
    reauthState() {
      return currentVerifiedIdentity().userId;
    }
    @Get('platform') @PlatformRoute() platform() {
      return { platform: true };
    }
  }
  @Catch()
  class Errors implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost) {
      const response = host.switchToHttp().getResponse<Response>();
      response
        .status(error instanceof IdentityError ? error.status : 500)
        .json({
          code: error instanceof IdentityError ? error.code : 'INTERNAL_ERROR',
        });
    }
  }
  @Module({})
  class FrameworkModule {}
  @Module({
    imports: [
      IdentityAccessModule.forPolicy({
        integration: proof.integration,
        frameworkModule: { module: FrameworkModule },
      }),
    ],
    controllers: [Probe],
  })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalFilters(new Errors());
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  try {
    expect((await fetch(`${origin}/guard-probe`)).status).toBe(401);
    const email = `${randomUUID()}@example.test`;
    const password = 'Guard-password-42!';
    const user = await proof.signIn({
      body: { name: 'Guard user', email, password },
    });
    const personal = await proof.inspect.personalFor(user.userId);
    const rowId = randomUUID();
    await database.withTenant(
      { orgId: personal!.orgId, userId: user.userId },
      (tx) => tenantFixture(tx).insert(rowId, personal!.orgId, 'Owned row'),
    );
    const response = await fetch(`${origin}/guard-probe`, {
      headers: user.cookieHeaders,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      context: { orgId: personal!.orgId, userId: user.userId },
      rows: [{ id: rowId, value: 'Owned row' }],
    });
    expect(() => assertVerifiedIdentity(captured!)).toThrow();
    const summary = await fetch(`${origin}/identity`, {
      headers: user.cookieHeaders,
    });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({
      user: { id: user.userId },
      organization: { id: personal!.orgId },
    });
    for (const headers of [
      new Headers({
        ...Object.fromEntries(user.cookieHeaders),
        'x-org-id': randomUUID(),
      }),
      new Headers({
        ...Object.fromEntries(user.cookieHeaders),
        'x-user-id': randomUUID(),
      }),
    ])
      expect((await fetch(`${origin}/guard-probe`, { headers })).status).toBe(
        400,
      );
    expect(
      (
        await fetch(`${origin}/guard-probe?organizationId=${randomUUID()}`, {
          headers: user.cookieHeaders,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${origin}/guard-probe`, {
          method: 'POST',
          headers: new Headers({
            ...Object.fromEntries(user.cookieHeaders),
            'content-type': 'application/json',
          }),
          body: JSON.stringify({ orgId: randomUUID() }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${origin}/guard-probe/platform`, {
          headers: user.cookieHeaders,
        })
      ).status,
    ).toBe(403);
    await proof.inspect.makeAdmin(user.userId);
    expect(
      (await fetch(`${origin}/guard-probe`, { headers: user.cookieHeaders }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin}/guard-probe/platform`, {
          headers: user.cookieHeaders,
        })
      ).status,
    ).toBe(403);
    const full = await securityHarness(proof).enroll(email, password);
    expect(
      (await fetch(`${origin}/guard-probe`, { headers: user.cookieHeaders }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin}/guard-probe/account`, {
          headers: user.cookieHeaders,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin}/guard-probe/reauth-state`, {
          headers: user.cookieHeaders,
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${origin}/guard-probe/platform`, { headers: full.headers }))
        .status,
    ).toBe(200);
    await limiter.close();
    expect((await fetch(`${origin}/guard-probe/live`)).status).toBe(200);
    expect(
      (await fetch(`${origin}/guard-probe`, { headers: full.headers })).status,
    ).toBe(200);
  } finally {
    await app.close();
    await limiter.close();
    await database.close();
    await proof.close();
  }
});

test('failed authoritative session reads produce503 and cannot become logout or Personal fallback', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createSelectionInspector(services);
  try {
    const user = await proof.signIn({
      body: {
        name: 'Unavailable identity',
        email: `${randomUUID()}@example.test`,
        password: 'Unavailable-password-42!',
      },
    });
    const identities = new IdentitySessionService(proof.integration);
    await inspect.denySessionReads();
    await expect(
      identities.resolve(user.cookieHeaders, { kind: 'workspace' }),
    ).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', status: 503 });
  } finally {
    await inspect.close();
    await proof.close();
  }
});

test('request resolution rejects expired, disabled and unverified accounts without caching identity', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createSelectionInspector(services);
  try {
    const identities = new IdentitySessionService(proof.integration);
    for (const state of ['expired', 'disabled', 'unverified'] as const) {
      const user = await proof.signIn({
        body: {
          name: 'Rejected account',
          email: `${randomUUID()}@example.test`,
          password: 'Rejected-password-42!',
        },
      });
      const session = await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: user.cookieHeaders }),
      );
      await inspect.invalidate(user.userId, session!.session.id, state);
      const cached = new Headers(user.cookieHeaders);
      cached.set(
        'cookie',
        `${cached.get('cookie')}; better-auth.session_data=untrusted`,
      );
      await expect(
        identities.resolve(cached, { kind: 'workspace' }),
      ).rejects.toMatchObject({
        code:
          state === 'unverified'
            ? 'AUTH_EMAIL_VERIFICATION_REQUIRED'
            : 'AUTH_REQUIRED',
      });
    }
  } finally {
    await inspect.close();
    await proof.close();
  }
});
