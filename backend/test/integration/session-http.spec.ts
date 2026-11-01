import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  Module,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { NestFactory } from '@nestjs/core';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import {
  IdentityAccessModule,
  IdentityError,
} from '../../src/modules/identity-access/index.js';
import { securityHarness, responseCookies } from '../setup/security-harness.js';
test('session HTTP returns token only once with no-store and lists safe revocable session IDs', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const audits = createAuditInspector(services);
  @Module({})
  class Framework {}
  @Module({
    imports: [
      IdentityAccessModule.forPolicy({
        integration: proof.integration,
        frameworkModule: { module: Framework },
      }),
    ],
  })
  class Root {}
  const app = await NestFactory.create(Root, { logger: false });
  app.setGlobalPrefix('api');
  @Catch()
  class Errors implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost) {
      host
        .switchToHttp()
        .getResponse<ExpressResponse>()
        .status(error instanceof IdentityError ? error.status : 500)
        .json({
          code: error instanceof IdentityError ? error.code : 'INTERNAL_ERROR',
        });
    }
  }
  app.useGlobalFilters(new Errors());
  await app.listen(0, '127.0.0.1');
  try {
    const email = `${randomUUID()}@example.test`;
    const password = 'HTTP-session-42!';
    await proof.signIn({ body: { name: 'HTTP session', email, password } });
    const harness = securityHarness(proof);
    const headers = responseCookies(
      await harness.run('/sign-in/email', { email, password }, new Headers()),
    );
    const origin = await app.getUrl();
    const issued = await fetch(`${origin}/api/identity/bearer-sessions`, {
      method: 'POST',
      headers,
    });
    expect(issued.status).toBe(201);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    expect(issued.headers.get('set-cookie')).toBeNull();
    const token = (await issued.json()) as { token: string; sessionId: string };
    expect(issued.headers.get('location')).toBeNull();
    const listed = await fetch(`${origin}/api/identity/sessions`, { headers });
    expect(listed.status).toBe(200);
    const data = await listed.text();
    expect(data).toContain(token.sessionId);
    expect(data).not.toContain(token.token);
    expect(data).not.toContain(email);
    expect(
      (
        await fetch(`${origin}/api/identity/sessions/${token.sessionId}`, {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(204);
    expect(await audits.count('identity.session_changed.v1')).toBe(2);
    const boundaryIssue = await fetch(
      `${origin}/api/identity/bearer-sessions`,
      { method: 'POST', headers },
    );
    expect(boundaryIssue.status).toBe(201);
    const boundary = (await boundaryIssue.json()) as {
      token: string;
      expiresAt: string;
    };
    const bearer = new Headers({ authorization: `Bearer ${boundary.token}` });
    const deadline = Date.parse(boundary.expiresAt);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(deadline - 1);
      expect(
        (await fetch(`${origin}/api/identity/sessions`, { headers: bearer }))
          .status,
      ).toBe(200);
      vi.setSystemTime(deadline);
      expect(
        (await fetch(`${origin}/api/identity/sessions`, { headers: bearer }))
          .status,
      ).toBe(401);
      expect(
        (await fetch(`${origin}/api/identity/sessions`, { headers })).status,
      ).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  } finally {
    await app.close();
    await audits.close();
    await proof.close();
  }
});
