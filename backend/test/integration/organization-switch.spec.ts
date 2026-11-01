import { randomUUID } from 'node:crypto';
import { createSelectionInspector } from '../../src/infrastructure/db/testing/selection-fixture.js';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { OrganizationSwitchService } from '../../src/modules/organizations/organization-switch.service.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { securityHarness, responseCookies } from '../setup/security-harness.js';
import { OrganizationService } from '../../src/modules/organizations/organization.service.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/organization-auth.port.js';
import { totpForUri } from '../setup/totp.js';

const password = 'Selection-password-42!';
test('switches are per session and stale repair cannot overwrite a newer explicit selection', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createOrganizationInspector(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const user = await proof.signIn({
      body: { name: 'Independent sessions', email, password },
    });
    const security = securityHarness(proof);
    const second = responseCookies(
      await security.run('/sign-in/email', { email, password }, new Headers()),
    );
    const firstTeam = await inspect.seedTeam([user.userId]);
    const secondTeam = await inspect.seedTeam([user.userId]);
    const identities = new IdentitySessionService(proof.integration);
    const switching = new OrganizationSwitchService(identities);
    const personal = await proof.inspect.personalFor(user.userId);
    await security.identity(user.cookieHeaders, async (identity) => {
      expect(await switching.select(identity, firstTeam.id)).toMatchObject({
        status: 'switched',
        organization: { id: firstTeam.id },
      });
    });
    expect(
      (await identities.resolve(second, { kind: 'workspace' })).summary
        .organization.id,
    ).toBe(personal!.orgId);
    await security.identity(second, (identity) =>
      switching.select(identity, secondTeam.id),
    );
    expect(
      (await identities.resolve(user.cookieHeaders, { kind: 'workspace' }))
        .summary.organization.id,
    ).toBe(firstTeam.id);
    expect(
      (await identities.resolve(second, { kind: 'workspace' })).summary
        .organization.id,
    ).toBe(secondTeam.id);
    const current = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: user.cookieHeaders }),
    );
    const old = await proof.integration.transaction((tx) =>
      tx.call('lexonSelectionFacts', {
        body: { userId: user.userId, sessionId: current!.session.id },
      }),
    );
    await security.identity(user.cookieHeaders, (identity) =>
      switching.select(identity, secondTeam.id),
    );
    const repaired = await proof.integration.transaction((tx) =>
      tx.call('lexonRepairSelection', {
        body: {
          userId: user.userId,
          sessionId: current!.session.id,
          expectedOrganizationId: old.session!.activeOrganizationId,
          expectedVersion: old.session!.selectionVersion,
          organizationId: personal!.orgId,
          pendingOrganizationId: null,
          expectedMemberId: old.personalMember!.id,
        },
      }),
    );
    expect(repaired.applied).toBe(false);
    expect(
      (await identities.resolve(user.cookieHeaders, { kind: 'workspace' }))
        .summary.organization.id,
    ).toBe(secondTeam.id);
    await security.identity(user.cookieHeaders, async (identity) => {
      await expect(
        switching.select(identity, randomUUID()),
      ).rejects.toMatchObject({ code: 'ORG_MEMBERSHIP_REQUIRED' });
    });
  } finally {
    await inspect.close();
    await proof.close();
  }
});

test('membership removal repairs to Personal using only the name saved by that session', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createOrganizationInspector(services);
  const selection = createSelectionInspector(services);
  try {
    const users = await Promise.all(
      [1, 2].map((index) =>
        proof.signIn({
          body: {
            name: `Fallback owner ${index}`,
            email: `${randomUUID()}@example.test`,
            password,
          },
        }),
      ),
    );
    const team = await inspect.seedTeam(users.map((user) => user.userId));
    const identities = new IdentitySessionService(proof.integration);
    const switching = new OrganizationSwitchService(identities);
    const security = securityHarness(proof);
    await security.identity(users[0]!.cookieHeaders, (identity) =>
      switching.select(identity, team.id),
    );
    await inspect.mutateMember(team.members[0]!.id, 'demote');
    expect(
      (await identities.resolve(users[0]!.cookieHeaders, { kind: 'workspace' }))
        .summary.organization.role,
    ).toBe('member');
    await inspect.mutateMember(team.members[0]!.id, 'delete');
    await selection.renameOrganization(team.id, 'No longer accessible name');
    const result = await identities.resolve(users[0]!.cookieHeaders, {
      kind: 'workspace',
    });
    expect(result.summary).toMatchObject({
      organization: { kind: 'personal', role: 'owner' },
      fallbackReason: 'membership_removed',
      previousOrganizationName: 'Fixture team',
    });
    expect(
      (await identities.resolve(users[0]!.cookieHeaders, { kind: 'workspace' }))
        .summary.fallbackReason,
    ).toBeUndefined();
  } finally {
    await selection.close();
    await inspect.close();
    await proof.close();
  }
});

for (const removed of [false, true])
  test(`MFA enrollment rechecks a pending target${removed ? ' removed during enrollment' : ''}`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    const inspect = createOrganizationInspector(services);
    try {
      const email = `${randomUUID()}@example.test`;
      const user = await proof.signIn({
        body: { name: 'Pending selection', email, password },
      });
      const other = await proof.signIn({
        body: {
          name: 'Other owner',
          email: `${randomUUID()}@example.test`,
          password,
        },
      });
      const security = securityHarness(proof);
      const headers = responseCookies(
        await security.run(
          '/sign-in/email',
          { email, password },
          new Headers(),
        ),
      );
      const team = await inspect.seedTeam([user.userId, other.userId]);
      const personal = await proof.inspect.personalFor(user.userId);
      const identities = new IdentitySessionService(proof.integration);
      const switching = new OrganizationSwitchService(identities);
      const organizations = new OrganizationService(
        new OrganizationAuthPort(proof.integration),
        { pagination: { defaultLimit: 20, maxLimit: 100 } },
      );
      await security.identity(headers, async (identity) => {
        await organizations.settings(identity, team.id, { require2fa: true });
        expect(await switching.select(identity, team.id)).toMatchObject({
          status: 'enrollment_required',
          organization: { id: personal!.orgId },
          pendingOrganizationId: team.id,
        });
      });
      expect(
        (await identities.resolve(headers, { kind: 'workspace' })).summary
          .organization.id,
      ).toBe(personal!.orgId);
      const setup = (await (
        await security.run('/two-factor/enable', { password }, headers)
      ).json()) as { totpURI: string };
      if (removed) await inspect.mutateMember(team.members[0]!.id, 'delete');
      const verified = responseCookies(
        await security.run(
          '/two-factor/verify-totp',
          { code: totpForUri(setup.totpURI) },
          headers,
        ),
      );
      const result = await identities.resolve(verified, { kind: 'workspace' });
      expect(result.summary.organization.id).toBe(
        removed ? personal!.orgId : team.id,
      );
      const stored = await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: verified }),
      );
      expect(stored!.session.pendingOrganizationId).toBeNull();
    } finally {
      await inspect.close();
      await proof.close();
    }
  });

test('every native session starts in its own Personal organization', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const identity = await proof.signIn({
      body: {
        name: 'Selection user',
        email: `${randomUUID()}@example.test`,
        password: 'Selection-password-42!',
      },
    });
    const personal = await proof.inspect.personalFor(identity.userId);
    const session = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: identity.cookieHeaders }),
    );
    expect(session!.session.activeOrganizationId).toBe(personal!.orgId);
  } finally {
    await proof.close();
  }
});

test('cookie expiry refresh respects the daily interval and does not refresh on every request', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createSelectionInspector(services);
  try {
    const user = await proof.signIn({
      body: {
        name: 'Refresh policy',
        email: `${randomUUID()}@example.test`,
        password,
      },
    });
    const session = await proof.integration.transaction((tx) =>
      tx.call('getSession', { headers: user.cookieHeaders }),
    );
    const identities = new IdentitySessionService(proof.integration);
    const cookies: string[][] = [];
    await identities.resolve(
      user.cookieHeaders,
      { kind: 'workspace' },
      (value) => cookies.push(value),
    );
    expect(cookies).toHaveLength(0);
    await inspect.ageExpiry(session!.session.id, 5 * 86400);
    await identities.resolve(
      user.cookieHeaders,
      { kind: 'workspace' },
      (value) => cookies.push(value),
    );
    expect(cookies).toHaveLength(1);
    expect(cookies[0]!.some((value) => value.includes('HttpOnly'))).toBe(true);
    await identities.resolve(
      user.cookieHeaders,
      { kind: 'workspace' },
      (value) => cookies.push(value),
    );
    expect(cookies).toHaveLength(1);
  } finally {
    await inspect.close();
    await proof.close();
  }
});
