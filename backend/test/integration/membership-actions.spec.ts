import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createInvitationInspector } from '../../src/infrastructure/db/testing/invitation-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { MembershipService } from '../../src/modules/organizations/membership.service.js';
import { securityHarness } from '../setup/security-harness.js';
const password = 'Membership-actions-42!';
test('member role commands enforce actor and target matrix with owner safety', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const users = await Promise.all(
      ['Owner', 'Admin', 'Member', 'Outsider'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam(
      users.slice(0, 3).map((user) => user.userId),
    );
    await inspect.setRole(team.members[1]!.id, 'admin');
    await inspect.setRole(team.members[2]!.id, 'member');
    const harness = securityHarness(proof);
    const service = new MembershipService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    await harness.identity(users[3]!.cookieHeaders, async (identity) => {
      await expect(service.list(identity, team.id)).rejects.toMatchObject({
        status: 403,
      });
    });
    await harness.identity(users[2]!.cookieHeaders, async (identity) => {
      expect((await service.list(identity, team.id)).items).toHaveLength(3);
      await expect(
        service.changeRole(identity, team.id, team.members[1]!.id, 'member'),
      ).rejects.toMatchObject({ status: 403 });
    });
    await harness.identity(users[1]!.cookieHeaders, async (identity) => {
      await expect(
        service.changeRole(identity, team.id, team.members[0]!.id, 'member'),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.changeRole(identity, team.id, team.members[2]!.id, 'owner'),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await service.changeRole(
            identity,
            team.id,
            team.members[2]!.id,
            'admin',
          )
        ).role,
      ).toBe('admin');
      await expect(
        service.remove(identity, team.id, team.members[2]!.id),
      ).rejects.toMatchObject({ status: 403 });
    });
    await harness.identity(users[0]!.cookieHeaders, async (identity) => {
      await expect(service.leave(identity, team.id)).rejects.toMatchObject({
        code: 'ORG_LAST_OWNER',
      });
      expect(
        (
          await service.changeRole(
            identity,
            team.id,
            team.members[2]!.id,
            'owner',
          )
        ).role,
      ).toBe('owner');
      await service.leave(identity, team.id);
    });
    expect(await inspect.member(users[0]!.userId, team.id)).toBeNull();
    expect(await proof.inspect.personalFor(users[0]!.userId)).not.toBeNull();
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

test('actor demotion while remove is waiting cannot retain stale authority', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const users = await Promise.all(
      ['Owner', 'Admin', 'Target'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam(users.map((user) => user.userId));
    await inspect.setRole(team.members[1]!.id, 'admin');
    await inspect.setRole(team.members[2]!.id, 'member');
    const harness = securityHarness(proof);
    const service = new MembershipService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    const held = await inspect.holdRoleChange(team.members[1]!.id, 'member');
    const outcome = harness
      .identity(users[1]!.cookieHeaders, (identity) =>
        service.remove(identity, team.id, team.members[2]!.id),
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
    expect(await inspect.member(users[2]!.userId, team.id)).not.toBeNull();
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});

test('real role and removal commands exhaust every actor and target role combination', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const [keeper, actor, target] = await Promise.all(
      ['Keeper', 'Actor', 'Target'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([
      keeper!.userId,
      actor!.userId,
      target!.userId,
    ]);
    const harness = securityHarness(proof);
    const service = new MembershipService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    let targetMemberId: string = team.members[2]!.id;
    for (const actorRole of ['member', 'admin', 'owner'] as const)
      for (const targetRole of ['member', 'admin', 'owner'] as const) {
        await inspect.setRole(team.members[1]!.id, actorRole);
        for (const role of ['member', 'admin', 'owner'] as const) {
          await inspect.setRole(targetMemberId, targetRole);
          const allowed =
            actorRole === 'owner' ||
            (actorRole === 'admin' &&
              targetRole !== 'owner' &&
              role !== 'owner');
          await harness.identity(actor!.cookieHeaders, async (identity) => {
            const result = service.changeRole(
              identity,
              team.id,
              targetMemberId,
              role,
            );
            if (allowed) expect((await result).role).toBe(role);
            else await expect(result).rejects.toMatchObject({ status: 403 });
          });
        }
        await inspect.setRole(targetMemberId, targetRole);
        const allowed =
          actorRole === 'owner' ||
          (actorRole === 'admin' && targetRole === 'member');
        await harness.identity(actor!.cookieHeaders, async (identity) => {
          const result = service.remove(identity, team.id, targetMemberId);
          if (allowed) await result;
          else await expect(result).rejects.toMatchObject({ status: 403 });
        });
        if (allowed) {
          await inspect.addMember(team.id, target!.userId, targetRole);
          const replacement = await inspect.member(target!.userId, team.id);
          targetMemberId = replacement!.id;
        }
      }
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});
