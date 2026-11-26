import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  createProjectScenario,
  errorCode,
  projectDeny,
  projectMemberRemove,
  withAppTenant,
  type ProjectScenario,
  type Queryable,
} from '../../src/infrastructure/db/testing/project-fixture.js';

// F6 §4.3/§6: the RLS layer itself enforces the ethical wall. Every claim
// below runs as lexon_app with app.org_id/app.user_id bound via set_config —
// never through a service — and deny rows are written as lexon_migrator so
// the structural deny>owner case (which the definer refuses at the service
// layer) is still exercised.

async function projectCounts(
  client: Queryable,
  scenario: ProjectScenario,
): Promise<Record<string, number>> {
  const row = (
    await client.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM app.chats WHERE project_id=$1) AS chats,
         (SELECT count(*) FROM app.chat_messages WHERE chat_id IN
           (SELECT id FROM app.chats WHERE project_id=$1)) AS chat_messages,
         (SELECT count(*) FROM app.chat_runs WHERE chat_id IN
           (SELECT id FROM app.chats WHERE project_id=$1)) AS chat_runs,
         (SELECT count(*) FROM app.ai_runs WHERE id=$2) AS ai_runs,
         (SELECT count(*) FROM app.ai_operations WHERE id=$3) AS ai_operations,
         (SELECT count(*) FROM app.projects WHERE id=$1) AS projects,
         (SELECT count(*) FROM app.project_members WHERE project_id=$1)
           AS project_members,
         (SELECT count(*) FROM app.project_instructions WHERE project_id=$1)
           AS project_instructions`,
      [scenario.projectId, scenario.runId, scenario.operationId],
    )
  ).rows[0]!;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  );
}

const ZERO_PROJECT_ROWS = {
  chats: 0,
  chat_messages: 0,
  chat_runs: 0,
  ai_runs: 0,
  ai_operations: 0,
  projects: 0,
  project_members: 0,
  project_instructions: 0,
};

test('a denied project member gets zero rows from every project table and artifact', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.editor,
      setByUserId: scenario.users.admin,
    });
    const counts = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.editor },
      (client) => projectCounts(client, scenario),
    );
    expect(counts).toEqual(ZERO_PROJECT_ROWS);
    // The denied editor's own project chat is invisible too — deny wins over
    // both ownership and the (stale) member row.
    const ownChat = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.editor },
      async (client) =>
        (
          await client.query<{ count: string }>(
            'SELECT count(*) FROM app.chats WHERE id=$1',
            [scenario.editorChatId],
          )
        ).rows[0]!.count,
    );
    expect(Number(ownChat)).toBe(0);
  } finally {
    await pools.close();
  }
});

test('a denied project owner gets zero rows from the project and their own project chats', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    // Deny written directly as migrator: the service definer refuses owner
    // targets, so this proves deny>owner structurally at the policy layer.
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    const counts = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      (client) => projectCounts(client, scenario),
    );
    expect(counts).toEqual(ZERO_PROJECT_ROWS);
    const visible = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) => ({
        ownProjectChat: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.chats WHERE id=$1',
              [scenario.projectChatId],
            )
          ).rows[0]!.count,
        ),
        standaloneChat: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.chats WHERE id=$1',
              [scenario.standaloneChatId],
            )
          ).rows[0]!.count,
        ),
      }),
    );
    // The owner arm is disjoint by project_id: deny strips the project chat
    // but leaves the owner's standalone chat untouched.
    expect(visible).toEqual({ ownProjectChat: 0, standaloneChat: 1 });
  } finally {
    await pools.close();
  }
});

test('a member removed without a deny loses their own project chats', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    await projectMemberRemove(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.viewer,
    });
    const rows = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.viewer },
      async (client) => ({
        ownChat: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.chats WHERE id=$1',
              [scenario.viewerChatId],
            )
          ).rows[0]!.count,
        ),
        chats: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.chats WHERE project_id=$1',
              [scenario.projectId],
            )
          ).rows[0]!.count,
        ),
        chatRuns: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.chat_runs WHERE chat_id=$1',
              [scenario.projectChatId],
            )
          ).rows[0]!.count,
        ),
        aiRuns: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.ai_runs WHERE id=$1',
              [scenario.runId],
            )
          ).rows[0]!.count,
        ),
      }),
    );
    expect(rows).toEqual({ ownChat: 0, chats: 0, chatRuns: 0, aiRuns: 0 });
  } finally {
    await pools.close();
  }
});

test('an org admin non-member sees the project row but no instructions, members or chats', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const rows = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.admin },
      async (client) => ({
        projects: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.projects WHERE id=$1',
              [scenario.projectId],
            )
          ).rows[0]!.count,
        ),
        instructions: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.project_instructions WHERE project_id=$1',
              [scenario.projectId],
            )
          ).rows[0]!.count,
        ),
        members: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.project_members WHERE project_id=$1',
              [scenario.projectId],
            )
          ).rows[0]!.count,
        ),
        chats: Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.chats WHERE project_id=$1',
              [scenario.projectId],
            )
          ).rows[0]!.count,
        ),
      }),
    );
    // Metadata-only arm: the row is listed, content-level tables stay closed.
    expect(rows).toEqual({
      projects: 1,
      instructions: 0,
      members: 0,
      chats: 0,
    });
  } finally {
    await pools.close();
  }
});

test('a denied org admin loses the projects row too — deny beats admin', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.admin,
      setByUserId: scenario.users.owner,
    });
    const projects = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.admin },
      async (client) =>
        Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.projects WHERE id=$1',
              [scenario.projectId],
            )
          ).rows[0]!.count,
        ),
    );
    expect(projects).toBe(0);
  } finally {
    await pools.close();
  }
});

test('selects on every new table terminate without infinite recursion', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.member,
      setByUserId: scenario.users.admin,
    });
    // A member (viewer role) claim evaluates the full policy DAG:
    // chats -> {definers, chat_shares}, project tables -> definers. Any
    // "infinite recursion detected in policy" error fails the query itself.
    const rows = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.viewer },
      async (client) =>
        (
          await client.query<{
            projects: string;
            members: string;
            instructions: string;
            denies: string;
            shares: string;
          }>(
            `SELECT
               (SELECT count(*) FROM app.projects) AS projects,
               (SELECT count(*) FROM app.project_members) AS members,
               (SELECT count(*) FROM app.project_instructions) AS instructions,
               (SELECT count(*) FROM app.project_denies) AS denies,
               (SELECT count(*) FROM app.chat_shares) AS shares`,
          )
        ).rows[0]!,
    );
    expect({
      projects: Number(rows.projects),
      members: Number(rows.members),
      instructions: Number(rows.instructions),
      denies: Number(rows.denies),
      shares: Number(rows.shares),
    }).toEqual({
      projects: 1,
      members: 2,
      instructions: 1,
      denies: 0,
      shares: 0,
    });
    // Org admins see deny rows through the admin arm — still acyclic.
    const adminDenies = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.admin },
      async (client) =>
        Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.project_denies WHERE project_id=$1',
              [scenario.projectId],
            )
          ).rows[0]!.count,
        ),
    );
    expect(adminDenies).toBe(1);
  } finally {
    await pools.close();
  }
});

test('lexon_project_access returns a single level column and fails closed', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const otherOrg = randomUUID();
    const levels = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.viewer },
      async (client) => {
        const self = (
          await client.query<{ lexon_project_access: string }>(
            'SELECT ops.lexon_project_access($1,$2,$3)',
            [scenario.orgId, scenario.projectId, scenario.users.viewer],
          )
        ).rows[0]!;
        const wrongUser = (
          await client.query<{ lexon_project_access: string }>(
            'SELECT ops.lexon_project_access($1,$2,$3)',
            [scenario.orgId, scenario.projectId, scenario.users.owner],
          )
        ).rows[0]!;
        const wrongOrg = (
          await client.query<{ lexon_project_access: string }>(
            'SELECT ops.lexon_project_access($1,$2,$3)',
            [otherOrg, scenario.projectId, scenario.users.viewer],
          )
        ).rows[0]!;
        return { self, wrongUser, wrongOrg };
      },
    );
    // Exactly one text column whose value is a known level.
    expect(Object.keys(levels.self)).toEqual(['lexon_project_access']);
    expect(levels.self.lexon_project_access).toBe('viewer');
    // A caller can never probe another user's standing.
    expect(levels.wrongUser.lexon_project_access).toBe('none');
    expect(levels.wrongOrg.lexon_project_access).toBe('none');
    const ownerLevel = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{ lexon_project_access: string }>(
            'SELECT ops.lexon_project_access($1,$2,$3)',
            [scenario.orgId, scenario.projectId, scenario.users.owner],
          )
        ).rows[0]!.lexon_project_access,
    );
    expect(ownerLevel).toBe('owner');
    const editorLevel = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.editor },
      async (client) =>
        (
          await client.query<{ lexon_project_access: string }>(
            'SELECT ops.lexon_project_access($1,$2,$3)',
            [scenario.orgId, scenario.projectId, scenario.users.editor],
          )
        ).rows[0]!.lexon_project_access,
    );
    expect(editorLevel).toBe('editor');
    const memberLevel = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.member },
      async (client) =>
        (
          await client.query<{ lexon_project_access: string }>(
            'SELECT ops.lexon_project_access($1,$2,$3)',
            [scenario.orgId, scenario.projectId, scenario.users.member],
          )
        ).rows[0]!.lexon_project_access,
    );
    expect(memberLevel).toBe('none');
  } finally {
    await pools.close();
  }
});

test('the deny definers refuse owner targets and self-lift; ungranted roles are denied', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    // deny_add refuses the project owner as target.
    const ownerRefusal = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.admin },
      async (client) => {
        try {
          await client.query('SELECT ops.lexon_project_deny_add($1,$2,$3,$4)', [
            scenario.orgId,
            scenario.projectId,
            scenario.users.admin,
            scenario.users.owner,
          ]);
          return 'allowed';
        } catch (error) {
          return (error as Error).message;
        }
      },
    );
    expect(ownerRefusal).toContain('project owner cannot be denied');
    // deny_add on a member succeeds, removes the member row, and is probeable
    // through the target-parameterized companion definer.
    const added = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.admin },
      async (client) => {
        const result = (
          await client.query<{
            lexon_project_deny_add: {
              denied: boolean;
              removedMember: boolean;
            };
          }>('SELECT ops.lexon_project_deny_add($1,$2,$3,$4)', [
            scenario.orgId,
            scenario.projectId,
            scenario.users.admin,
            scenario.users.viewer,
          ])
        ).rows[0]!.lexon_project_deny_add;
        const denied = (
          await client.query<{ lexon_project_denied: boolean }>(
            'SELECT ops.lexon_project_denied($1,$2,$3)',
            [scenario.orgId, scenario.projectId, scenario.users.viewer],
          )
        ).rows[0]!.lexon_project_denied;
        return { result, denied };
      },
    );
    expect(added).toEqual({
      result: { denied: true, removedMember: true },
      denied: true,
    });
    const memberRows = await pools.migrator.query<{ count: string }>(
      'SELECT count(*) FROM app.project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3',
      [scenario.orgId, scenario.projectId, scenario.users.viewer],
    );
    expect(Number(memberRows.rows[0]!.count)).toBe(0);
    // deny_lift refuses actor = target (no self-lift).
    const selfLift = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.admin },
      async (client) => {
        try {
          await client.query(
            'SELECT ops.lexon_project_deny_lift($1,$2,$3,$4)',
            [
              scenario.orgId,
              scenario.projectId,
              scenario.users.admin,
              scenario.users.admin,
            ],
          );
          return 'allowed';
        } catch (error) {
          return (error as Error).message;
        }
      },
    );
    expect(selfLift).toContain('cannot lift');
    // A different owner/admin lifts it.
    const lifted = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{ lexon_project_deny_lift: boolean }>(
            'SELECT ops.lexon_project_deny_lift($1,$2,$3,$4)',
            [
              scenario.orgId,
              scenario.projectId,
              scenario.users.owner,
              scenario.users.viewer,
            ],
          )
        ).rows[0]!.lexon_project_deny_lift,
    );
    expect(lifted).toBe(true);
    // deny_add requires an org owner/admin actor — a viewer is refused.
    const viewerRefusal = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.editor },
      async (client) => {
        try {
          await client.query('SELECT ops.lexon_project_deny_add($1,$2,$3,$4)', [
            scenario.orgId,
            scenario.projectId,
            scenario.users.editor,
            scenario.users.member,
          ]);
          return 'allowed';
        } catch (error) {
          return errorCode(error);
        }
      },
    );
    expect(viewerRefusal).toBe('42501');
    // Roles without EXECUTE get a plain permission denied.
    const authError = await pools.auth
      .query('SELECT ops.lexon_project_deny_add($1,$2,$3,$4)', [
        scenario.orgId,
        scenario.projectId,
        scenario.users.admin,
        scenario.users.member,
      ])
      .then(() => 'allowed')
      .catch(
        (error: unknown) => `${errorCode(error)} ${(error as Error).message}`,
      );
    expect(authError).toContain('42501');
    // lexon_auth lacks USAGE on ops as well as EXECUTE on the definer, so
    // the denial surfaces at whichever grant check fails first.
    expect(authError).toMatch(/permission denied for (schema|function)/);
  } finally {
    await pools.close();
  }
});
