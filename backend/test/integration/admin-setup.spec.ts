import 'reflect-metadata';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IdentityAccessModule } from '../../src/modules/identity-access/index.js';
import { createAdminSetupOperator } from '../../src/infrastructure/db/index.js';
import { AdminSetupService } from '../../src/modules/identity-access/admin-setup.service.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { AccountService } from '../../src/modules/identity-access/account.service.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { securityHarness } from '../setup/security-harness.js';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAdminSetupFixture } from '../../src/infrastructure/db/testing/admin-setup-fixture.js';
import { runAdminSetup } from '../../src/modules/identity-access/admin-setup.service.js';
test('operator admission reserves one initial setup, repeats idempotently, and audits every run', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  const email = `${randomUUID()}@example.test`;
  const messages: Array<{ email: string; url: string }> = [];
  const dependencies = {
    operator: fixture.operator,
    origin: 'http://localhost:3000',
    setupSeconds: 86400,
    auditSecret: 'a'.repeat(48),
    auditKeyId: 'setup-test',
    send: async (message: { email: string; url: string }) => {
      messages.push(message);
    },
  };
  try {
    expect(
      await runAdminSetup({ email, additional: false }, dependencies),
    ).toEqual({ status: 'created' });
    expect(
      await runAdminSetup({ email, additional: false }, dependencies),
    ).toEqual({ status: 'pending' });
    expect(
      await runAdminSetup(
        { email: `${randomUUID()}@example.test`, additional: false },
        dependencies,
      ),
    ).toEqual({ status: 'refused' });
    expect(messages).toHaveLength(2);
    expect(await fixture.pendingCount(email)).toBe(1);
    expect(await fixture.auditCount()).toBe(3);
    expect(await fixture.privileges()).toEqual({
      read_grants: false,
      write_grants: false,
      write_audit: false,
      auth_can_begin: false,
    });
    expect(await fixture.rawGrant(email)).not.toContain(
      new URL(messages[0]!.url).searchParams.get('token'),
    );
  } finally {
    await fixture.close();
  }
});

test('operator admission rejects runtime auth credentials and expiry reissues without duplicate grants', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  const email = `${randomUUID()}@example.test`;
  const messages: Array<{ email: string; url: string }> = [];
  const dependencies = {
    operator: fixture.operator,
    origin: 'http://localhost:3000',
    setupSeconds: 86400,
    auditSecret: 'a'.repeat(48),
    auditKeyId: 'setup-test',
    send: async (message: { email: string; url: string }) => {
      messages.push(message);
    },
  };
  try {
    await expect(createAdminSetupOperator(services.authUrl)).rejects.toThrow(
      'Setup database unavailable',
    );
    await runAdminSetup({ email, additional: true }, dependencies);
    await fixture.expire(email);
    await runAdminSetup({ email, additional: true }, dependencies);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.url).not.toBe(messages[1]!.url);
    expect(await fixture.pendingCount(email)).toBe(1);
  } finally {
    await fixture.close();
  }
});

test('setup proof admits only its email and activates only after verified enrollment and session MFA', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  const proof = await createAuthFixture(services);
  let token = '';
  const email = `${randomUUID()}@example.test`;
  const password = 'Admin-activation-42!';
  try {
    await runAdminSetup(
      { email, additional: true },
      {
        operator: fixture.operator,
        origin: proof.origin,
        setupSeconds: 86400,
        auditSecret: 'b'.repeat(48),
        auditKeyId: 'setup-test',
        send: async (message) => {
          token = new URL(message.url).searchParams.get('token')!;
        },
      },
    );
    const service = new AdminSetupService(
      proof.integration,
      new OrganizationAuthPort(proof.integration),
    );
    expect(await service.redeem(token)).toEqual({ status: 'pending' });
    const account = new AccountService(proof.integration, {
      openSignup: false,
    });
    await expect(
      account.signUp({
        name: 'Wrong recipient',
        email: `${randomUUID()}@example.test`,
        password,
        setupToken: token,
      }),
    ).rejects.toMatchObject({ status: 401 });
    const user = await proof.signIn({
      body: { name: 'Setup recipient', email, password },
    });
    const harness = securityHarness(proof);
    await harness.identity(user.cookieHeaders, async (identity) => {
      await expect(service.complete(identity, token)).rejects.toMatchObject({
        status: 403,
      });
    });
    const enrolled = await harness.enroll(email, password);
    await harness.identity(enrolled.headers, (identity) =>
      service.complete(identity, token),
    );
    expect(
      (
        await new IdentitySessionService(proof.integration).resolve(
          enrolled.headers,
          { kind: 'platform' },
        )
      ).identity.platformAdmin,
    ).toBe(true);
    await expect(service.redeem(token)).rejects.toMatchObject({ status: 403 });
    await harness.identity(enrolled.headers, async (identity) => {
      await expect(service.complete(identity, token)).rejects.toMatchObject({
        status: 403,
      });
    });
  } finally {
    await proof.close();
    await fixture.close();
  }
});

test('setup HTTP exposes redemption but never operator initiation', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  const proof = await createAuthFixture(services);
  let token = '';
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
  await app.listen(0, '127.0.0.1');
  try {
    await runAdminSetup(
      { email: `${randomUUID()}@example.test`, additional: true },
      {
        operator: fixture.operator,
        origin: proof.origin,
        setupSeconds: 86400,
        auditSecret: 'c'.repeat(48),
        auditKeyId: 'setup-test',
        send: async (message) => {
          token = new URL(message.url).searchParams.get('token')!;
        },
      },
    );
    const origin = await app.getUrl();
    const headers = { 'content-type': 'application/json' };
    const response = await fetch(`${origin}/api/identity/admin-setup/redeem`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'pending' });
    expect(
      (
        await fetch(`${origin}/api/identity/admin-setup/begin`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ email: 'admin@example.test', role: 'admin' }),
        })
      ).status,
    ).toBe(404);
  } finally {
    await app.close();
    await proof.close();
    await fixture.close();
  }
});

test('failed delivery can be retried without another grant and existing accounts are ID-bound', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  const proof = await createAuthFixture(services);
  const email = `${randomUUID()}@example.test`;
  const user = await proof.signIn({
    body: {
      name: 'Existing setup account',
      email,
      password: 'Existing-setup-42!',
    },
  });
  let delivered = 0;
  const deps = {
    operator: fixture.operator,
    origin: proof.origin,
    setupSeconds: 86400,
    auditSecret: 'd'.repeat(48),
    auditKeyId: 'setup-test',
    send: async () => {
      throw new Error('Delivery unavailable');
    },
  };
  try {
    await expect(
      runAdminSetup({ email, additional: true }, deps),
    ).rejects.toThrow('Delivery unavailable');
    expect(await fixture.pendingCount(email)).toBe(1);
    expect(
      await runAdminSetup(
        { email, additional: true },
        {
          ...deps,
          send: async () => {
            delivered++;
          },
        },
      ),
    ).toEqual({ status: 'pending' });
    expect(delivered).toBe(1);
    expect(await fixture.pendingCount(email)).toBe(1);
    expect(await fixture.rawGrant(email)).toContain(user.userId);
  } finally {
    await proof.close();
    await fixture.close();
  }
});

test('activation audit failure preserves ordinary access and a live grant', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  const proof = await createAuthFixture(services);
  const audits = createAuditInspector(services);
  let token = '';
  const email = `${randomUUID()}@example.test`;
  const password = 'Atomic-admin-setup-42!';
  try {
    await runAdminSetup(
      { email, additional: true },
      {
        operator: fixture.operator,
        origin: proof.origin,
        setupSeconds: 86400,
        auditSecret: 'e'.repeat(48),
        auditKeyId: 'setup-test',
        send: async (message) => {
          token = new URL(message.url).searchParams.get('token')!;
        },
      },
    );
    await proof.signIn({ body: { name: 'Atomic setup', email, password } });
    const harness = securityHarness(proof);
    const full = await harness.enroll(email, password);
    const service = new AdminSetupService(
      proof.integration,
      new OrganizationAuthPort(proof.integration),
    );
    await audits.rejectInserts();
    await harness.identity(full.headers, async (identity) => {
      await expect(service.complete(identity, token)).rejects.toThrow();
    });
    expect(await service.redeem(token)).toEqual({ status: 'pending' });
    expect(
      (
        await new IdentitySessionService(proof.integration).resolve(
          full.headers,
          { kind: 'account' },
        )
      ).identity.platformAdmin,
    ).toBe(false);
  } finally {
    await audits.close();
    await proof.close();
    await fixture.close();
  }
});

test('an existing team member cannot activate platform privileges through setup', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  const proof = await createAuthFixture(services);
  let token = '';
  const email = `${randomUUID()}@example.test`;
  const password = 'Team-admin-setup-42!';
  try {
    const user = await proof.signIn({
      body: { name: 'Customer member', email, password },
    });
    await proof.integration.transaction((tx) =>
      tx.call('createOrganization', {
        body: {
          name: 'Customer firm',
          slug: `customer-${randomUUID()}`,
          userId: user.userId,
        },
      }),
    );
    await runAdminSetup(
      { email, additional: true },
      {
        operator: fixture.operator,
        origin: proof.origin,
        setupSeconds: 86400,
        auditSecret: 'f'.repeat(48),
        auditKeyId: 'setup-test',
        send: async (message) => {
          token = new URL(message.url).searchParams.get('token')!;
        },
      },
    );
    const harness = securityHarness(proof);
    const full = await harness.enroll(email, password);
    const service = new AdminSetupService(
      proof.integration,
      new OrganizationAuthPort(proof.integration),
    );
    await harness.identity(full.headers, async (identity) => {
      await expect(service.complete(identity, token)).rejects.toMatchObject({
        status: 403,
      });
    });
    expect(
      (
        await new IdentitySessionService(proof.integration).resolve(
          full.headers,
          { kind: 'account' },
        )
      ).identity.platformAdmin,
    ).toBe(false);
    expect(await service.redeem(token)).toEqual({ status: 'pending' });
  } finally {
    await proof.close();
    await fixture.close();
  }
});
test('out-of-order setup delivery never restores a superseded pending token', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  const proof = await createAuthFixture(services);
  const email = randomUUID() + '@example.test';
  const delivered: string[] = [];
  let firstUrl = '';
  let release: () => void = () => {};
  let firstStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deps = {
    operator: fixture.operator,
    origin: proof.origin,
    setupSeconds: 86400,
    auditSecret: 'g'.repeat(48),
    auditKeyId: 'ordering-test',
    send: async ({ url }: { url: string }) => {
      firstUrl = url;
      firstStarted();
      await pending;
      delivered.push(url);
    },
  };
  try {
    const first = runAdminSetup({ email, additional: true }, deps);
    await started;
    const second = await runAdminSetup(
      { email, additional: true },
      {
        ...deps,
        send: async ({ url }) => {
          delivered.push(url);
        },
      },
    );
    expect(second.status).toBe('pending');
    release();
    await first;
    expect(delivered[1] === firstUrl).toBe(true);
    expect(await fixture.pendingCount(email)).toBe(1);
    const service = new AdminSetupService(
      proof.integration,
      new OrganizationAuthPort(proof.integration),
    );
    const newest = new URL(delivered[0]!).searchParams.get('token')!;
    const obsolete = new URL(delivered[1]!).searchParams.get('token')!;
    expect(await service.redeem(newest)).toEqual({ status: 'pending' });
    await expect(service.redeem(obsolete)).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    release();
    await proof.close();
    await fixture.close();
  }
});
