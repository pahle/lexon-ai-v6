import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Catch,
  Module,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import {
  IdentityAccessModule,
  IdentityError,
  OrganizationAuthPort,
} from '../../src/modules/identity-access/index.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { OrganizationsModule } from '../../src/modules/organizations/index.js';
import { securityHarness } from '../setup/security-harness.js';
test('every platform route denies ordinary and incomplete-MFA identities and permits full platform provisioning', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const config = {
    pagination: { defaultLimit: 20, maxLimit: 100 },
    invitationSeconds: 1209600,
  };
  @Module({})
  class Framework {}
  @Module({
    imports: [
      IdentityAccessModule.forPolicy({
        integration: proof.integration,
        frameworkModule: { module: Framework },
        availability: { assertAvailable: async () => {} },
      }),
      OrganizationsModule.forPolicy({
        port: new OrganizationAuthPort(proof.integration),
        selection: new IdentitySessionService(proof.integration),
        ...config,
      }),
    ],
  })
  class Root {}
  @Catch()
  class Errors implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost) {
      host
        .switchToHttp()
        .getResponse<Response>()
        .status(error instanceof IdentityError ? error.status : 500)
        .json({
          code: error instanceof IdentityError ? error.code : 'INTERNAL_ERROR',
        });
    }
  }
  const app = await NestFactory.create(Root, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new Errors());
  await app.listen(0, '127.0.0.1');
  try {
    const email = `${randomUUID()}@example.test`;
    const password = 'Platform-http-42!';
    const user = await proof.signIn({
      body: { name: 'HTTP platform', email, password },
    });
    const origin = await app.getUrl();
    const id = randomUUID();
    const routes: ReadonlyArray<readonly [string, string]> = [
      ['GET', '/platform/provisioning'],
      ['POST', '/platform/provisioning'],
      ['GET', `/platform/provisioning/${id}`],
      ['DELETE', `/platform/provisioning/${id}`],
      ['POST', `/platform/provisioning/${id}/resend`],
      ['PATCH', `/platform/provisioning/${id}/owner-email`],
      ['PATCH', `/platform/users/${id}/disabled`],
    ];
    for (const admin of [false, true]) {
      if (admin) await proof.inspect.makeAdmin(user.userId);
      for (const [method, path] of routes)
        expect(
          (
            await fetch(`${origin}/api${path}`, {
              method,
              headers: user.cookieHeaders,
            })
          ).status,
        ).toBe(403);
    }
    const full = await securityHarness(proof).enroll(email, password);
    const headers = new Headers(full.headers);
    headers.set('content-type', 'application/json');
    const created = await fetch(`${origin}/api/platform/provisioning`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'HTTP provisioned',
        slug: `http-${id}`,
        ownerEmail: `${randomUUID()}@example.test`,
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ state: 'provisioning' });
  } finally {
    await app.close();
    await proof.close();
  }
});
