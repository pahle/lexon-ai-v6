import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';

test('active teams require an owner at commit and permit atomic create plus owner', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createOrganizationInspector(services);
  try {
    const user = await proof.signIn({
      body: {
        name: 'Invariant owner',
        email: `${randomUUID()}@example.test`,
        password: 'Invariant-password-42!',
      },
    });
    await expect(inspect.bareTeam()).rejects.toMatchObject({ code: '23514' });
    const team = await inspect.seedTeam([user.userId]);
    await expect(
      inspect.mutateMember(team.members[0]!.id, 'delete'),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      inspect.mutateMember(team.members[0]!.id, 'demote'),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await inspect.owners(team.id)).toBe(1);
    await expect(
      inspect.invalidRole(team.members[0]!.id),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      inspect.duplicateMember(team.id, user.userId),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(inspect.deleteTeam(team.id)).rejects.toMatchObject({
      code: '23514',
    });
    expect(await inspect.owners(team.id)).toBe(1);
  } finally {
    await inspect.close();
    await proof.close();
  }
});

test('provisioning is memberless and has one current first-owner invitation', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createOrganizationInspector(services);
  try {
    const user = await proof.signIn({
      body: {
        name: 'Provisioning operator',
        email: `${randomUUID()}@example.test`,
        password: 'Provisioning-password-42!',
      },
    });
    const id = await inspect.seedProvisioning(user.userId);
    expect(await inspect.owners(id)).toBe(0);
    await expect(
      inspect.seedProvisioning(user.userId, false),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      inspect.seedProvisioning(user.userId, true, true),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await inspect.close();
    await proof.close();
  }
});

for (const isolation of [
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
] as const)
  for (const action of ['delete', 'demote'] as const)
    test(`two privileged owner ${action}s preserve an owner under ${isolation}`, async ({
      services,
    }) => {
      const proof = await createAuthFixture(services);
      const inspect = createOrganizationInspector(services);
      try {
        const users = await Promise.all(
          [1, 2].map((index) =>
            proof.signIn({
              body: {
                name: `Concurrent owner ${index}`,
                email: `${randomUUID()}@example.test`,
                password: 'Concurrent-password-42!',
              },
            }),
          ),
        );
        const team = await inspect.seedTeam(users.map((user) => user.userId));
        const result = await inspect.race(
          team.id,
          team.members.map((member) => member.id),
          action,
          isolation,
        );
        expect(result.owners).toBe(1);
        expect(result.committed.filter(Boolean)).toHaveLength(1);
        expect(result.blocked).toBe(true);
        expect(['23514', '40001', '40P01']).toContain(result.secondCode);
      } finally {
        await inspect.close();
        await proof.close();
      }
    });

for (const action of ['leave', 'demote', 'remove'] as const)
  test(`concurrent native ${action} calls cannot remove both owners`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    const inspect = createOrganizationInspector(services);
    let held: Awaited<ReturnType<typeof inspect.hold>> | undefined;
    try {
      const users = await Promise.all(
        [1, 2].map((index) =>
          proof.signIn({
            body: {
              name: `Native owner ${index}`,
              email: `${randomUUID()}@example.test`,
              password: 'Native-owner-password-42!',
            },
          }),
        ),
      );
      const team = await inspect.seedTeam(users.map((user) => user.userId));
      held = await inspect.hold(team.id);
      let settled = 0;
      const pending = users.map((user, index) =>
        proof.integration
          .transaction(async (tx) => {
            const memberId = team.members[index]!.id;
            if (action === 'leave') {
              await tx.call('leaveOrganization', {
                headers: user.cookieHeaders,
                body: { organizationId: team.id },
              });
            } else if (action === 'demote') {
              await tx.call('updateMemberRole', {
                headers: user.cookieHeaders,
                body: { organizationId: team.id, memberId, role: 'member' },
              });
            } else {
              await tx.call('removeMember', {
                headers: user.cookieHeaders,
                body: { organizationId: team.id, memberIdOrEmail: memberId },
              });
            }
          })
          .then(
            () => {
              settled++;
              return true;
            },
            () => {
              settled++;
              return false;
            },
          ),
      );
      await held.waitForAuthWaiters(2, () => settled === 2);
      await held.release();
      expect((await Promise.all(pending)).filter(Boolean)).toHaveLength(1);
      expect(await inspect.owners(team.id)).toBe(1);
    } finally {
      await held?.release();
      await inspect.close();
      await proof.close();
    }
  });
