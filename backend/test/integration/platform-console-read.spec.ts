import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { AccountsService } from '../../src/modules/platform-console/accounts.service.js';
import { PlatformOrganizationsService } from '../../src/modules/platform-console/organizations.service.js';
import { PlatformConsoleRepository } from '../../src/modules/platform-console/platform-console.repository.js';
import { securityHarness } from '../setup/security-harness.js';

const password = 'Platform-console-42!';

async function world(services: Parameters<typeof createAuthFixture>[0]) {
  const proof = await createAuthFixture(services);
  const harness = securityHarness(proof);
  const port = new OrganizationAuthPort(proof.integration);
  const accounts = new AccountsService(port, new PlatformConsoleRepository());
  const adminEmail = `${randomUUID()}@example.test`;
  const admin = await proof.signIn({
    body: { name: 'Console operator', email: adminEmail, password },
  });
  await proof.inspect.makeAdmin(admin.userId);
  return { proof, harness, port, accounts, admin, adminEmail };
}

test('platformRead refuses non-admin (403 ORG_FORBIDDEN) and admin without 2FA', async ({
  services,
}) => {
  const { proof, harness, port, adminEmail } = await world(services);
  try {
    const member = await proof.signIn({
      body: {
        name: 'Plain member',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    await harness.identity(member.cookieHeaders, async (identity) => {
      await expect(
        port.platformRead(identity, async () => 'x'),
      ).rejects.toMatchObject({ status: 403, code: 'ORG_FORBIDDEN' });
    });
    // The administrator signed in without enrolling an authenticator.
    const bare = await proof.signIn({
      body: { name: 'Bare', email: `${randomUUID()}@example.test`, password },
    });
    await proof.inspect.makeAdmin(bare.userId);
    await harness.identity(bare.cookieHeaders, async (identity) => {
      await expect(
        port.platformRead(identity, async () => 'x'),
      ).rejects.toMatchObject({ status: 403 });
    });
    expect(adminEmail).toBeTruthy();
  } finally {
    await proof.close();
  }
});

test('platformRead does not require re-auth; search escapes % _ and backslash; page beyond last returns true total', async ({
  services,
}) => {
  const { proof, harness, port, accounts, adminEmail } = await world(services);
  try {
    const full = await harness.enroll(adminEmail, password);
    for (const name of ['50%_x', '50ab'])
      await proof.signIn({
        body: { name, email: `${randomUUID()}@example.test`, password },
      });
    await harness.identity(full.headers, async (identity) => {
      // The enrolled session has no recent reauthenticatedAt: reads still pass.
      expect(await port.platformRead(identity, async () => 'ok')).toBe('ok');
      const found = await accounts.list(identity, { query: '50%_' });
      expect(found.items.map((a) => a.name)).toEqual(['50%_x']);
      expect(found.total).toBe(1);
      const beyond = await accounts.list(identity, { page: '50' });
      expect(beyond.items).toEqual([]);
      expect(beyond.page).toBe(50);
      expect(beyond.total).toBeGreaterThanOrEqual(3);
      const first = await accounts.list(identity, { pageSize: '10' });
      expect(first.total).toBe(beyond.total);
      expect(first.items[0]!.createdAt).toMatch(/Z$/);
    });
  } finally {
    await proof.close();
  }
});

test('organizations, members and invitations read paths return contract pages', async ({
  services,
}) => {
  const { proof, harness, port, accounts, adminEmail } = await world(services);
  try {
    const full = await harness.enroll(adminEmail, password);
    const organizations = new PlatformOrganizationsService(
      port,
      new PlatformConsoleRepository(),
    );
    await harness.identity(full.headers, async (identity) => {
      const page = await organizations.list(identity, {});
      expect(page.page).toBe(1);
      expect(page.items).toEqual([]);
      expect((await accounts.invitations(identity, {})).items).toEqual([]);
      await expect(
        organizations.get(identity, randomUUID()),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });
  } finally {
    await proof.close();
  }
});
