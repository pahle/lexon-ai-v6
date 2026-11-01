import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createInvitationInspector } from '../../src/infrastructure/db/testing/invitation-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/organization-auth.port.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { InvitationService } from '../../src/modules/organizations/invitation.service.js';
import { securityHarness } from '../setup/security-harness.js';

const password = 'Invitation-password-42!';
test('invitation acceptance preserves role floors, binds retries to the user and cannot restore departed access', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const users = await Promise.all(
      ['Owner', 'Recipient', 'Other'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const [owner, recipient, other] = users;
    const team = await organizations.seedTeam([owner!.userId]);
    const security = securityHarness(proof);
    const service = new InvitationService(
      new OrganizationAuthPort(proof.integration),
      new IdentitySessionService(proof.integration),
      {
        invitationSeconds: 1209600,
        pagination: { defaultLimit: 20, maxLimit: 100 },
      },
    );
    const email = await inspect.email(recipient!.userId);
    const invitation = await security.identity(
      owner!.cookieHeaders,
      (identity) => service.create(identity, team.id, { email, role: 'admin' }),
    );
    const duplicate = await security.identity(
      owner!.cookieHeaders,
      (identity) =>
        service.create(identity, team.id, {
          email: email.toUpperCase(),
          role: 'admin',
        }),
    );
    expect(duplicate.id).toBe(invitation.id);
    expect(await inspect.pendingCount(team.id, email)).toBe(1);
    await security.identity(other!.cookieHeaders, async (identity) => {
      expect((await service.listMine(identity)).items).toEqual([]);
      await expect(
        service.accept(identity, invitation.id),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.decline(identity, invitation.id),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.listForOrganization(identity, team.id),
      ).rejects.toMatchObject({ status: 403 });
    });
    expect(
      (
        await security.identity(recipient!.cookieHeaders, (identity) =>
          service.listMine(identity),
        )
      ).items.map((row) => row.id),
    ).toContain(invitation.id);
    const accepted = await security.identity(
      recipient!.cookieHeaders,
      (identity) => service.accept(identity, invitation.id),
    );
    expect(accepted).toMatchObject({
      invitation: { status: 'accepted' },
      selection: {
        status: 'switched',
        organization: { id: team.id, role: 'admin' },
      },
    });
    const member = await inspect.member(recipient!.userId, team.id);
    expect(member!.role).toBe('admin');
    await inspect.setRole(member!.id, 'member');
    await security.identity(recipient!.cookieHeaders, (identity) =>
      service.accept(identity, invitation.id),
    );
    expect((await inspect.member(recipient!.userId, team.id))!.role).toBe(
      'member',
    );
    expect(await inspect.acceptAuditCount(invitation.id)).toBe(1);
    await inspect.removeMember(member!.id);
    await security.identity(recipient!.cookieHeaders, async (identity) => {
      await expect(
        service.accept(identity, invitation.id),
      ).rejects.toMatchObject({ status: 403 });
    });
    expect(await inspect.member(recipient!.userId, team.id)).toBeNull();
    await inspect.changeEmail(
      recipient!.userId,
      `${randomUUID()}@example.test`,
    );
    await inspect.changeEmail(other!.userId, email);
    await security.identity(other!.cookieHeaders, async (identity) => {
      await expect(
        service.accept(identity, invitation.id),
      ).rejects.toMatchObject({ status: 403 });
    });
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

test('expired resend replaces the record and existing roles are never demoted on first acceptance', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const owner = await proof.signIn({
      body: {
        name: 'Lifecycle owner',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const recipient = await proof.signIn({
      body: {
        name: 'Lifecycle recipient',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const team = await organizations.seedTeam([owner.userId]);
    const security = securityHarness(proof);
    const service = new InvitationService(
      new OrganizationAuthPort(proof.integration),
      new IdentitySessionService(proof.integration),
      {
        invitationSeconds: 1209600,
        pagination: { defaultLimit: 20, maxLimit: 100 },
      },
    );
    const email = await inspect.email(recipient.userId);
    const original = await security.identity(owner.cookieHeaders, (identity) =>
      service.create(identity, team.id, { email, role: 'member' }),
    );
    await inspect.expire(original.id);
    const replacement = await security.identity(
      owner.cookieHeaders,
      (identity) => service.resend(identity, original.id),
    );
    expect(replacement.id).not.toBe(original.id);
    expect(replacement.status).toBe('pending');
    expect(await inspect.pendingCount(team.id, email)).toBe(1);
    await security.identity(recipient.cookieHeaders, async (identity) => {
      await expect(service.accept(identity, original.id)).rejects.toMatchObject(
        { status: 403 },
      );
    });
    await inspect.addMember(team.id, recipient.userId, 'owner');
    const accepted = await security.identity(
      recipient.cookieHeaders,
      (identity) => service.accept(identity, replacement.id),
    );
    expect(accepted.selection.organization.role).toBe('owner');
    expect((await inspect.member(recipient.userId, team.id))!.role).toBe(
      'owner',
    );
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

test('invitation management enforces role scope, recipient-only decline and safe terminal states', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const [owner, admin, recipient] = await Promise.all(
      ['Manager owner', 'Manager admin', 'Manager recipient'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([owner!.userId, admin!.userId]);
    await inspect.setRole(team.members[1]!.id, 'admin');
    const harness = securityHarness(proof);
    const service = new InvitationService(
      new OrganizationAuthPort(proof.integration),
      new IdentitySessionService(proof.integration),
      {
        invitationSeconds: 1209600,
        pagination: { defaultLimit: 20, maxLimit: 100 },
      },
    );
    const email = await inspect.email(recipient!.userId);
    await harness.identity(admin!.cookieHeaders, async (identity) => {
      await expect(
        service.create(identity, team.id, { email, role: 'admin' }),
      ).rejects.toMatchObject({ status: 403 });
    });
    await harness.identity(owner!.cookieHeaders, async (identity) => {
      expect(() =>
        service.create(identity, team.id, { email, role: 'owner' } as never),
      ).toThrow();
    });
    const invitation = await harness.identity(
      admin!.cookieHeaders,
      (identity) =>
        service.create(identity, team.id, { email, role: 'member' }),
    );
    expect(
      Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt),
    ).toBeGreaterThan(13 * 86400000);
    expect(
      (
        await harness.identity(owner!.cookieHeaders, (identity) =>
          service.listForOrganization(identity, team.id, { limit: 1 }),
        )
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await harness.identity(recipient!.cookieHeaders, (identity) =>
          service.decline(identity, invitation.id),
        )
      ).status,
    ).toBe('declined');
    await harness.identity(recipient!.cookieHeaders, async (identity) => {
      await expect(
        service.accept(identity, invitation.id),
      ).rejects.toMatchObject({ status: 403 });
    });
    const replacement = await harness.identity(
      owner!.cookieHeaders,
      (identity) =>
        service.create(identity, team.id, { email, role: 'member' }),
    );
    expect(
      (
        await harness.identity(owner!.cookieHeaders, (identity) =>
          service.cancel(identity, replacement.id),
        )
      ).status,
    ).toBe('cancelled');
    await harness.identity(recipient!.cookieHeaders, async (identity) => {
      await expect(
        service.accept(identity, replacement.id),
      ).rejects.toMatchObject({ status: 403 });
    });
    await harness.identity(owner!.cookieHeaders, async (identity) => {
      await expect(
        service.resend(identity, replacement.id),
      ).rejects.toMatchObject({ status: 403 });
    });
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

test('SMTP failure leaves invitations valid and organization MFA keeps prior selection after joining', async ({
  services,
}) => {
  const proof = await createAuthFixture(services, {
    mailTransport: {
      sendMail: async () => {
        throw new Error('SMTP unavailable');
      },
    },
  });
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const owner = await proof.signIn({
      body: {
        name: 'MFA invite owner',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const recipient = await proof.signIn({
      body: {
        name: 'MFA invite recipient',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const team = await organizations.seedTeam([owner.userId]);
    const harness = securityHarness(proof);
    const service = new InvitationService(
      new OrganizationAuthPort(proof.integration),
      new IdentitySessionService(proof.integration),
      {
        invitationSeconds: 1209600,
        pagination: { defaultLimit: 20, maxLimit: 100 },
      },
    );
    const email = await inspect.email(recipient.userId);
    const invitation = await harness.identity(owner.cookieHeaders, (identity) =>
      service.create(identity, team.id, { email, role: 'member' }),
    );
    await proof.drainMail();
    expect(proof.mailDeliveryState().failed).toBeGreaterThan(0);
    expect(proof.dispatchedLink(email, 'invitation')).toContain(invitation.id);
    expect(
      (
        await harness.identity(owner.cookieHeaders, (identity) =>
          service.resend(identity, invitation.id),
        )
      ).id,
    ).toBe(invitation.id);
    await inspect.requireMfa(team.id);
    const personal = await proof.inspect.personalFor(recipient.userId);
    const accepted = await harness.identity(
      recipient.cookieHeaders,
      (identity) => service.accept(identity, invitation.id),
    );
    expect(accepted.selection).toMatchObject({
      status: 'enrollment_required',
      organization: { id: personal!.orgId },
      pendingOrganizationId: team.id,
    });
    expect(await inspect.member(recipient.userId, team.id)).toMatchObject({
      role: 'member',
    });
    expect(
      (
        await new IdentitySessionService(proof.integration).resolve(
          recipient.cookieHeaders,
          { kind: 'workspace' },
        )
      ).summary.organization.id,
    ).toBe(personal!.orgId);
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

test('first-owner acceptance activates provisioning atomically and remains retryable by that member', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const operator = await proof.signIn({
      body: {
        name: 'Provisioning operator',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const recipient = await proof.signIn({
      body: {
        name: 'Provisioning recipient',
        email: 'owner@example.test',
        password,
      },
    });
    const orgId = await organizations.seedProvisioning(operator.userId);
    const harness = securityHarness(proof);
    const service = new InvitationService(
      new OrganizationAuthPort(proof.integration),
      new IdentitySessionService(proof.integration),
      {
        invitationSeconds: 1209600,
        pagination: { defaultLimit: 20, maxLimit: 100 },
      },
    );
    const mine = await harness.identity(recipient.cookieHeaders, (identity) =>
      service.listMine(identity),
    );
    const invitation = mine.items.find((row) => row.organizationId === orgId)!;
    const accepted = await harness.identity(
      recipient.cookieHeaders,
      (identity) => service.accept(identity, invitation.id),
    );
    expect(accepted.selection.organization).toMatchObject({
      id: orgId,
      state: 'active',
      role: 'owner',
    });
    const retry = await harness.identity(recipient.cookieHeaders, (identity) =>
      service.accept(identity, invitation.id),
    );
    expect(retry.invitation.status).toBe('accepted');
    expect(await inspect.acceptAuditCount(invitation.id)).toBe(1);
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

test('audit failure rolls back invitation creation before any invitation mail dispatch', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  const audits = createAuditInspector(services);
  try {
    const owner = await proof.signIn({
      body: {
        name: 'Audit owner',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const team = await organizations.seedTeam([owner.userId]);
    const harness = securityHarness(proof);
    const service = new InvitationService(
      new OrganizationAuthPort(proof.integration),
      new IdentitySessionService(proof.integration),
      {
        invitationSeconds: 1209600,
        pagination: { defaultLimit: 20, maxLimit: 100 },
      },
    );
    const email = `${randomUUID()}@example.test`;
    await audits.rejectInserts();
    await harness.identity(owner.cookieHeaders, async (identity) => {
      await expect(
        service.create(identity, team.id, { email, role: 'member' }),
      ).rejects.toThrow();
    });
    expect(await inspect.pendingCount(team.id, email)).toBe(0);
    expect(proof.dispatchedLink(email, 'invitation')).toBeUndefined();
  } finally {
    await audits.close();
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

// Managing an existing invitation must not apply the role's creation permission.
for (const action of ['resend', 'cancel', 'replace-expired'] as const) {
  test(`organization admin can ${action} an owner-created admin invitation without changing its grant`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    const organizations = createOrganizationInspector(services);
    const inspect = createInvitationInspector(services);
    try {
      const [owner, admin, recipient] = await Promise.all(
        ['Owner', 'Admin', 'Recipient'].map((name) =>
          proof.signIn({
            body: { name, email: `${randomUUID()}@example.test`, password },
          }),
        ),
      );
      const team = await organizations.seedTeam([owner!.userId, admin!.userId]);
      await inspect.setRole(team.members[1]!.id, 'admin');
      const harness = securityHarness(proof);
      const service = new InvitationService(
        new OrganizationAuthPort(proof.integration),
        new IdentitySessionService(proof.integration),
        {
          invitationSeconds: 1209600,
          pagination: { defaultLimit: 20, maxLimit: 100 },
        },
      );
      const email = await inspect.email(recipient!.userId);
      const original = await harness.identity(
        owner!.cookieHeaders,
        (identity) =>
          service.create(identity, team.id, { email, role: 'admin' }),
      );
      if (action === 'replace-expired') await inspect.expire(original.id);
      const managed = await harness.identity(
        admin!.cookieHeaders,
        (identity) =>
          action === 'cancel'
            ? service.cancel(identity, original.id)
            : service.resend(identity, original.id),
      );
      expect(managed).toMatchObject({
        email,
        role: 'admin',
        organizationId: team.id,
        status: action === 'cancel' ? 'cancelled' : 'pending',
      });
      if (action === 'replace-expired') {
        expect(managed.id).not.toBe(original.id);
        await harness.identity(recipient!.cookieHeaders, async (identity) => {
          await expect(
            service.accept(identity, original.id),
          ).rejects.toMatchObject({ status: 403 });
        });
      } else expect(managed.id).toBe(original.id);
      expect(await inspect.pendingCount(team.id, email)).toBe(
        action === 'cancel' ? 0 : 1,
      );
      if (action !== 'cancel') {
        await harness.identity(recipient!.cookieHeaders, (identity) =>
          service.accept(identity, managed.id),
        );
        expect(await inspect.member(recipient!.userId, team.id)).toMatchObject({
          role: 'admin',
        });
      }
      await harness.identity(admin!.cookieHeaders, async (identity) => {
        await expect(
          service.create(identity, team.id, {
            email: `${randomUUID()}@example.test`,
            role: 'admin',
          }),
        ).rejects.toMatchObject({ status: 403 });
      });
    } finally {
      await inspect.close();
      await organizations.close();
      await proof.close();
    }
  });
}
