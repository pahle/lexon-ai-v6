import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createInvitationInspector } from '../../src/infrastructure/db/testing/invitation-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/index.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { MembershipService } from '../../src/modules/organizations/membership.service.js';
import { securityHarness, responseCookies } from '../setup/security-harness.js';
const password = 'Departure-audit-42!';
test('concurrent departures commit one ID-only audit and no outbox rows; removed sessions fall back', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const owner = await proof.signIn({
      body: {
        name: 'Departure owner',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const recipient = await proof.signIn({
      body: { name: 'Departure recipient', email, password },
    });
    const team = await organizations.seedTeam([owner.userId, recipient.userId]);
    await inspect.setRole(team.members[1]!.id, 'member');
    const harness = securityHarness(proof);
    const identities = new IdentitySessionService(proof.integration);
    const service = new MembershipService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    const second = responseCookies(
      await harness.run('/sign-in/email', { email, password }, new Headers()),
    );
    for (const headers of [recipient.cookieHeaders, second])
      await harness.identity(headers, (identity) =>
        identities.select(identity, team.id),
      );
    const before = await inspect.outboxCount();
    const remove = () =>
      harness.identity(owner.cookieHeaders, (identity) =>
        service.remove(identity, team.id, team.members[1]!.id),
      );
    const held = await organizations.hold(team.id);
    const raced = Promise.allSettled([remove(), remove()]);
    try {
      await held.waitForAuthWaiters(1);
    } finally {
      await held.release();
    }
    expect(
      (await raced).filter((row) => row.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await inspect.departureAudits(team.id)).toMatchObject([
      {
        actor_user_id: owner.userId,
        subject_user_id: recipient.userId,
        member_id: team.members[1]!.id,
        metadata: { reason: 'remove' },
      },
    ]);
    expect(await inspect.outboxCount()).toBe(before);
    for (const headers of [recipient.cookieHeaders, second])
      expect(
        (await identities.resolve(headers, { kind: 'workspace' })).summary,
      ).toMatchObject({
        organization: { kind: 'personal' },
        fallbackReason: 'membership_removed',
      });
    await harness.identity(recipient.cookieHeaders, async (identity) => {
      await expect(service.leave(identity, team.id)).rejects.toMatchObject({
        status: 403,
      });
    });
    expect(await inspect.outboxCount()).toBe(before);
  } finally {
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});
test('an audit failure rolls back native membership deletion and leaves the outbox unchanged', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const organizations = createOrganizationInspector(services);
  const inspect = createInvitationInspector(services);
  const audits = createAuditInspector(services);
  try {
    const users = await Promise.all(
      ['Owner', 'Leaving'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam(users.map((user) => user.userId));
    const harness = securityHarness(proof);
    const service = new MembershipService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    const before = await inspect.outboxCount();
    await audits.rejectInserts();
    await harness.identity(users[1]!.cookieHeaders, async (identity) => {
      await expect(service.leave(identity, team.id)).rejects.toThrow();
    });
    expect(await inspect.member(users[1]!.userId, team.id)).not.toBeNull();
    expect(await inspect.outboxCount()).toBe(before);
    expect(await inspect.departureAudits(team.id)).toEqual([]);
  } finally {
    await audits.close();
    await inspect.close();
    await organizations.close();
    await proof.close();
  }
});
