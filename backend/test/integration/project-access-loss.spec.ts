import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  createProjectScenario,
  projectDeny,
  projectMemberRemove,
  withAppTenant,
  type ProjectScenario,
} from '../../src/infrastructure/db/testing/project-fixture.js';
import { decideRunCapabilities } from '../../src/modules/identity-access/run-capability-policy.js';

// F6 §9: the access-loss definer family. Every probe runs as lexon_app with
// the initiator claims bound — once the chat owner loses project access the
// run and its bound chat are RLS-invisible, so the settle moves through the
// definer side and returns ids/status only. Live run shapes are seeded like
// project-fixture.ts does: migrator for ai_runs/ai_operations, the app role
// with app.user_id bound for ai_steps (no migrator INSERT policy there).

interface LiveRun {
  runId: string;
  stepId: string;
  /** The step the seeded ops hang on — a committed prior step for the
   *  finalize shape, else the in-flight step itself. */
  opStepId: string;
  /** The in-flight step's sequence — the run's next_sequence. */
  headSequence: number;
  operationId: string;
  secondOperationId: string;
}

async function seedLiveRun(
  pools: { app: import('pg').Pool; migrator: import('pg').Pool },
  scenario: ProjectScenario,
  shape: {
    runStatus: 'running' | 'awaiting_approval';
    stepState: 'claimed' | 'awaiting_approval';
    /** 'approval' op row in awaiting_approval; 'question' varies the arm. */
    opKind: 'approval' | 'question';
    opExpiresAt: 'past' | 'future';
    /** Seed a sibling pending op settled alongside the main one. */
    siblingPending?: boolean;
    /**
     * The finalize arm only settles ops on steps *before* the in-flight step
     * (s.sequence < input_sequence); park the ops on a committed prior step.
     */
    priorStepOps?: boolean;
    /** Bound chat — defaults to the project chat. */
    chatId?: string;
  },
): Promise<LiveRun> {
  // The in-flight step sits at next_sequence — one ahead of the committed
  // prior step that carries the ops for the finalize shape.
  const headSequence = shape.priorStepOps ? 2 : 1;
  const stepId = randomUUID();
  const live: LiveRun = {
    runId: randomUUID(),
    stepId,
    opStepId: shape.priorStepOps ? randomUUID() : stepId,
    headSequence,
    operationId: randomUUID(),
    secondOperationId: randomUUID(),
  };
  const chatId = shape.chatId ?? scenario.projectChatId;
  const client = await pools.migrator.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id','${scenario.users.owner}',true)`,
    );
    // An active run row needs the capacity singleton for the admission
    // trigger (the fixture seeds only a completed run).
    await client.query(
      `INSERT INTO ops.ai_engine_capacity
       (singleton,max_active,max_active_per_org,terminal_slots,max_len,event_bytes,slot_bytes,memory_budget_bytes,config_fingerprint)
       VALUES(true,6,6,2,1024,4096,6291456,1073741824,'f6-access-loss-spec')
       ON CONFLICT(singleton) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO app.ai_runs(id,org_id,initiating_user_id,profile_id,profile_version,
         resolved_config,model_id,input_text,status,input_budget_tokens,output_budget_tokens,
         run_version,next_sequence)
       VALUES ($1,$2,$3,'project-chat',1,
         jsonb_build_object('resourceIds',jsonb_build_array($4::text),'provider','test-provider','profileSnapshot','{"capabilities":[]}'::jsonb),
         'synthetic/test','seed input',$5,1000,1000,1,$6)`,
      [
        live.runId,
        scenario.orgId,
        scenario.users.owner,
        chatId,
        shape.runStatus,
        headSequence,
      ],
    );
    await client.query(
      `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
       VALUES ($1,$2,$3,'answer')`,
      [scenario.orgId, chatId, live.runId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // ai_steps carries no lexon_migrator INSERT policy, so it is written through
  // the app role — and it must exist before the ops that reference it.
  await withAppTenant(
    pools.app,
    { orgId: scenario.orgId, userId: scenario.users.owner },
    async (c) => {
      if (live.opStepId !== live.stepId) {
        await c.query(
          `INSERT INTO app.ai_steps(id,org_id,run_id,sequence,expected_version,state,fence)
           VALUES ($1,$2,$3,1,1,'committed',1)`,
          [live.opStepId, scenario.orgId, live.runId],
        );
      }
      await c.query(
        `INSERT INTO app.ai_steps(id,org_id,run_id,sequence,expected_version,state,fence)
         VALUES ($1,$2,$3,$4,1,$5,1)`,
        [
          live.stepId,
          scenario.orgId,
          live.runId,
          headSequence,
          shape.stepState,
        ],
      );
    },
  );
  const tail = await pools.migrator.connect();
  try {
    await tail.query('BEGIN');
    // The chat resource write fence trigger reads app.user_id and requires it
    // to equal the chat owner and run initiator.
    await tail.query(
      `SELECT set_config('app.user_id','${scenario.users.owner}',true)`,
    );
    const expires =
      shape.opExpiresAt === 'past'
        ? `clock_timestamp()-interval '1 hour'`
        : `clock_timestamp()+interval '24 hours'`;
    await tail.query(
      `INSERT INTO app.ai_operations(id,org_id,run_id,step_id,call_occurrence,tool_name,
         tool_version,idempotency_mode,args,args_hash,snapshot_hash,approval_required,
         status,kind,expires_at)
       VALUES ($1,$2,$3,$4,0,'fixture-tool',1,'read','{}',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         true,'awaiting_approval',$5,${expires})`,
      [
        live.operationId,
        scenario.orgId,
        live.runId,
        live.opStepId,
        shape.opKind,
      ],
    );
    if (shape.siblingPending) {
      await tail.query(
        `INSERT INTO app.ai_operations(id,org_id,run_id,step_id,call_occurrence,tool_name,
           tool_version,idempotency_mode,args,args_hash,snapshot_hash,approval_required,
           status,kind)
         VALUES ($1,$2,$3,$4,1,'fixture-sibling',1,'read','{}',
           'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
           'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
           false,'pending','approval')`,
        [live.secondOperationId, scenario.orgId, live.runId, live.opStepId],
      );
    }
    await tail.query('COMMIT');
  } catch (error) {
    await tail.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    tail.release();
  }
  return live;
}

async function runRow(pools: { migrator: import('pg').Pool }, runId: string) {
  return (
    await pools.migrator.query<{
      status: string;
      error_code: string | null;
      run_version: number;
      next_sequence: number;
    }>(
      `SELECT status,error_code,run_version,next_sequence
         FROM app.ai_runs WHERE id=$1`,
      [runId],
    )
  ).rows[0];
}

async function auditCount(
  pools: { migrator: import('pg').Pool },
  type: string,
  runId: string,
) {
  return Number(
    (
      await pools.migrator.query<{ count: string }>(
        `SELECT count(*) FROM ops.audit_events
           WHERE type=$1 AND metadata->>'runId'=$2`,
        [type, runId],
      )
    ).rows[0]!.count,
  );
}

const basePolicyFacts = {
  phase: 'decision' as const,
  actorUserId: '10000000-0000-4000-8000-000000000001',
  initiatingUserId: '10000000-0000-4000-8000-000000000001',
  emailVerified: true,
  banned: false,
  twoFactorEnabled: false,
  mfaVerifiedAt: null,
  membershipRole: 'member' as const,
  organizationKind: 'team' as const,
  organizationState: 'active' as const,
  require2fa: false,
  capabilities: ['chat.ask'],
  projectId: '40000000-0000-4000-8000-000000000001',
  ownerProjectRole: 'owner' as const,
  ownerDenied: false,
};

test('the capability gate walls off denied owners, viewer standing and standalone project-chat runs', () => {
  const projectChat = { ...basePolicyFacts, profileId: 'project-chat' };
  expect(decideRunCapabilities(projectChat).allowed).toBe(true);
  expect(
    decideRunCapabilities({ ...projectChat, ownerDenied: true }).allowed,
  ).toBe(false);
  expect(
    decideRunCapabilities({ ...projectChat, ownerProjectRole: 'viewer' })
      .allowed,
  ).toBe(false);
  expect(
    decideRunCapabilities({ ...projectChat, ownerProjectRole: null }).allowed,
  ).toBe(false);
  // A standalone run can never wear the project profile, and a project-bound
  // chat can never run 'chat' (the project context would silently drop).
  expect(
    decideRunCapabilities({ ...projectChat, projectId: null }).allowed,
  ).toBe(false);
  expect(
    decideRunCapabilities({
      ...basePolicyFacts,
      profileId: 'chat',
    }).allowed,
  ).toBe(false);
  // A standalone 'chat' run stays open — the arms are inert without a project.
  expect(
    decideRunCapabilities({
      ...basePolicyFacts,
      profileId: 'chat',
      projectId: null,
      ownerProjectRole: null,
    }).allowed,
  ).toBe(true);
});

test('lexon_ai_actor_facts resolves the chat owner project standing through the run and the chat', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const viaRun = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            initiating_user_id: string;
            project_id: string | null;
            owner_project_role: string | null;
            owner_denied: boolean;
          }>(
            `SELECT initiating_user_id,project_id,owner_project_role,owner_denied
               FROM auth.lexon_ai_actor_facts($1,$2,$3,NULL)`,
            [scenario.orgId, scenario.users.owner, scenario.runId],
          )
        ).rows[0],
    );
    expect(viaRun).toEqual({
      initiating_user_id: scenario.users.owner,
      project_id: scenario.projectId,
      owner_project_role: 'owner',
      owner_denied: false,
    });
    // The chatId arm (run start) resolves the same project facts with the
    // caller as initiator.
    const viaChat = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            initiating_user_id: string;
            project_id: string | null;
            owner_project_role: string | null;
            owner_denied: boolean;
          }>(
            `SELECT initiating_user_id,project_id,owner_project_role,owner_denied
               FROM auth.lexon_ai_actor_facts($1,$2,NULL,$3)`,
            [scenario.orgId, scenario.users.owner, scenario.projectChatId],
          )
        ).rows[0],
    );
    expect(viaChat).toEqual({
      initiating_user_id: scenario.users.owner,
      project_id: scenario.projectId,
      owner_project_role: 'owner',
      owner_denied: false,
    });
    // Standalone chat → null project, inert gate arms.
    const standalone = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            project_id: string | null;
            owner_project_role: string | null;
            owner_denied: boolean;
          }>(
            `SELECT project_id,owner_project_role,owner_denied
               FROM auth.lexon_ai_actor_facts($1,$2,NULL,$3)`,
            [scenario.orgId, scenario.users.owner, scenario.standaloneChatId],
          )
        ).rows[0],
    );
    expect(standalone).toEqual({
      project_id: null,
      owner_project_role: null,
      owner_denied: false,
    });
  } finally {
    await pools.close();
  }
});

test('a denied chat owner reads owner_denied with the role suppressed; a removed member reads null role', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    const denied = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            owner_project_role: string | null;
            owner_denied: boolean;
          }>(
            `SELECT owner_project_role,owner_denied
               FROM auth.lexon_ai_actor_facts($1,$2,$3,NULL)`,
            [scenario.orgId, scenario.users.owner, scenario.runId],
          )
        ).rows[0],
    );
    expect(denied).toEqual({ owner_project_role: null, owner_denied: true });
  } finally {
    await pools.close();
  }
});

test('finalize_access_loss fails the claimed step and the run with AI_ACCESS_REVOKED and exactly one run_finished', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const live = await seedLiveRun(pools, scenario, {
      runStatus: 'running',
      stepState: 'claimed',
      opKind: 'approval',
      opExpiresAt: 'future',
      siblingPending: true,
      priorStepOps: true,
    });
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    // The run row is now invisible to the initiator's claim.
    const invisible = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM app.ai_runs WHERE id=$1',
              [live.runId],
            )
          ).rows[0]!.count,
        ),
    );
    expect(invisible).toBe(0);
    const settled = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            changed: boolean;
            run_version: number | null;
            run_status: string | null;
          }>(
            `SELECT changed,run_version,run_status
               FROM ops.lexon_ai_finalize_access_loss($1,$2,$3,1,$4,$5,1)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live.runId,
              live.headSequence,
              live.stepId,
            ],
          )
        ).rows[0],
    );
    expect(settled).toEqual({
      changed: true,
      run_version: 2,
      run_status: 'failed',
    });
    expect(await runRow(pools, live.runId)).toEqual({
      status: 'failed',
      error_code: 'AI_ACCESS_REVOKED',
      run_version: 2,
      next_sequence: 3,
    });
    expect(await auditCount(pools, 'chat.run_finished.v1', live.runId)).toBe(1);
    expect(await auditCount(pools, 'chat.tool_operation.v1', live.runId)).toBe(
      2,
    );
    const operations = await pools.migrator.query<{
      id: string;
      status: string;
      error_code: string | null;
    }>(
      `SELECT id,status,error_code FROM app.ai_operations
         WHERE run_id=$1 ORDER BY call_occurrence`,
      [live.runId],
    );
    expect(operations.rows).toEqual([
      {
        id: live.operationId,
        status: 'rejected',
        error_code: 'AI_ACCESS_REVOKED',
      },
      {
        id: live.secondOperationId,
        status: 'failed',
        error_code: 'AI_ACCESS_REVOKED',
      },
    ]);
    const step = (
      await pools.migrator.query<{ state: string }>(
        'SELECT state FROM app.ai_steps WHERE id=$1',
        [live.stepId],
      )
    ).rows[0];
    expect(step).toEqual({ state: 'failed' });
    // Idempotent: the refused second call keeps changed=false.
    const again = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{ changed: boolean }>(
            `SELECT changed FROM ops.lexon_ai_finalize_access_loss($1,$2,$3,1,$4,$5,1)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live.runId,
              live.headSequence,
              live.stepId,
            ],
          )
        ).rows[0],
    );
    expect(again!.changed).toBe(false);
    expect(await auditCount(pools, 'chat.run_finished.v1', live.runId)).toBe(1);
    // And the terminal proof hands back the failed-step anchor.
    const proof = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            status: string;
            error_code: string | null;
            step_id: string;
            sequence: number;
          }>(
            `SELECT status,error_code,step_id,sequence
               FROM ops.lexon_ai_terminal_stream_proof($1,$2,$3)`,
            [scenario.orgId, scenario.users.owner, live.runId],
          )
        ).rows[0],
    );
    // The terminal anchor is the latest committed step — the failed in-flight
    // step never reached the replay surface.
    expect(proof).toEqual({
      status: 'failed',
      error_code: 'AI_ACCESS_REVOKED',
      step_id: live.opStepId,
      sequence: 1,
    });
  } finally {
    await pools.close();
  }
});

test('member removal settles a claimed run identically (no deny row needed)', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    // The run initiator is the editor (a project member) so a plain member
    // removal — not a deny — drops their standing.
    const live = await seedLiveRun(pools, scenario, {
      runStatus: 'running',
      stepState: 'claimed',
      opKind: 'approval',
      opExpiresAt: 'future',
    });
    // Rebind the run+chat ownership to the editor: the fixture seeds the
    // chat/run under the owner, so flip both rows to the editor initiator.
    await pools.migrator.query(
      `UPDATE app.ai_runs SET initiating_user_id=$1 WHERE id=$2`,
      [scenario.users.editor, live.runId],
    );
    await pools.migrator.query(
      `UPDATE app.chats SET owner_user_id=$1 WHERE id=$2`,
      [scenario.users.editor, scenario.projectChatId],
    );
    await projectMemberRemove(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.editor,
    });
    const settled = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.editor },
      async (client) =>
        (
          await client.query<{ changed: boolean }>(
            `SELECT changed FROM ops.lexon_ai_finalize_access_loss($1,$2,$3,1,1,$4,1)`,
            [scenario.orgId, scenario.users.editor, live.runId, live.stepId],
          )
        ).rows[0],
    );
    expect(settled!.changed).toBe(true);
    expect(await runRow(pools, live.runId)).toMatchObject({
      status: 'failed',
      error_code: 'AI_ACCESS_REVOKED',
    });
    expect(await auditCount(pools, 'chat.run_finished.v1', live.runId)).toBe(1);
  } finally {
    await pools.close();
  }
});

test('access_loss_decide rejects the awaiting op, settles the run and returns the paused-step anchor', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const live = await seedLiveRun(pools, scenario, {
      runStatus: 'awaiting_approval',
      stepState: 'awaiting_approval',
      opKind: 'approval',
      opExpiresAt: 'future',
    });
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    const decided = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            found: boolean;
            changed: boolean;
            operation_status: string | null;
            operation_decision: string | null;
            step_id: string | null;
            step_sequence: number | null;
            step_fence: string | null;
          }>(
            `SELECT found,changed,operation_status,operation_decision,
                    step_id,step_sequence,step_fence
               FROM ops.lexon_ai_access_loss_decide($1,$2,$3,$4,$5)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live.runId,
              live.operationId,
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            ],
          )
        ).rows[0],
    );
    expect(decided).toEqual({
      found: true,
      changed: true,
      operation_status: 'rejected',
      operation_decision: 'reject',
      step_id: live.stepId,
      step_sequence: 1,
      step_fence: '1',
    });
    expect(await runRow(pools, live.runId)).toMatchObject({
      status: 'failed',
      error_code: 'AI_ACCESS_REVOKED',
      // The paused step stays the anchor: next_sequence is not advanced.
      next_sequence: 1,
    });
    expect(await auditCount(pools, 'chat.run_finished.v1', live.runId)).toBe(1);
    expect(await auditCount(pools, 'chat.tool_operation.v1', live.runId)).toBe(
      1,
    );
    // Idempotent re-decide returns the stored outcome.
    const again = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            found: boolean;
            changed: boolean;
            operation_status: string | null;
            operation_decision: string | null;
          }>(
            `SELECT found,changed,operation_status,operation_decision
               FROM ops.lexon_ai_access_loss_decide($1,$2,$3,$4,$5)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live.runId,
              live.operationId,
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            ],
          )
        ).rows[0],
    );
    expect(again).toEqual({
      found: true,
      changed: false,
      operation_status: 'rejected',
      operation_decision: 'reject',
    });
    // The terminal anchor is the still-awaiting paused step.
    const proof = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            status: string;
            step_id: string;
            sequence: number;
          }>(
            `SELECT status,step_id,sequence
               FROM ops.lexon_ai_terminal_stream_proof($1,$2,$3)`,
            [scenario.orgId, scenario.users.owner, live.runId],
          )
        ).rows[0],
    );
    expect(proof).toEqual({
      status: 'failed',
      step_id: live.stepId,
      sequence: 1,
    });
  } finally {
    await pools.close();
  }
});

test('org removal mid-run on a standalone chat settles AI_ACCESS_REVOKED with exactly one run_finished', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const live = await seedLiveRun(pools, scenario, {
      runStatus: 'awaiting_approval',
      stepState: 'awaiting_approval',
      opKind: 'approval',
      opExpiresAt: 'future',
      chatId: scenario.standaloneChatId,
    });
    // Remove the initiator from the org mid-run. The team invariant keeps an
    // 'owner' member, so the admin is promoted before the owner's row goes.
    const client = await pools.migrator.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE auth.member SET role='owner'
           WHERE organization_id=$1 AND user_id=$2`,
        [scenario.orgId, scenario.users.admin],
      );
      await client.query(
        `DELETE FROM auth.member
           WHERE organization_id=$1 AND user_id=$2`,
        [scenario.orgId, scenario.users.owner],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    // The standalone chat's bound run is invisible to the initiator: the
    // owner arm matches but lexon_org_member no longer does.
    const invisible = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (c) =>
        Number(
          (
            await c.query<{ count: string }>(
              'SELECT count(*) FROM app.ai_runs WHERE id=$1',
              [live.runId],
            )
          ).rows[0]!.count,
        ),
    );
    expect(invisible).toBe(0);
    const decided = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            found: boolean;
            changed: boolean;
            operation_status: string | null;
            operation_decision: string | null;
          }>(
            `SELECT found,changed,operation_status,operation_decision
               FROM ops.lexon_ai_access_loss_decide($1,$2,$3,$4,$5)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live.runId,
              live.operationId,
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            ],
          )
        ).rows[0],
    );
    expect(decided).toEqual({
      found: true,
      changed: true,
      operation_status: 'rejected',
      operation_decision: 'reject',
    });
    expect(await runRow(pools, live.runId)).toMatchObject({
      status: 'failed',
      error_code: 'AI_ACCESS_REVOKED',
    });
    expect(await auditCount(pools, 'chat.run_finished.v1', live.runId)).toBe(1);
    expect(await auditCount(pools, 'chat.tool_operation.v1', live.runId)).toBe(
      1,
    );
  } finally {
    await pools.close();
  }
});

test('the settle definers refuse a healthy standalone run — no false AI_ACCESS_REVOKED', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const live = await seedLiveRun(pools, scenario, {
      runStatus: 'awaiting_approval',
      stepState: 'awaiting_approval',
      opKind: 'approval',
      opExpiresAt: 'future',
      chatId: scenario.standaloneChatId,
    });
    // The run is still fully visible to its owner — the definer is callable
    // directly and must refuse to stamp a false access-loss outcome.
    const decided = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            found: boolean;
            changed: boolean;
          }>(
            `SELECT found,changed
               FROM ops.lexon_ai_access_loss_decide($1,$2,$3,$4,$5)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live.runId,
              live.operationId,
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            ],
          )
        ).rows[0],
    );
    expect(decided?.found).toBe(true);
    expect(decided?.changed).toBe(false);
    const finalized = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{ changed: boolean }>(
            `SELECT changed
               FROM ops.lexon_ai_finalize_access_loss($1,$2,$3,1,$4,$5,1)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live.runId,
              live.headSequence,
              live.stepId,
            ],
          )
        ).rows[0],
    );
    expect(finalized?.changed).toBe(false);
    expect(await runRow(pools, live.runId)).toMatchObject({
      status: 'awaiting_approval',
      error_code: null,
    });
    expect(await auditCount(pools, 'chat.run_finished.v1', live.runId)).toBe(0);
  } finally {
    await pools.close();
  }
});

test('expire_access_loss expires the past-due op and fails the paused run', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    const live = await seedLiveRun(pools, scenario, {
      runStatus: 'awaiting_approval',
      stepState: 'awaiting_approval',
      opKind: 'approval',
      opExpiresAt: 'past',
    });
    // The not-yet-due refusal runs on a second live run — seeded before the
    // deny because RLS closes the ai_steps insert once access is gone.
    const live2 = await seedLiveRun(pools, scenario, {
      runStatus: 'awaiting_approval',
      stepState: 'awaiting_approval',
      opKind: 'approval',
      opExpiresAt: 'future',
      // One active 'answer' run per chat — this run binds the standalone chat.
      chatId: scenario.standaloneChatId,
    });
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    const expired = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{
            found: boolean;
            changed: boolean;
            operation_kind: string | null;
            step_id: string | null;
          }>(
            `SELECT found,changed,operation_kind,step_id
               FROM ops.lexon_ai_expire_access_loss($1,$2,$3,$4)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live.runId,
              live.operationId,
            ],
          )
        ).rows[0],
    );
    expect(expired).toEqual({
      found: true,
      changed: true,
      operation_kind: 'approval',
      step_id: live.stepId,
    });
    expect(await runRow(pools, live.runId)).toMatchObject({
      status: 'failed',
      error_code: 'AI_ACCESS_REVOKED',
    });
    const op = (
      await pools.migrator.query<{
        status: string;
        decision: string | null;
        result: Record<string, unknown>;
      }>(
        `SELECT status,decision::text,result FROM app.ai_operations WHERE id=$1`,
        [live.operationId],
      )
    ).rows[0];
    expect(op!.status).toBe('expired');
    expect(op!.result).toEqual({ expired: 'approval' });
    // The decided audit is actor-less by contract.
    const audit = (
      await pools.migrator.query<{
        type: string;
        actor_user_id: string | null;
      }>(
        `SELECT type,actor_user_id FROM ops.audit_events
           WHERE metadata->>'operationId'=$1`,
        [live.operationId],
      )
    ).rows[0];
    expect(audit).toEqual({
      type: 'chat.approval_decided.v1',
      actor_user_id: null,
    });
    // A not-yet-due op is refused without settling anything.
    const refused = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) =>
        (
          await client.query<{ found: boolean; changed: boolean }>(
            `SELECT found,changed FROM ops.lexon_ai_expire_access_loss($1,$2,$3,$4)`,
            [
              scenario.orgId,
              scenario.users.owner,
              live2.runId,
              live2.operationId,
            ],
          )
        ).rows[0],
    );
    expect(refused).toEqual({ found: true, changed: false });
  } finally {
    await pools.close();
  }
});

test('ai_mark_chat_deleted refuses the denied owner but still deletes the standalone chat', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const scenario = await createProjectScenario(pools);
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.owner,
      setByUserId: scenario.users.admin,
    });
    const results = await withAppTenant(
      pools.app,
      { orgId: scenario.orgId, userId: scenario.users.owner },
      async (client) => ({
        projectChat: (
          await client.query<{ ai_mark_chat_deleted: boolean }>(
            'SELECT ops.ai_mark_chat_deleted($1,$2,$3)',
            [scenario.orgId, scenario.users.owner, scenario.projectChatId],
          )
        ).rows[0]!.ai_mark_chat_deleted,
        standalone: (
          await client.query<{ ai_mark_chat_deleted: boolean }>(
            'SELECT ops.ai_mark_chat_deleted($1,$2,$3)',
            [scenario.orgId, scenario.users.owner, scenario.standaloneChatId],
          )
        ).rows[0]!.ai_mark_chat_deleted,
      }),
    );
    expect(results).toEqual({ projectChat: false, standalone: true });
  } finally {
    await pools.close();
  }
});

test('the definer family is executable by lexon_app only', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  try {
    const grants = (
      await pools.app.query<{
        name: string;
        app: boolean;
        auth: boolean;
        public: boolean;
      }>(
        `SELECT name,
           has_function_privilege('lexon_app',name,'EXECUTE') AS app,
           has_function_privilege('lexon_auth',name,'EXECUTE') AS auth,
           has_function_privilege('public',name,'EXECUTE') AS public
         FROM (VALUES
           ('auth.lexon_ai_actor_facts(uuid,uuid,uuid,uuid)'),
           ('ops.lexon_ai_access_loss_facts(uuid,uuid,uuid)'),
           ('ops.lexon_ai_finalize_access_loss(uuid,uuid,uuid,integer,integer,uuid,bigint)'),
           ('ops.lexon_ai_access_loss_decide(uuid,uuid,uuid,uuid,text)'),
           ('ops.lexon_ai_terminal_stream_proof(uuid,uuid,uuid)'),
           ('ops.lexon_ai_expire_access_loss(uuid,uuid,uuid,uuid)')
         ) AS f(name)`,
      )
    ).rows;
    for (const row of grants) {
      expect(row.app, row.name).toBe(true);
      expect(row.auth, row.name).toBe(false);
      expect(row.public, row.name).toBe(false);
    }
  } finally {
    await pools.close();
  }
});
