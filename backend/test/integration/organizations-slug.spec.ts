import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/organization-auth.port.js';
import { OrganizationService } from '../../src/modules/organizations/organization.service.js';
import { ProvisioningService } from '../../src/modules/organizations/provisioning.service.js';
import { securityHarness } from '../setup/security-harness.js';

const password = 'Slug-conflict-password-42!';
const config = {
  invitationSeconds: 1209600,
  reauthSeconds: 300,
  pagination: { defaultLimit: 20, maxLimit: 100 },
};
const taken = { code: 'ORG_SLUG_TAKEN', status: 409 };

async function setup(services: Parameters<typeof createAuthFixture>[0]) {
  const proof = await createAuthFixture(services);
  const port = new OrganizationAuthPort(proof.integration);
  const security = securityHarness(proof);
  const organizations = new OrganizationService(port, {
    pagination: config.pagination,
  });
  const provisioning = new ProvisioningService(port, config);
  const user = async (name: string) =>
    proof.signIn({
      body: { name, email: `${randomUUID()}@example.test`, password },
    });
  const admin = async () => {
    const email = `${randomUUID()}@example.test`;
    const signed = await proof.signIn({
      body: { name: 'Slug administrator', email, password },
    });
    await proof.inspect.makeAdmin(signed.userId);
    return security.enroll(email, password);
  };
  return { proof, security, organizations, provisioning, user, admin };
}

test('create with an existing slug -> 409 ORG_SLUG_TAKEN; rename to an existing slug -> 409', async ({
  services,
}) => {
  const { proof, security, organizations, user } = await setup(services);
  try {
    const owner = await user('Slug owner');
    const slug = `taken-${randomUUID()}`;
    await security.identity(owner.cookieHeaders, async (identity) => {
      await organizations.create(identity, { name: 'First', slug });
      await expect(
        organizations.create(identity, { name: 'Second', slug }),
      ).rejects.toMatchObject(taken);
      const other = await organizations.create(identity, {
        name: 'Other',
        slug: `other-${randomUUID()}`,
      });
      await expect(
        organizations.settings(identity, other.id, { slug }),
      ).rejects.toMatchObject(taken);
    });
  } finally {
    await proof.close();
  }
});

test('platform provisioning with an existing slug -> 409', async ({
  services,
}) => {
  const { proof, security, organizations, provisioning, user, admin } =
    await setup(services);
  try {
    const owner = await user('Slug owner');
    const full = await admin();
    const slug = `prov-${randomUUID()}`;
    await security.identity(owner.cookieHeaders, (identity) =>
      organizations.create(identity, { name: 'Existing', slug }),
    );
    await security.identity(full.headers, async (identity) => {
      await expect(
        provisioning.create(identity, {
          name: 'Provisioned',
          slug,
          ownerEmail: `${randomUUID()}@example.test`,
        }),
      ).rejects.toMatchObject(taken);
    });
  } finally {
    await proof.close();
  }
});

test('two concurrent creates of one slug -> exactly one success and one 409', async ({
  services,
}) => {
  const { proof, security, organizations, user } = await setup(services);
  try {
    const a = await user('Racer A');
    const b = await user('Racer B');
    const slug = `race-${randomUUID()}`;
    const run = (headers: Headers, name: string) =>
      security.identity(headers, (identity) =>
        organizations.create(identity, { name, slug }),
      );
    const results = await Promise.allSettled([
      run(a.cookieHeaders, 'Race A'),
      run(b.cookieHeaders, 'Race B'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject(taken);
  } finally {
    await proof.close();
  }
});

test('provisioning racing the create form on one slug -> exactly one success and one 409', async ({
  services,
}) => {
  const { proof, security, organizations, provisioning, user, admin } =
    await setup(services);
  try {
    const owner = await user('Form owner');
    const full = await admin();
    const slug = `mixed-${randomUUID()}`;
    const results = await Promise.allSettled([
      security.identity(owner.cookieHeaders, (identity) =>
        organizations.create(identity, { name: 'Form', slug }),
      ),
      security.identity(full.headers, (identity) =>
        provisioning.create(identity, {
          name: 'Provisioned',
          slug,
          ownerEmail: `${randomUUID()}@example.test`,
        }),
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject(taken);
  } finally {
    await proof.close();
  }
});
