import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { createTestApi } from '../setup/test-api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { securityHarness } from '../setup/security-harness.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { OrganizationSwitchService } from '../../src/modules/organizations/organization-switch.service.js';
import { DenySummarySchema } from '@lexon/contracts';

// F6 task 6: the ethical wall — /org/projects metadata list for org
// owners/admins (never instructions), deny add/lift through the 0043
// definers, the identical-404 matrix for denied callers, and the
// owner-deny / self-lift refusals with their audits.

const password = 'Ethical-wall-42!';

const jsonHeaders = (cookieHeaders: Headers) => {
  const headers = new Headers(cookieHeaders);
  headers.set('content-type', 'application/json');
  // The request policy refuses cookie-authenticated writes without the
  // configured public origin (CSRF).
  headers.set('origin', 'http://localhost:3000');
  return headers;
};

async function activate(
  proof: Awaited<ReturnType<typeof createAuthFixture>>,
  user: { cookieHeaders: Headers },
  orgId: string,
) {
  const security = securityHarness(proof);
  const switching = new OrganizationSwitchService(
    new IdentitySessionService(proof.integration),
  );
  await security.identity(user.cookieHeaders, (identity) =>
    switching.select(identity, orgId),
  );
}

async function createProject(
  origin: string,
  cookieHeaders: Headers,
  name: string,
) {
  const create = await fetch(`${origin}/api/projects`, {
    method: 'POST',
    headers: jsonHeaders(cookieHeaders),
    body: JSON.stringify({ name }),
  });
  expect(create.status).toBe(201);
  return (await create.json()) as { id: string };
}

const normalized404 = async (response: Response) => {
  const body = (await response.json()) as Record<string, unknown>;
  delete body.requestId;
  return body;
};

const denyPost = (
  origin: string,
  projectId: string,
  cookieHeaders: Headers,
  userId: string,
) =>
  fetch(`${origin}/api/org/projects/${projectId}/denies`, {
    method: 'POST',
    headers: jsonHeaders(cookieHeaders),
    body: JSON.stringify({ userId }),
  });

const denyDelete = (
  origin: string,
  projectId: string,
  cookieHeaders: Headers,
  userId: string,
) =>
  fetch(`${origin}/api/org/projects/${projectId}/denies/${userId}`, {
    method: 'DELETE',
    headers: jsonHeaders(cookieHeaders),
  });

test('org metadata list, deny add removes the member atomically, and denied callers get the identical 404', async ({
  services,
}) => {
  const env = createAuthEnvironment(services, '/tmp/lexon-ethical-wall.json');
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, { secret: env.AUTH_SECRET });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const signIn = (name: string) =>
      proof.signIn({
        body: { name, email: `${randomUUID()}@example.test`, password },
      });
    const [adminA, adminB, member] = await Promise.all([
      signIn('AdminA'),
      signIn('AdminB'),
      signIn('Member'),
    ]);
    const team = await organizations.seedTeam([
      adminA.userId,
      adminB.userId,
      member.userId,
    ]);
    await Promise.all(
      [adminA, adminB, member].map((user) => activate(proof, user, team.id)),
    );
    const project = await createProject(
      origin,
      adminA.cookieHeaders,
      'Walled matter',
    );
    await fetch(`${origin}/api/projects/${project.id}/members`, {
      method: 'POST',
      headers: jsonHeaders(adminA.cookieHeaders),
      body: JSON.stringify({ userId: member.userId, role: 'viewer' }),
    });

    // Org metadata list — admin sees id/name/matter/area/owner/counts and
    // NEVER instructions (or the caller's role).
    const metadata = await fetch(`${origin}/api/org/projects`, {
      headers: adminB.cookieHeaders,
    });
    expect(metadata.status).toBe(200);
    const page = (await metadata.json()) as {
      items: Record<string, unknown>[];
    };
    const row = page.items.find((item) => item.id === project.id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      name: 'Walled matter',
      memberCount: 1,
      restrictedCount: 0,
    });
    expect(row).not.toHaveProperty('instructions');
    expect(row).not.toHaveProperty('myRole');

    // Deny add removes the member row in the same transaction and audits
    // both events.
    const deny = await denyPost(
      origin,
      project.id,
      adminA.cookieHeaders,
      member.userId,
    );
    expect(deny.status).toBe(201);
    const memberRows = await pools.migrator.query(
      `SELECT user_id FROM app.project_members
        WHERE project_id=$1 AND user_id=$2`,
      [project.id, member.userId],
    );
    expect(memberRows.rows).toEqual([]);
    const audits = await pools.migrator.query(
      `SELECT type,metadata->>'reason' AS reason FROM ops.audit_events
        WHERE type IN ('project.deny_added.v1','project.member_removed.v1')
          AND metadata->>'projectId'=$1`,
      [project.id],
    );
    expect(audits.rows).toEqual(
      expect.arrayContaining([
        { type: 'project.deny_added.v1', reason: null },
        { type: 'project.member_removed.v1', reason: 'deny' },
      ]),
    );
    expect(audits.rows).toHaveLength(2);

    // The settings Restricted column counts live deny rows on the metadata
    // list — no identities, just the number.
    const afterDeny = await fetch(`${origin}/api/org/projects`, {
      headers: adminB.cookieHeaders,
    });
    expect(
      (
        (await afterDeny.json()) as { items: Record<string, unknown>[] }
      ).items.find((item) => item.id === project.id),
    ).toMatchObject({ restrictedCount: 1 });

    // A repeated deny inserts nothing: 201 against the existing row, no
    // second deny_added/member_removed audit.
    const repeat = await denyPost(
      origin,
      project.id,
      adminA.cookieHeaders,
      member.userId,
    );
    expect(repeat.status).toBe(201);
    const repeatAudits = await pools.migrator.query(
      `SELECT type FROM ops.audit_events
        WHERE type IN ('project.deny_added.v1','project.member_removed.v1')
          AND metadata->>'projectId'=$1`,
      [project.id],
    );
    expect(repeatAudits.rows).toHaveLength(2);

    // Denied member → byte-identical 404 on every project path.
    const fetch404 = (id: string) =>
      fetch(`${origin}/api/projects/${id}`, {
        headers: member.cookieHeaders,
      }).then(normalized404);
    const [real, ghost] = await Promise.all([
      fetch404(project.id),
      fetch404(randomUUID()),
    ]);
    expect(real).toEqual(ghost);
    const chats = await fetch(`${origin}/api/projects/${project.id}/chats`, {
      headers: member.cookieHeaders,
    });
    expect(chats.status).toBe(404);

    // Deny list exposes the row to admins with resolver fields.
    const denies = await fetch(
      `${origin}/api/org/projects/${project.id}/denies`,
      { headers: adminA.cookieHeaders },
    );
    expect(denies.status).toBe(200);
    const denyRows = ((await denies.json()) as { items: unknown[] }).items.map(
      (item) => DenySummarySchema.parse(item),
    );
    expect(denyRows).toMatchObject([
      { userId: member.userId, setByUserId: adminA.userId },
    ]);

    // A denied target cannot be re-added — "unavailable".
    const readd = await fetch(`${origin}/api/projects/${project.id}/members`, {
      method: 'POST',
      headers: jsonHeaders(adminA.cookieHeaders),
      body: JSON.stringify({ userId: member.userId, role: 'viewer' }),
    });
    expect(readd.status).toBe(422);

    // Deny beats admin: deny adminB (org admin, not the project owner) and
    // their metadata row disappears.
    const wall = await denyPost(
      origin,
      project.id,
      adminA.cookieHeaders,
      adminB.userId,
    );
    expect(wall.status).toBe(201);
    const blinded = await fetch(`${origin}/api/org/projects`, {
      headers: adminB.cookieHeaders,
    });
    expect(
      ((await blinded.json()) as { items: { id: string }[] }).items.find(
        (item) => item.id === project.id,
      ),
    ).toBeUndefined();
    // A peer lift restores the admin's metadata view.
    const lift = await denyDelete(
      origin,
      project.id,
      adminA.cookieHeaders,
      adminB.userId,
    );
    expect(lift.status).toBe(204);
    const restored = await fetch(`${origin}/api/org/projects`, {
      headers: adminB.cookieHeaders,
    });
    expect(
      ((await restored.json()) as { items: { id: string }[] }).items.find(
        (item) => item.id === project.id,
      ),
    ).toBeDefined();
  } finally {
    await proof.close();
    await organizations.close();
    await pools.close();
    await app.close();
  }
});

test('deny refuses the project owner at service and definer level', async ({
  services,
}) => {
  const env = createAuthEnvironment(
    services,
    '/tmp/lexon-ethical-wall-owner.json',
  );
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, { secret: env.AUTH_SECRET });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const [admin] = await Promise.all([
      proof.signIn({
        body: {
          name: 'Admin',
          email: `${randomUUID()}@example.test`,
          password,
        },
      }),
    ]);
    const team = await organizations.seedTeam([admin.userId]);
    await activate(proof, admin, team.id);
    const project = await createProject(
      origin,
      admin.cookieHeaders,
      'Owner-shielded',
    );

    const deny = await denyPost(
      origin,
      project.id,
      admin.cookieHeaders,
      admin.userId,
    );
    expect(deny.status).toBe(422);

    // Definer-level: claims-bound call as the same actor refuses identically.
    // Pinned client + session-scope set_config — pool clients rotate.
    const pinned = await pools.migrator.connect();
    let refused: unknown;
    try {
      await pinned.query(
        `SELECT set_config('app.org_id',$1,false),set_config('app.user_id',$2,false)`,
        [team.id, admin.userId],
      );
      refused = await pinned
        .query(`SELECT ops.lexon_project_deny_add($1,$2,$3,$4)`, [
          team.id,
          project.id,
          admin.userId,
          admin.userId,
        ])
        .then(() => null)
        .catch((error: { code?: string; constraint?: string }) => error);
    } finally {
      pinned.release();
    }
    expect(refused).toMatchObject({
      code: '42501',
      constraint: 'project_owner_deny',
    });
  } finally {
    await proof.close();
    await organizations.close();
    await pools.close();
    await app.close();
  }
});

test('self-deny is allowed, self-lift refused, a second admin lifts, and concurrent deny+lift both audit', async ({
  services,
}) => {
  const env = createAuthEnvironment(
    services,
    '/tmp/lexon-ethical-wall-lift.json',
  );
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, { secret: env.AUTH_SECRET });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const signIn = (name: string) =>
      proof.signIn({
        body: { name, email: `${randomUUID()}@example.test`, password },
      });
    const [adminA, adminB, member] = await Promise.all([
      signIn('AdminA'),
      signIn('AdminB'),
      signIn('Member'),
    ]);
    const team = await organizations.seedTeam([
      adminA.userId,
      adminB.userId,
      member.userId,
    ]);
    await Promise.all(
      [adminA, adminB, member].map((user) => activate(proof, user, team.id)),
    );
    const project = await createProject(
      origin,
      adminA.cookieHeaders,
      'Lift matter',
    );
    await fetch(`${origin}/api/projects/${project.id}/members`, {
      method: 'POST',
      headers: jsonHeaders(adminA.cookieHeaders),
      body: JSON.stringify({ userId: member.userId, role: 'editor' }),
    });

    // Self-deny is allowed (an admin walls themselves off a conflicted
    // matter); self-lift is refused.
    const selfDeny = await denyPost(
      origin,
      project.id,
      adminB.cookieHeaders,
      adminB.userId,
    );
    expect(selfDeny.status).toBe(201);
    const selfLift = await denyDelete(
      origin,
      project.id,
      adminB.cookieHeaders,
      adminB.userId,
    );
    expect(selfLift.status).toBe(422);
    const peerLift = await denyDelete(
      origin,
      project.id,
      adminA.cookieHeaders,
      adminB.userId,
    );
    expect(peerLift.status).toBe(204);

    // Concurrent deny+lift on the member: last commit wins, no duplicate
    // rows, every inserted/deleted row audited. The second deny audits
    // only when the lift commits first (it re-inserts); seen-after-commit
    // ordering leaves deny_added at the two earlier arms.
    const denyMember = () =>
      denyPost(origin, project.id, adminA.cookieHeaders, member.userId);
    const liftMember = () =>
      denyDelete(origin, project.id, adminB.cookieHeaders, member.userId);
    const first = await denyMember();
    const [second, lifted] = await Promise.all([denyMember(), liftMember()]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(lifted.status).toBe(204);
    const rows = await pools.migrator.query(
      `SELECT user_id FROM app.project_denies
        WHERE project_id=$1 AND user_id=$2`,
      [project.id, member.userId],
    );
    expect(rows.rows).toEqual([]);
    const audits = await pools.migrator.query<{ type: string }>(
      `SELECT type FROM ops.audit_events
        WHERE type IN ('project.deny_added.v1','project.deny_lifted.v1')
          AND metadata->>'projectId'=$1`,
      [project.id],
    );
    const added = audits.rows.filter(
      (row) => row.type === 'project.deny_added.v1',
    ).length;
    const liftedCount = audits.rows.filter(
      (row) => row.type === 'project.deny_lifted.v1',
    ).length;
    expect(added === 2 || added === 3).toBe(true);
    expect(liftedCount).toBe(2);
  } finally {
    await proof.close();
    await organizations.close();
    await pools.close();
    await app.close();
  }
});
