import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';
import type {
  AiRunStatus,
  RunInsert,
  RunRecord,
  TerminalStreamReference,
} from './ai-records.js';
import { AiStepRepository } from './ai-step.repository.js';

const idSchema = z.uuid();
const errorCodes = new Set([
  'AI_BUDGET_EXCEEDED',
  'AI_ATTEMPT_LIMIT',
  'AI_ITERATION_LIMIT',
  'AI_ACCESS_REVOKED',
  'AI_MODEL_FORBIDDEN',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_AUTH',
  'AI_INVALID_TOOL',
  'AI_TOOL_TIMEOUT',
  'AI_TOOL_OUTCOME_UNKNOWN',
  'AI_CAPACITY_EXCEEDED',
  'AI_OUTPUT_LIMIT',
  'AI_INTERNAL',
]);
const transitions: Readonly<Record<AiRunStatus, readonly AiRunStatus[]>> = {
  queued: ['running', 'completed', 'cancelling', 'failed', 'cancelled'],
  running: [
    'running',
    'awaiting_approval',
    'completed',
    'failed',
    'cancelling',
  ],
  awaiting_approval: ['running', 'failed', 'cancelling'],
  completed: [],
  failed: [],
  cancelling: ['cancelled', 'failed'],
  cancelled: [],
};

interface RunRow {
  id: string;
  org_id: string;
  initiating_user_id: string;
  initiating_session_id: string | null;
  initiating_mfa_verified_at: Date | null;
  profile_id: string;
  profile_version: number;
  resolved_config: unknown;
  model_id: string;
  input_text: string;
  status: AiRunStatus;
  run_version: number;
  next_sequence: number;
  model_iterations: number;
  input_budget_tokens: string | number;
  output_budget_tokens: string | number;
  partial_output: string;
  reasoning_summary: string | null;
  reasoning_duration_ms: number | null;
  final_output: string | null;
  error_code: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    initiatingUserId: row.initiating_user_id,
    initiatingSessionId: row.initiating_session_id,
    initiatingMfaVerifiedAt: row.initiating_mfa_verified_at,
    profileId: row.profile_id,
    profileVersion: row.profile_version,
    resolvedConfig: row.resolved_config,
    modelId: row.model_id,
    inputText: row.input_text,
    status: row.status,
    runVersion: row.run_version,
    nextSequence: row.next_sequence,
    modelIterations: row.model_iterations,
    inputBudgetTokens: Number(row.input_budget_tokens),
    outputBudgetTokens: Number(row.output_budget_tokens),
    partialOutput: row.partial_output,
    reasoningSummary: row.reasoning_summary,
    reasoningDurationMs: row.reasoning_duration_ms,
    finalOutput: row.final_output,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function assertInput(tx: TenantSession, input: RunInsert): void {
  const { ctx } = requireSession(tx);
  if (
    !idSchema.safeParse(input.id).success ||
    !idSchema.safeParse(input.orgId).success ||
    !idSchema.safeParse(input.initiatingUserId).success ||
    (input.initiatingSessionId != null &&
      !idSchema.safeParse(input.initiatingSessionId).success) ||
    (input.initiatingMfaVerifiedAt != null &&
      (!Number.isFinite(input.initiatingMfaVerifiedAt.getTime()) ||
        input.initiatingSessionId == null)) ||
    input.orgId !== ctx.orgId ||
    input.initiatingUserId !== ctx.userId ||
    !Number.isSafeInteger(input.profileVersion) ||
    input.profileVersion < 1 ||
    !Number.isSafeInteger(input.inputBudgetTokens) ||
    input.inputBudgetTokens < 1 ||
    !Number.isSafeInteger(input.outputBudgetTokens) ||
    input.outputBudgetTokens < 1 ||
    Buffer.byteLength(input.profileId, 'utf8') < 1 ||
    Buffer.byteLength(input.profileId, 'utf8') > 128 ||
    Buffer.byteLength(input.modelId, 'utf8') < 1 ||
    Buffer.byteLength(input.modelId, 'utf8') > 256 ||
    Buffer.byteLength(input.inputText, 'utf8') > 262144
  )
    throw new Error('Invalid AI run');
  let json: string;
  try {
    json = JSON.stringify(input.resolvedConfig);
  } catch {
    throw new Error('Invalid AI run');
  }
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > 65536)
    throw new Error('Invalid AI run');
}

export class AiRunRepository {
  private readonly steps = new AiStepRepository();
  async streamRegistryState(
    tx: TenantSession,
    runId: string,
    userId: string,
  ): Promise<
    | { readonly state: 'active' }
    | { readonly state: 'missing' }
    | {
        readonly state: 'terminal';
        readonly claim: TerminalStreamReference;
      }
  > {
    if (
      !idSchema.safeParse(runId).success ||
      !idSchema.safeParse(userId).success
    )
      return { state: 'missing' };
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    if (ctx.userId !== userId) return { state: 'missing' };
    const result = await client.query<{
      status: AiRunStatus;
      run_version: number;
      next_sequence: number;
    }>(
      'SELECT status,run_version,next_sequence FROM app.ai_runs WHERE org_id=$1 AND id=$2',
      [scope.orgId, runId],
    );
    const run = result.rows[0];
    if (!run) return { state: 'missing' };
    if (!['completed', 'failed', 'cancelled'].includes(run.status))
      return { state: 'active' };
    const latest = await client.query<{
      id: string;
      sequence: number;
      expected_version: number;
      fence: number;
    }>(
      `SELECT id,sequence,expected_version,fence FROM app.ai_steps
       WHERE org_id=$1 AND run_id=$2 AND state IN ('committed','awaiting_approval')
       ORDER BY sequence DESC,updated_at DESC LIMIT 1`,
      [scope.orgId, runId],
    );
    const step = latest.rows[0];
    if (!step) {
      const failed = await client.query<{
        id: string;
        sequence: number;
        expected_version: number;
        fence: number;
      }>(
        `SELECT s.id,s.sequence,s.expected_version,s.fence
         FROM app.ai_runs r JOIN app.ai_steps s
           ON s.org_id=r.org_id AND s.run_id=r.id
         WHERE r.org_id=$1 AND r.id=$2 AND r.initiating_user_id=$3
           AND ((r.status='failed' AND s.state='failed'
                 AND s.sequence=r.next_sequence-1) OR
                (r.status='cancelled' AND s.state IN ('pending','claimed')
                 AND s.sequence=r.next_sequence AND s.expected_version<=r.run_version))
           AND NOT EXISTS (
             SELECT 1 FROM app.ai_steps prior
             WHERE prior.org_id=r.org_id AND prior.run_id=r.id
               AND prior.state IN ('committed','awaiting_approval')
           )
         ORDER BY s.updated_at DESC LIMIT 1`,
        [scope.orgId, runId, userId],
      );
      const failedStep = failed.rows[0];
      if (!failedStep) return { state: 'missing' };
      return {
        state: 'terminal',
        claim: {
          runId,
          orgId: scope.orgId,
          userId,
          stepId: failedStep.id,
          sequence: Number(failedStep.sequence),
          expectedVersion: Number(failedStep.expected_version),
          fence: Number(failedStep.fence),
          neutral: true,
        },
      };
    }
    return {
      state: 'terminal',
      claim: {
        runId,
        orgId: scope.orgId,
        userId,
        stepId: step.id,
        sequence: Number(step.sequence),
        expectedVersion: Number(step.expected_version),
        fence: Number(step.fence),
      },
    };
  }

  async insert(tx: TenantSession, input: RunInsert): Promise<RunRecord> {
    assertInput(tx, input);
    const { client } = requireSession(tx);
    const result = await client.query<RunRow>(
      `INSERT INTO app.ai_runs
       (id,org_id,initiating_user_id,initiating_session_id,initiating_mfa_verified_at,profile_id,profile_version,resolved_config,model_id,input_text,status,run_version,next_sequence,model_iterations,input_budget_tokens,output_budget_tokens,partial_output)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'queued',1,1,0,$11,$12,'') RETURNING *`,
      [
        input.id,
        input.orgId,
        input.initiatingUserId,
        input.initiatingSessionId ?? null,
        input.initiatingMfaVerifiedAt ?? null,
        input.profileId,
        input.profileVersion,
        JSON.stringify(input.resolvedConfig),
        input.modelId,
        input.inputText,
        input.inputBudgetTokens,
        input.outputBudgetTokens,
      ],
    );
    return mapRun(result.rows[0]!);
  }

  async find(tx: TenantSession, runId: string): Promise<RunRecord | null> {
    if (!idSchema.safeParse(runId).success)
      throw new Error('Invalid AI run ID');
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = await client.query<RunRow>(
      'SELECT * FROM app.ai_runs WHERE org_id=$1 AND id=$2',
      [scope.orgId, runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async lockForLifecycle(
    tx: TenantSession,
    runId: string,
  ): Promise<RunRecord | null> {
    if (!idSchema.safeParse(runId).success)
      throw new Error('Invalid AI run ID');
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = await client.query<RunRow>(
      'SELECT * FROM app.ai_runs WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [scope.orgId, runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async latestCheckpointText(
    tx: TenantSession,
    runId: string,
    sequence: number,
  ): Promise<string> {
    if (
      !idSchema.safeParse(runId).success ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1
    )
      throw new Error('Invalid AI checkpoint lookup');
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = await client.query<{ text: string }>(
      `SELECT c.text FROM app.ai_checkpoints c
       JOIN app.ai_steps s ON s.org_id=c.org_id AND s.run_id=c.run_id AND s.id=c.step_id
       WHERE c.org_id=$1 AND c.run_id=$2 AND s.sequence=$3
       ORDER BY c.created_at DESC LIMIT 1`,
      [scope.orgId, runId, sequence],
    );
    return result.rows[0]?.text ?? '';
  }

  async terminalStreamReference(
    tx: TenantSession,
    runId: string,
  ): Promise<TerminalStreamReference | undefined> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId || !idSchema.safeParse(runId).success) return undefined;
    const result = await client.query<{
      org_id: string;
      run_id: string;
      user_id: string;
      step_id: string | null;
      sequence: number | null;
      expected_version: number | null;
      fence: number | null;
    }>(
      `SELECT r.org_id,r.id AS run_id,r.initiating_user_id AS user_id,
              s.id AS step_id,s.sequence,s.expected_version,s.fence
       FROM app.ai_runs r
       LEFT JOIN LATERAL (
         SELECT id,sequence,expected_version,fence FROM app.ai_steps
         WHERE org_id=r.org_id AND run_id=r.id
           AND state IN ('committed','awaiting_approval')
         ORDER BY sequence DESC,updated_at DESC LIMIT 1
       ) s ON true
       WHERE r.org_id=$1 AND r.id=$2 AND r.initiating_user_id=$3
         AND r.status IN ('completed','failed','cancelled')`,
      [ctx.orgId, runId, ctx.userId],
    );
    let row = result.rows[0];
    let neutral = false;
    if (row && !row.step_id) {
      const current = await client.query<{
        step_id: string;
        sequence: number;
        expected_version: number;
        fence: number;
      }>(
        `SELECT s.id AS step_id,s.sequence,s.expected_version,s.fence
         FROM app.ai_runs r JOIN app.ai_steps s
           ON s.org_id=r.org_id AND s.run_id=r.id
         WHERE r.org_id=$1 AND r.id=$2 AND r.initiating_user_id=$3
           AND r.status IN ('completed','failed','cancelled')
           AND ((r.status='failed' AND s.state='failed'
                 AND s.sequence=r.next_sequence-1 AND s.expected_version<=r.run_version) OR
                (r.status='cancelled' AND s.state IN ('pending','claimed')
                 AND s.sequence=r.next_sequence AND s.expected_version<=r.run_version))
           AND NOT EXISTS (
             SELECT 1 FROM app.ai_steps prior
             WHERE prior.org_id=r.org_id AND prior.run_id=r.id
               AND prior.state IN ('committed','awaiting_approval')
           )
         ORDER BY s.updated_at DESC LIMIT 1`,
        [ctx.orgId, runId, ctx.userId],
      );
      const step = current.rows[0];
      if (step) {
        row = {
          ...row,
          step_id: step.step_id,
          sequence: step.sequence,
          expected_version: step.expected_version,
          fence: step.fence,
        };
        neutral = true;
      }
    }
    if (
      !row ||
      !row.step_id ||
      row.sequence === null ||
      row.expected_version === null ||
      row.fence === null
    )
      return undefined;
    return {
      orgId: row.org_id,
      userId: row.user_id,
      runId: row.run_id,
      stepId: row.step_id,
      sequence: Number(row.sequence),
      expectedVersion: Number(row.expected_version),
      fence: Number(row.fence),
      ...(neutral ? { neutral: true } : {}),
    };
  }

  /** Marks a queued run active under its unchanged step precondition. */
  async markRunningForClaim(
    tx: TenantSession,
    input: {
      readonly runId: string;
      readonly stepId: string;
      readonly expectedVersion: number;
      readonly sequence: number;
      readonly fence: number;
    },
  ): Promise<boolean> {
    if (
      !idSchema.safeParse(input.runId).success ||
      !idSchema.safeParse(input.stepId).success ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 1 ||
      !Number.isSafeInteger(input.fence) ||
      input.fence < 1
    )
      return false;
    if (!(await this.steps.lockResourceForRun(tx, input.runId))) return false;
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = await client.query(
      `UPDATE app.ai_runs r SET status='running',updated_at=clock_timestamp()
       WHERE r.org_id=$1 AND r.id=$2 AND r.run_version=$3 AND r.next_sequence=$4
         AND r.status IN ('queued','running','awaiting_approval')
         AND EXISTS (
           SELECT 1 FROM app.ai_steps s
           WHERE s.org_id=r.org_id AND s.run_id=r.id AND s.id=$5
             AND s.sequence=$4 AND s.expected_version=$3 AND s.fence=$6
             AND s.state='claimed' AND s.lease_until>clock_timestamp()
         )`,
      [
        scope.orgId,
        input.runId,
        input.expectedVersion,
        input.sequence,
        input.stepId,
        input.fence,
      ],
    );
    return result.rowCount === 1;
  }

  async transition(
    tx: TenantSession,
    input: {
      runId: string;
      expectedVersion: number;
      from: AiRunStatus;
      to: AiRunStatus;
      errorCode?: string;
      nextSequence?: number;
      modelIterationDelta?: 0 | 1;
      outputAppend?: string;
      finalizeOutput?: boolean;
    },
  ): Promise<boolean> {
    if (
      !idSchema.safeParse(input.runId).success ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !transitions[input.from]?.includes(input.to) ||
      (input.nextSequence !== undefined &&
        (!Number.isSafeInteger(input.nextSequence) ||
          input.nextSequence < 1)) ||
      (input.modelIterationDelta !== undefined &&
        input.modelIterationDelta !== 0 &&
        input.modelIterationDelta !== 1) ||
      (input.outputAppend !== undefined &&
        (typeof input.outputAppend !== 'string' ||
          Buffer.byteLength(input.outputAppend, 'utf8') > 262144)) ||
      (input.finalizeOutput !== undefined &&
        typeof input.finalizeOutput !== 'boolean') ||
      (input.errorCode !== undefined && !errorCodes.has(input.errorCode))
    )
      return false;
    const writesContent =
      input.outputAppend !== undefined || input.finalizeOutput === true;
    if (
      writesContent &&
      !(await this.steps.lockResourceForRun(tx, input.runId))
    )
      return false;
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = writesContent
      ? await client.query(
          `UPDATE app.ai_runs SET status=$5,run_version=run_version+1,
       next_sequence=COALESCE($7,next_sequence),model_iterations=model_iterations+$8,
       partial_output=partial_output||COALESCE($9,''),
       final_output=CASE WHEN $10 THEN partial_output||COALESCE($9,'')
                         WHEN $5 IN ('failed','cancelled') THEN NULL
                         ELSE final_output END,
       updated_at=clock_timestamp(),
       error_code=$6,completed_at=CASE WHEN $5 IN ('completed','failed','cancelled') THEN clock_timestamp() ELSE NULL END
       WHERE org_id=$1 AND id=$2 AND run_version=$3 AND status=$4`,
          [
            scope.orgId,
            input.runId,
            input.expectedVersion,
            input.from,
            input.to,
            input.errorCode ?? null,
            input.nextSequence ?? null,
            input.modelIterationDelta ?? 0,
            input.outputAppend ?? null,
            input.finalizeOutput ?? false,
          ],
        )
      : await client.query(
          `UPDATE app.ai_runs SET status=$5,run_version=run_version+1,
           next_sequence=COALESCE($7,next_sequence),model_iterations=model_iterations+$8,
           updated_at=clock_timestamp(),error_code=$6,
           completed_at=CASE WHEN $5 IN ('completed','failed','cancelled') THEN clock_timestamp() ELSE NULL END
           WHERE org_id=$1 AND id=$2 AND run_version=$3 AND status=$4`,
          [
            scope.orgId,
            input.runId,
            input.expectedVersion,
            input.from,
            input.to,
            input.errorCode ?? null,
            input.nextSequence ?? null,
            input.modelIterationDelta ?? 0,
          ],
        );
    return result.rowCount === 1;
  }
}
