import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { OrganizationsModule } from '../../src/modules/organizations/organizations.module.js';
import {
  IdentityAccessModule,
  OrganizationAuthPort,
} from '../../src/modules/identity-access/index.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';

test('guarded Lexon invitation routes use the authenticated recipient and shared safe contracts', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createOrganizationInspector(services);
  const availability = { assertAvailable: async () => {} };
  @Module({})
  class FrameworkModule {}
  @Module({
    imports: [
      IdentityAccessModule.forPolicy({
        integration: proof.integration,
        frameworkModule: { module: FrameworkModule },
        availability,
      }),
      OrganizationsModule.forPolicy({
        port: new OrganizationAuthPort(proof.integration),
        selection: new IdentitySessionService(proof.integration),
        pagination: { defaultLimit: 20, maxLimit: 100 },
        invitationSeconds: 1209600,
      }),
    ],
  })
  class Root {}
  const app = await NestFactory.create(Root, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  try {
    const email = `${randomUUID()}@example.test`;
    const password = 'Invitation-http-42!';
    const owner = await proof.signIn({
      body: {
        name: 'HTTP owner',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const recipient = await proof.signIn({
      body: { name: 'HTTP recipient', email, password },
    });
    const team = await inspect.seedTeam([owner.userId]);
    const origin = await app.getUrl();
    const headers = new Headers(owner.cookieHeaders);
    headers.set('content-type', 'application/json');
    const created = await fetch(
      `${origin}/api/organizations/${team.id}/invitations`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, role: 'member' }),
      },
    );
    expect(created.status).toBe(201);
    const invitation = (await created.json()) as { id: string };
    const mine = await fetch(`${origin}/api/identity/invitations`, {
      headers: recipient.cookieHeaders,
    });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ items: [{ id: invitation.id }] });
    const accepted = await fetch(
      `${origin}/api/invitations/${invitation.id}/accept`,
      { method: 'POST', headers: recipient.cookieHeaders },
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      invitation: { id: invitation.id, status: 'accepted' },
      selection: { organization: { id: team.id } },
    });
  } finally {
    await app.close();
    await inspect.close();
    await proof.close();
  }
});
