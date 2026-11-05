import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';
import type { AiRunStatus, RunInsert, RunRecord } from './ai-records.js';

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

  async transition(
    tx: TenantSession,
    input: {
      runId: string;
      expectedVersion: number;
      from: AiRunStatus;
      to: AiRunStatus;
      errorCode?: string;
      nextSequence?: number;
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
      (input.errorCode !== undefined && !errorCodes.has(input.errorCode))
    )
      return false;
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = await client.query(
      `UPDATE app.ai_runs SET status=$5,run_version=run_version+1,
       next_sequence=COALESCE($7,next_sequence),updated_at=clock_timestamp(),
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
      ],
    );
    return result.rowCount === 1;
  }
}
