import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { OrganizationSummarySchema } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/organization-auth.port.js';
import { OrganizationService } from '../../src/modules/organizations/organization.service.js';
import { securityHarness } from '../setup/security-harness.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { responseCookies } from '../setup/security-harness.js';
import { totpForUri } from '../setup/totp.js';

test('team create/settings/list are actor-bound, audited, paginated and preserve selection', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const audit = createAuditInspector(services);
  try {
    const owner = await proof.signIn({
      body: {
        name: 'Team creator',
        email: `${randomUUID()}@example.test`,
        password: 'Organization-password-42!',
      },
    });
    const outsider = await proof.signIn({
      body: {
        name: 'Outside user',
        email: `${randomUUID()}@example.test`,
        password: 'Organization-password-42!',
      },
    });
    const organizations = new OrganizationService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    const security = securityHarness(proof);
    let teamId = '';
    await security.identity(owner.cookieHeaders, async (identity) => {
      const before = await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: owner.cookieHeaders }),
      );
      const events = await audit.count('organization.created.v1');
      const team = await organizations.create(identity, {
        name: 'Team practice',
        slug: `team-${randomUUID()}`,
      });
      teamId = team.id;
      expect(OrganizationSummarySchema.parse(team)).toMatchObject({
        kind: 'team',
        state: 'active',
        role: 'owner',
      });
      expect(await audit.count('organization.created.v1')).toBe(events + 1);
      const after = await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers: owner.cookieHeaders }),
      );
      expect(after!.session.activeOrganizationId).toBe(
        before!.session.activeOrganizationId,
      );
      const first = await organizations.list(identity, { limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.pageInfo.nextCursor).not.toBeNull();
      const second = await organizations.list(identity, {
        limit: 1,
        cursor: first.pageInfo.nextCursor!,
      });
      expect(second.items).toHaveLength(1);
      expect(second.pageInfo.nextCursor).toBeNull();
      expect(
        new Set([...first.items, ...second.items].map((item) => item.kind)),
      ).toEqual(new Set(['personal', 'team']));
      const personal = [...first.items, ...second.items].find(
        (item) => item.kind === 'personal',
      )!;
      await expect(
        organizations.settings(identity, personal.id, { name: 'Forbidden' }),
      ).rejects.toMatchObject({ code: 'ORG_FORBIDDEN' });
      const renamed = await organizations.settings(identity, team.id, {
        name: 'Updated team',
        slug: `updated-${randomUUID()}`,
        require2fa: false,
      });
      expect(renamed).toMatchObject({
        name: 'Updated team',
        require2fa: false,
      });
      await expect(
        organizations.settings(identity, team.id, {
          state: 'provisioning',
        } as never),
      ).rejects.toBeDefined();
    });
    await security.identity(outsider.cookieHeaders, async (identity) => {
      expect(
        (await organizations.list(identity, {})).items.map((item) => item.kind),
      ).toEqual(['personal']);
      await expect(
        organizations.settings(identity, teamId, { name: 'Intrusion' }),
      ).rejects.toMatchObject({ code: 'ORG_FORBIDDEN' });
    });
  } finally {
    await audit.close();
    await proof.close();
  }
});

test('Personal-first pagination traverses every team once when Personal sorts last', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const fixture = createOrganizationInspector(services);
  try {
    const owner = await proof.signIn({
      body: {
        name: 'Pagination owner',
        email: `${randomUUID()}@example.test`,
        password: 'Organization-password-42!',
      },
    });
    const outsider = await proof.signIn({
      body: {
        name: 'Pagination outsider',
        email: `${randomUUID()}@example.test`,
        password: 'Organization-password-42!',
      },
    });
    const personal = await proof.inspect.personalFor(owner.userId);
    expect(personal).not.toBeNull();
    const firstTeam = '00000000-0000-4000-8000-000000000001';
    const secondTeam = '00000000-0000-4000-8000-000000000002';
    expect(personal!.orgId.localeCompare(secondTeam)).toBeGreaterThan(0);
    await fixture.seedTeam([owner.userId], firstTeam);
    await fixture.seedTeam([owner.userId], secondTeam);
    const organizations = new OrganizationService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    await securityHarness(proof).identity(
      owner.cookieHeaders,
      async (identity) => {
        for (const limit of [1, 2]) {
          const first = await organizations.list(identity, { limit });
          expect(first.items.map((organization) => organization.id)).toEqual(
            limit === 1 ? [personal!.orgId] : [personal!.orgId, firstTeam],
          );
          expect(first.pageInfo.nextCursor).toBe(
            limit === 1 ? personal!.orgId : firstTeam,
          );
          expect(first.pageInfo.nextCursor).toMatch(/^[0-9a-f-]{36}$/);
          const all = [...first.items];
          let cursor = first.pageInfo.nextCursor;
          do {
            const page = await organizations.list(identity, {
              limit,
              cursor: cursor!,
            });
            all.push(...page.items);
            cursor = page.pageInfo.nextCursor;
          } while (cursor !== null);
          expect(all.map((organization) => organization.id)).toEqual([
            personal!.orgId,
            firstTeam,
            secondTeam,
          ]);
          expect(all.map((organization) => organization.kind)).toEqual([
            'personal',
            'team',
            'team',
          ]);
          expect(new Set(all.map((organization) => organization.id)).size).toBe(
            all.length,
          );
        }
      },
    );
    await securityHarness(proof).identity(
      outsider.cookieHeaders,
      async (identity) => {
        const empty = await organizations.list(identity, { limit: 1 });
        expect(empty.items.map((organization) => organization.kind)).toEqual([
          'personal',
        ]);
        expect(empty.pageInfo.nextCursor).toBeNull();
        const page = await organizations.list(identity, {
          limit: 1,
          cursor: firstTeam,
        });
        expect(page.items.map((organization) => organization.id)).not.toContain(
          firstTeam,
        );
        expect(page.items.map((organization) => organization.id)).not.toContain(
          secondTeam,
        );
      },
    );
  } finally {
    await fixture.close();
    await proof.close();
  }
});

test('a target team MFA requirement cannot be disabled through a Personal session without MFA', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const user = await proof.signIn({
      body: { name: 'MFA owner', email, password: 'Organization-password-42!' },
    });
    const security = securityHarness(proof);
    const organizations = new OrganizationService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    let teamId = '';
    await security.identity(user.cookieHeaders, async (identity) => {
      const team = await organizations.create(identity, {
        name: 'Required MFA',
        slug: `required-${randomUUID()}`,
      });
      teamId = team.id;
      expect(
        await organizations.settings(identity, teamId, { require2fa: true }),
      ).toMatchObject({ require2fa: true });
      await expect(
        organizations.settings(identity, teamId, { require2fa: false }),
      ).rejects.toMatchObject({ code: 'AUTH_2FA_REQUIRED' });
    });
    const enrolled = await security.enroll(email, 'Organization-password-42!');
    await security.identity(enrolled.headers, async (identity) => {
      expect(
        await organizations.settings(identity, teamId, { require2fa: false }),
      ).toMatchObject({ require2fa: false });
    });
  } finally {
    await proof.close();
  }
});

test('a concurrent 2FA disable invalidates a previously minted MFA identity before mutation', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const password = 'Organization-password-42!';
    const email = `${randomUUID()}@example.test`;
    await proof.signIn({ body: { name: 'MFA race owner', email, password } });
    const security = securityHarness(proof);
    const organizations = new OrganizationService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    const enrolled = await security.enroll(email, password);
    const challenge = await security.run(
      '/sign-in/email',
      { email, password },
      new Headers(),
    );
    const second = responseCookies(
      await security.run(
        '/two-factor/verify-totp',
        { code: totpForUri(enrolled.totpURI) },
        responseCookies(challenge),
      ),
    );
    await security.identity(enrolled.headers, async (identity) => {
      const team = await organizations.create(identity, {
        name: 'MFA race',
        slug: `mfa-race-${randomUUID()}`,
      });
      await organizations.settings(identity, team.id, { require2fa: true });
      await security.run('/two-factor/disable', { password }, second);
      await expect(
        organizations.settings(identity, team.id, { require2fa: false }),
      ).rejects.toMatchObject({ code: 'AUTH_2FA_REQUIRED' });
    });
  } finally {
    await proof.close();
  }
});

test('owner policy is re-read after a concurrent actor demotion', async ({
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
            name: `Policy owner ${index}`,
            email: `${randomUUID()}@example.test`,
            password: 'Policy-owner-password-42!',
          },
        }),
      ),
    );
    const team = await inspect.seedTeam(users.map((user) => user.userId));
    held = await inspect.hold(team.id, team.members[0]!.id);
    const organizations = new OrganizationService(
      new OrganizationAuthPort(proof.integration),
      { pagination: { defaultLimit: 20, maxLimit: 100 } },
    );
    let settled = false;
    const pending = securityHarness(proof)
      .identity(users[0]!.cookieHeaders, (identity) =>
        organizations.settings(identity, team.id, { name: 'Stale privilege' }),
      )
      .then(
        () => {
          settled = true;
          return null;
        },
        (error) => {
          settled = true;
          return error as { code?: string };
        },
      );
    await held.waitForAuthWaiters(1, () => settled);
    await held.release();
    expect(await pending).toMatchObject({ code: 'ORG_FORBIDDEN' });
    expect(await inspect.name(team.id)).toBe('Fixture team');
  } finally {
    await held?.release();
    await inspect.close();
    await proof.close();
  }
});

for (const failures of [2, 3])
  test(`serialization retries are bounded and leave one or zero effects after ${failures} audit failures`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    const inspect = createOrganizationInspector(services);
    const audit = createAuditInspector(services);
    try {
      const user = await proof.signIn({
        body: {
          name: 'Retry owner',
          email: `${randomUUID()}@example.test`,
          password: 'Retry-owner-password-42!',
        },
      });
      await inspect.failAudits(failures);
      const organizations = new OrganizationService(
        new OrganizationAuthPort(proof.integration),
        { pagination: { defaultLimit: 20, maxLimit: 100 } },
      );
      const before = await audit.count('organization.created.v1');
      const create = securityHarness(proof).identity(
        user.cookieHeaders,
        (identity) =>
          organizations.create(identity, {
            name: 'Retried team',
            slug: `retried-${randomUUID()}`,
          }),
      );
      if (failures === 2)
        await expect(create).resolves.toMatchObject({
          kind: 'team',
          role: 'owner',
        });
      else await expect(create).rejects.toBeDefined();
      expect(await inspect.attempts()).toBe(3);
      expect(await inspect.teamCount(user.userId)).toBe(failures === 2 ? 1 : 0);
      expect(await audit.count('organization.created.v1')).toBe(
        before + (failures === 2 ? 1 : 0),
      );
    } finally {
      await audit.close();
      await inspect.close();
      await proof.close();
    }
  });
