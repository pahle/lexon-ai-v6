import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/** Minimal query surface so spec files never import pg directly (the
 * database-owner boundary rule reserves pg imports for this directory). */
export type Queryable = Pick<PoolClient, 'query'>;

// F6 projects ("Matters") test scenario. One team organization holding six
// seeded users (an org owner who owns the project, an org admin without a
// project role, an editor, a viewer, a plain member and an outsider who only
// owns a personal organization), one project with member rows, instructions,
// three project-bound chats, one standalone chat and a completed answer run
// chain (ai_runs → chat_runs → ai_steps → ai_operations → chat_messages).
// Everything is written as lexon_migrator so RLS/policies never interfere
// with seeding; the write fence on ai_* rows is satisfied by binding the
// app.user_id GUC to the run/chat owner inside the seed transaction.
export interface ProjectScenario {
  orgId: string;
  users: {
    owner: string;
    admin: string;
    editor: string;
    viewer: string;
    member: string;
    outsider: string;
  };
  projectId: string;
  projectChatId: string;
  editorChatId: string;
  viewerChatId: string;
  standaloneChatId: string;
  runId: string;
  stepId: string;
  operationId: string;
  userMessageId: string;
  assistantMessageId: string;
}

export async function createProjectScenario(pools: {
  app: Pool;
  migrator: Pool;
}): Promise<ProjectScenario> {
  const { app, migrator } = pools;
  const scenario: ProjectScenario = {
    orgId: randomUUID(),
    users: {
      owner: randomUUID(),
      admin: randomUUID(),
      editor: randomUUID(),
      viewer: randomUUID(),
      member: randomUUID(),
      outsider: randomUUID(),
    },
    projectId: randomUUID(),
    projectChatId: randomUUID(),
    editorChatId: randomUUID(),
    viewerChatId: randomUUID(),
    standaloneChatId: randomUUID(),
    runId: randomUUID(),
    stepId: randomUUID(),
    operationId: randomUUID(),
    userMessageId: randomUUID(),
    assistantMessageId: randomUUID(),
  };
  const { orgId, users, projectId } = scenario;
  const client = await migrator.connect();
  try {
    await client.query('BEGIN');
    const people = Object.values(users)
      .map(
        (id) =>
          `('${id}','F6 user','${id}@example.test',true,clock_timestamp(),clock_timestamp(),true,false)`,
      )
      .join(',');
    await client.query(
      `INSERT INTO auth."user"(id,name,email,email_verified,created_at,updated_at,onboarding_complete,pending_admin_activation)
       VALUES ${people}`,
    );
    await client.query(
      `INSERT INTO auth.organization(id,name,slug,created_at,kind,state)
       VALUES ('${orgId}','F6 access team','f6-${randomUUID()}',clock_timestamp(),'team','active')`,
    );
    await client.query(
      `INSERT INTO auth.member(organization_id,user_id,role,created_at) VALUES
       ('${orgId}','${users.owner}','owner',clock_timestamp()),
       ('${orgId}','${users.admin}','admin',clock_timestamp()),
       ('${orgId}','${users.editor}','member',clock_timestamp()),
       ('${orgId}','${users.viewer}','member',clock_timestamp()),
       ('${orgId}','${users.member}','member',clock_timestamp())`,
    );
    // The ai_* write fence requires the session user to be the chat/run owner.
    await client.query(
      `SELECT set_config('app.user_id','${users.owner}',true)`,
    );
    await client.query(
      `INSERT INTO app.projects(id,org_id,owner_user_id,name,matter_number,practice_area)
       VALUES ('${projectId}','${orgId}','${users.owner}','F6 matter','F6-001','litigation')`,
    );
    await client.query(
      `INSERT INTO app.project_members(org_id,project_id,user_id,role) VALUES
       ('${orgId}','${projectId}','${users.editor}','editor'),
       ('${orgId}','${projectId}','${users.viewer}','viewer')`,
    );
    await client.query(
      `INSERT INTO app.project_instructions(org_id,project_id,"text",updated_by_user_id)
       VALUES ('${orgId}','${projectId}','seed instructions','${users.owner}')`,
    );
    await client.query(
      `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id) VALUES
       ('${scenario.projectChatId}','${orgId}','${users.owner}','project chat','${projectId}'),
       ('${scenario.editorChatId}','${orgId}','${users.editor}','editor chat','${projectId}'),
       ('${scenario.viewerChatId}','${orgId}','${users.viewer}','viewer chat','${projectId}'),
       ('${scenario.standaloneChatId}','${orgId}','${users.owner}','standalone chat',NULL)`,
    );
    await client.query(
      `INSERT INTO app.ai_runs(id,org_id,initiating_user_id,profile_id,profile_version,
         resolved_config,model_id,input_text,status,input_budget_tokens,output_budget_tokens,
         final_output,completed_at)
       VALUES ('${scenario.runId}','${orgId}','${users.owner}','test-profile',1,
         '{"resourceIds":["${scenario.projectChatId}"]}','synthetic/test','seed input',
         'completed',1000,1000,'done',clock_timestamp())`,
    );
    await client.query(
      `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
       VALUES ('${orgId}','${scenario.projectChatId}','${scenario.runId}','answer')`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // ai_steps carries no lexon_migrator INSERT policy, so it is written
  // through the app role — tenant claims bound to the run initiator make
  // the owner-run fence pass (resourceIds is non-empty).
  await withAppTenant(app, { orgId, userId: users.owner }, async (c) => {
    await c.query(
      `INSERT INTO app.ai_steps(id,org_id,run_id,sequence,expected_version,state,fence)
       VALUES ('${scenario.stepId}','${orgId}','${scenario.runId}',1,1,'committed',1)`,
    );
  });
  const tail = await migrator.connect();
  try {
    await tail.query('BEGIN');
    // The chat resource write fence trigger reads app.user_id and requires
    // it to equal the chat owner and run initiator.
    await tail.query(`SELECT set_config('app.user_id','${users.owner}',true)`);
    await tail.query(
      `INSERT INTO app.ai_operations(id,org_id,run_id,step_id,call_occurrence,tool_name,
         tool_version,idempotency_mode,args,args_hash,snapshot_hash,approval_required,
         status,result,completed_at)
       VALUES ('${scenario.operationId}','${orgId}','${scenario.runId}','${scenario.stepId}',
         0,'fixture-tool',1,'read','{}',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         false,'succeeded','{}',clock_timestamp())`,
    );
    await tail.query(
      `INSERT INTO app.chat_messages(id,org_id,chat_id,parent_message_id,role,user_text,effort)
       VALUES ('${scenario.userMessageId}','${orgId}','${scenario.projectChatId}',NULL,'user','seed question','high')`,
    );
    await tail.query(
      `INSERT INTO app.chat_messages(id,org_id,chat_id,parent_message_id,role,run_id)
       VALUES ('${scenario.assistantMessageId}','${orgId}','${scenario.projectChatId}',
         '${scenario.userMessageId}','assistant','${scenario.runId}')`,
    );
    await tail.query('COMMIT');
    return scenario;
  } catch (error) {
    await tail.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    tail.release();
  }
}

/** Writes a `project_denies` row directly as lexon_migrator (bypassing the
 * `lexon_project_deny_add` definer, which refuses owner targets). */
export async function projectDeny(
  migrator: Pool,
  input: {
    orgId: string;
    projectId: string;
    userId: string;
    setByUserId: string;
  },
): Promise<void> {
  await migrator.query(
    `INSERT INTO app.project_denies(org_id,project_id,user_id,set_by_user_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id,project_id,user_id) DO NOTHING`,
    [input.orgId, input.projectId, input.userId, input.setByUserId],
  );
}

/** Deletes a `project_members` row directly as lexon_migrator (member removal
 * without a deny row). */
export async function projectMemberRemove(
  migrator: Pool,
  input: { orgId: string; projectId: string; userId: string },
): Promise<void> {
  await migrator.query(
    `DELETE FROM app.project_members
     WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
    [input.orgId, input.projectId, input.userId],
  );
}

/** Writes a `chat_shares` row directly as lexon_migrator (share rows that a
 * service path would refuse, e.g. shares on project chats, are seeded this
 * way so the read-arm semantics can be exercised). */
export async function chatShare(
  migrator: Pool,
  input: {
    orgId: string;
    chatId: string;
    userId: string;
    grantedByUserId: string;
  },
): Promise<void> {
  await migrator.query(
    `INSERT INTO app.chat_shares(org_id,chat_id,user_id,granted_by_user_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id,chat_id,user_id) DO NOTHING`,
    [input.orgId, input.chatId, input.userId, input.grantedByUserId],
  );
}

/** Runs `fn` on a lexon_app connection inside one transaction with the
 * tenant claims bound via set_config (the psqlInTenant pattern). The
 * transaction commits when `fn` resolves so successful writes persist for
 * later assertions; expected failures belong inside a savepoint. */
export async function withAppTenant<T>(
  app: Pool,
  tenant: { orgId: string; userId: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.org_id',$1,true), set_config('app.user_id',$2,true)",
      [tenant.orgId, tenant.userId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Returns the PG error code ('42501', '23514', …) or 'unknown'. */
export function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'unknown';
}
