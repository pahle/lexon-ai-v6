import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createInvitationInspector } from '../../src/infrastructure/db/testing/invitation-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { ProvisioningService } from '../../src/modules/organizations/provisioning.service.js';
import { MembershipService } from '../../src/modules/organizations/membership.service.js';
import { OrganizationService } from '../../src/modules/organizations/organization.service.js';
import { InvitationService } from '../../src/modules/organizations/invitation.service.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { securityHarness } from '../setup/security-harness.js';
const password = 'Provisioning-platform-42!';
test('platform provisions no members, replaces owner links, and verified acceptance atomically activates', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createInvitationInspector(services);
  try {
    const adminEmail = `${randomUUID()}@example.test`;
    const admin = await proof.signIn({
      body: { name: 'Platform operator', email: adminEmail, password },
    });
    await proof.inspect.makeAdmin(admin.userId);
    const harness = securityHarness(proof);
    const full = await harness.enroll(adminEmail, password);
    const port = new OrganizationAuthPort(proof.integration);
    const config = {
      invitationSeconds: 1209600,
      reauthSeconds: 300,
      pagination: { defaultLimit: 20, maxLimit: 100 },
    };
    const service = new ProvisioningService(port, config);
    const oldEmail = `${randomUUID()}@example.test`;
    const newEmail = `${randomUUID()}@example.test`;
    const owner = await proof.signIn({
      body: { name: 'First owner', email: newEmail, password },
    });
    const provisioned = await harness.identity(full.headers, (identity) =>
      service.create(identity, {
        name: 'Provisioned firm',
        slug: `firm-${randomUUID()}`,
        ownerEmail: oldEmail,
      }),
    );
    expect(provisioned.state).toBe('provisioning');
    expect(await inspect.member(admin.userId, provisioned.id)).toBeNull();
    expect(await inspect.member(owner.userId, provisioned.id)).toBeNull();
    const organizations = new OrganizationService(port, {
      pagination: config.pagination,
    });
    await harness.identity(full.headers, async (identity) => {
      await expect(
        organizations.create(identity, {
          name: 'Forbidden staff team',
          slug: `staff-${randomUUID()}`,
        }),
      ).rejects.toThrow();
    });
    await harness.identity(owner.cookieHeaders, async (identity) => {
      expect(
        (await organizations.list(identity)).items.some(
          (row) => row.id === provisioned.id,
        ),
      ).toBe(false);
      await expect(
        new IdentitySessionService(proof.integration).select(
          identity,
          provisioned.id,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    const changed = await harness.identity(full.headers, (identity) =>
      service.replaceOwnerEmail(identity, provisioned.id, newEmail),
    );
    expect(changed.invitation.id).not.toBe(provisioned.invitation.id);
    const invitations = new InvitationService(
      port,
      new IdentitySessionService(proof.integration),
      config,
    );
    await harness.identity(owner.cookieHeaders, async (identity) => {
      await expect(
        invitations.accept(identity, provisioned.invitation.id),
      ).rejects.toMatchObject({ status: 403 });
      const accepted = await invitations.accept(
        identity,
        changed.invitation.id,
      );
      expect(accepted.selection.organization).toMatchObject({
        state: 'active',
        role: 'owner',
      });
    });
    expect(await inspect.member(admin.userId, provisioned.id)).toBeNull();
    await harness.identity(full.headers, async (identity) => {
      await expect(
        new MembershipService(port, { pagination: config.pagination }).list(
          identity,
          provisioned.id,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        invitations.listForOrganization(identity, provisioned.id),
      ).rejects.toMatchObject({ status: 403 });
    });
    await harness.identity(full.headers, async (identity) => {
      await expect(
        service.cancel(identity, provisioned.id),
      ).rejects.toMatchObject({ status: 403 });
    });
  } finally {
    await inspect.close();
    await proof.close();
  }
});

test('expired owner invitation stays provisioning; resend replaces it and cancel preserves audit', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createInvitationInspector(services);
  const audits = createAuditInspector(services);
  try {
    const before = await audits.count('platform.provisioning_changed.v1');
    const email = `${randomUUID()}@example.test`;
    const admin = await proof.signIn({
      body: { name: 'Lifecycle administrator', email, password },
    });
    await proof.inspect.makeAdmin(admin.userId);
    const harness = securityHarness(proof);
    const full = await harness.enroll(email, password);
    const service = new ProvisioningService(
      new OrganizationAuthPort(proof.integration),
      {
        invitationSeconds: 1209600,
        reauthSeconds: 300,
        pagination: { defaultLimit: 20, maxLimit: 100 },
      },
    );
    const created = await harness.identity(full.headers, (identity) =>
      service.create(identity, {
        name: 'Pending firm',
        slug: `pending-${randomUUID()}`,
        ownerEmail: `${randomUUID()}@example.test`,
      }),
    );
    await inspect.expire(created.invitation.id);
    expect(
      (
        await harness.identity(full.headers, (identity) =>
          service.get(identity, created.id),
        )
      ).invitation.status,
    ).toBe('expired');
    const resent = await harness.identity(full.headers, (identity) =>
      service.resend(identity, created.id),
    );
    expect(resent.invitation.id).not.toBe(created.invitation.id);
    expect(resent.state).toBe('provisioning');
    expect(
      (
        await harness.identity(full.headers, (identity) =>
          service.list(identity),
        )
      ).items.map((row) => row.id),
    ).toContain(created.id);
    await harness.identity(full.headers, (identity) =>
      service.cancel(identity, created.id),
    );
    await harness.identity(full.headers, async (identity) => {
      await expect(service.get(identity, created.id)).rejects.toMatchObject({
        status: 403,
      });
    });
    expect(await inspect.member(admin.userId, created.id)).toBeNull();
    expect(await audits.count('platform.provisioning_changed.v1')).toBe(
      before + 3,
    );
  } finally {
    await audits.close();
    await inspect.close();
    await proof.close();
  }
});

test('owner acceptance audit failure restores provisioning, invitation and empty membership atomically', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createInvitationInspector(services);
  const audits = createAuditInspector(services);
  try {
    const adminEmail = `${randomUUID()}@example.test`;
    const admin = await proof.signIn({
      body: { name: 'Atomic admin', email: adminEmail, password },
    });
    await proof.inspect.makeAdmin(admin.userId);
    const harness = securityHarness(proof);
    const full = await harness.enroll(adminEmail, password);
    const port = new OrganizationAuthPort(proof.integration);
    const config = {
      invitationSeconds: 1209600,
      reauthSeconds: 300,
      pagination: { defaultLimit: 20, maxLimit: 100 },
    };
    const service = new ProvisioningService(port, config);
    const ownerEmail = `${randomUUID()}@example.test`;
    const owner = await proof.signIn({
      body: { name: 'Atomic owner', email: ownerEmail, password },
    });
    const created = await harness.identity(full.headers, (identity) =>
      service.create(identity, {
        name: 'Atomic firm',
        slug: `atomic-${randomUUID()}`,
        ownerEmail,
      }),
    );
    await audits.rejectInserts();
    await harness.identity(owner.cookieHeaders, async (identity) => {
      await expect(
        new InvitationService(
          port,
          new IdentitySessionService(proof.integration),
          config,
        ).accept(identity, created.invitation.id),
      ).rejects.toThrow();
    });
    expect(await inspect.member(owner.userId, created.id)).toBeNull();
    expect(
      (
        await harness.identity(full.headers, (identity) =>
          service.get(identity, created.id),
        )
      ).invitation.status,
    ).toBe('pending');
  } finally {
    await audits.close();
    await inspect.close();
    await proof.close();
  }
});

for (const action of ['cancel', 'replace'] as const)
  test(`${action} and first-owner acceptance serialize to one coherent result`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    const inspect = createInvitationInspector(services);
    const organizationLocks = createOrganizationInspector(services);
    try {
      const adminEmail = `${randomUUID()}@example.test`;
      const admin = await proof.signIn({
        body: { name: 'Race admin', email: adminEmail, password },
      });
      await proof.inspect.makeAdmin(admin.userId);
      const harness = securityHarness(proof);
      const full = await harness.enroll(adminEmail, password);
      const port = new OrganizationAuthPort(proof.integration);
      const config = {
        invitationSeconds: 1209600,
        reauthSeconds: 300,
        pagination: { defaultLimit: 20, maxLimit: 100 },
      };
      const service = new ProvisioningService(port, config);
      const ownerEmail = `${randomUUID()}@example.test`;
      const owner = await proof.signIn({
        body: { name: 'Race owner', email: ownerEmail, password },
      });
      const created = await harness.identity(full.headers, (identity) =>
        service.create(identity, {
          name: 'Race firm',
          slug: `race-${randomUUID()}`,
          ownerEmail,
        }),
      );
      const invitations = new InvitationService(
        port,
        new IdentitySessionService(proof.integration),
        config,
      );
      const lock = await organizationLocks.hold(created.id);
      const race = Promise.allSettled([
        harness.identity(full.headers, async (identity) => {
          if (action === 'cancel') await service.cancel(identity, created.id);
          else
            await service.replaceOwnerEmail(
              identity,
              created.id,
              `${randomUUID()}@example.test`,
            );
        }),
        harness.identity(owner.cookieHeaders, (identity) =>
          invitations.accept(identity, created.invitation.id),
        ),
      ]);
      try {
        await lock.waitForAuthWaiters(2);
      } finally {
        await lock.release();
      }
      const result = await race;
      expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(
        1,
      );
      expect(!!(await inspect.member(owner.userId, created.id))).toBe(
        result[1]!.status === 'fulfilled',
      );
      expect(await inspect.member(admin.userId, created.id)).toBeNull();
    } finally {
      await organizationLocks.close();
      await inspect.close();
      await proof.close();
    }
  });

test('maximum provisioning page loads every current invitation beyond native default limits', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createInvitationInspector(services);
  try {
    const user = await proof.signIn({
      body: {
        name: 'Page fixture',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const seeded = await inspect.seedProvisioningPage(user.userId, 101);
    const result = await proof.integration.transaction((tx) =>
      tx.call('lexonListProvisioning', { body: { limit: 101 } }),
    );
    expect(result.length).toBeGreaterThanOrEqual(101);
    for (const row of result)
      expect(row.invitation?.organizationId).toBe(row.organization.id);
    expect(seeded).toHaveLength(101);
    const invitations = await proof.integration.transaction((tx) =>
      tx.call('lexonListInvitationFacts', {
        body: { email: 'page@example.test', limit: 101 },
      }),
    );
    expect(invitations).toHaveLength(101);
    for (const row of invitations)
      expect(row.organization?.id).toBe(row.invitation.organizationId);
  } finally {
    await inspect.close();
    await proof.close();
  }
});
