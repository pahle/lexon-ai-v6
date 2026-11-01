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

const password = 'Concurrent-invitation-42!';
test('concurrent accept commits one membership and one transition audit', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const owner = await proof.signIn({
      body: {
        name: 'Concurrent owner',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const recipient = await proof.signIn({
      body: {
        name: 'Concurrent recipient',
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
    const held = await organizations.hold(team.id);
    const accept = () =>
      harness.identity(recipient.cookieHeaders, (identity) =>
        service.accept(identity, invitation.id),
      );
    const results = Promise.all([accept(), accept()]);
    try {
      await held.waitForAuthWaiters(2);
    } finally {
      await held.release();
    }
    expect((await results).map((result) => result.invitation.status)).toEqual([
      'accepted',
      'accepted',
    ]);
    expect((await inspect.member(recipient.userId, team.id))!.role).toBe(
      'member',
    );
    expect(await inspect.acceptAuditCount(invitation.id)).toBe(1);
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

for (const action of ['cancel', 'resend'] as const)
  test(`${action} racing acceptance cannot resurrect a consumed invitation`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    const organizations = createOrganizationInspector(services);
    const inspect = createInvitationInspector(services);
    try {
      const owner = await proof.signIn({
        body: {
          name: 'Race owner',
          email: `${randomUUID()}@example.test`,
          password,
        },
      });
      const recipient = await proof.signIn({
        body: {
          name: 'Race recipient',
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
      const invitation = await harness.identity(
        owner.cookieHeaders,
        (identity) =>
          service.create(identity, team.id, { email, role: 'member' }),
      );
      const held = await organizations.hold(team.id);
      const race = Promise.allSettled([
        harness.identity(owner.cookieHeaders, (identity) =>
          service[action](identity, invitation.id),
        ),
        harness.identity(recipient.cookieHeaders, (identity) =>
          service.accept(identity, invitation.id),
        ),
      ]);
      try {
        await held.waitForAuthWaiters(2);
      } finally {
        await held.release();
      }
      const results = await race;
      const accepted = results[1]!.status === 'fulfilled';
      if (action === 'resend') expect(accepted).toBe(true);
      expect(await inspect.acceptAuditCount(invitation.id)).toBe(
        accepted ? 1 : 0,
      );
      expect(!!(await inspect.member(recipient.userId, team.id))).toBe(
        accepted,
      );
      if (accepted)
        await harness.identity(owner.cookieHeaders, async (identity) => {
          await expect(
            service.resend(identity, invitation.id),
          ).rejects.toMatchObject({ status: 403 });
        });
      else
        await harness.identity(recipient.cookieHeaders, async (identity) => {
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

test('a committed email change during acceptance is re-read before recipient authorization', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const owner = await proof.signIn({
      body: {
        name: 'Email race owner',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const recipient = await proof.signIn({
      body: {
        name: 'Email race recipient',
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
    const held = await inspect.holdEmailChange(
      recipient.userId,
      `${randomUUID()}@example.test`,
    );
    const outcome = harness
      .identity(recipient.cookieHeaders, (identity) =>
        service.accept(identity, invitation.id),
      )
      .then(
        () => null,
        (error) => error as unknown,
      );
    try {
      await held.waitForAuthWaiter();
    } finally {
      await held.release();
    }
    expect(await outcome).toMatchObject({ status: 403 });
    expect(await inspect.member(recipient.userId, team.id)).toBeNull();
    expect(await inspect.acceptAuditCount(invitation.id)).toBe(0);
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});
