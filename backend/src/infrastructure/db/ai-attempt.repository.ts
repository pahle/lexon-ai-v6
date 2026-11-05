import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';
import type { AttemptRecord, ReportedUsage, StepClaim } from './ai-records.js';
import { AiStepRepository } from './ai-step.repository.js';

const uuid = z.uuid();
const costPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,10})?$/;
interface AttemptRow {
  id: string;
  org_id: string;
  run_id: string;
  step_id: string;
  ordinal: number;
  model_id: string;
  estimator_version: string;
  estimated_input_tokens: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  generation_id: string | null;
  provider: string | null;
  reported_input_tokens: number | null;
  reported_output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_output_tokens: number | null;
  cost_usd: string | null;
  active: boolean;
  outcome: 'succeeded' | 'failed' | 'unknown' | null;
  created_at: Date;
  settled_at: Date | null;
}

function mapAttempt(row: AttemptRow): AttemptRecord {
  return {
    attemptId: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    stepId: row.step_id,
    ordinal: row.ordinal,
    modelId: row.model_id,
    estimatorVersion: row.estimator_version,
    estimatedInputTokens: row.estimated_input_tokens,
    reservedInputTokens: row.reserved_input_tokens,
    reservedOutputTokens: row.reserved_output_tokens,
    generationId: row.generation_id,
    provider: row.provider,
    reportedInputTokens: row.reported_input_tokens,
    reportedOutputTokens: row.reported_output_tokens,
    cachedInputTokens: row.cached_input_tokens,
    reasoningOutputTokens: row.reasoning_output_tokens,
    costUsd: row.cost_usd,
    active: row.active,
    outcome: row.outcome,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

function validClaim(tx: TenantSession, claim: StepClaim): boolean {
  const { ctx } = requireSession(tx);
  return (
    uuid.safeParse(claim.runId).success &&
    uuid.safeParse(claim.orgId).success &&
    uuid.safeParse(claim.userId).success &&
    uuid.safeParse(claim.stepId).success &&
    claim.orgId === ctx.orgId &&
    claim.userId === ctx.userId &&
    Number.isSafeInteger(claim.sequence) &&
    claim.sequence > 0 &&
    Number.isSafeInteger(claim.expectedVersion) &&
    claim.expectedVersion > 0 &&
    Number.isSafeInteger(claim.fence) &&
    claim.fence > 0
  );
}

function validUsage(usage?: Partial<ReportedUsage>): boolean {
  if (!usage) return true;
  return (
    [
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens,
      usage.reasoningOutputTokens,
    ].every(
      (value) =>
        value === undefined || (Number.isSafeInteger(value) && value >= 0),
    ) &&
    (usage.inputTokens === undefined ||
      Number.isSafeInteger(usage.inputTokens)) &&
    (usage.outputTokens === undefined ||
      Number.isSafeInteger(usage.outputTokens))
  );
}

export class AiAttemptRepository {
  private readonly steps = new AiStepRepository();

  async insert(
    tx: TenantSession,
    claim: StepClaim,
    record: AttemptRecord,
  ): Promise<void> {
    if (
      !validClaim(tx, claim) ||
      !uuid.safeParse(record.attemptId).success ||
      record.orgId !== claim.orgId ||
      record.runId !== claim.runId ||
      record.stepId !== claim.stepId ||
      !Number.isSafeInteger(record.ordinal) ||
      record.ordinal < 1 ||
      !record.active ||
      record.outcome !== null ||
      record.settledAt !== null ||
      !Number.isSafeInteger(record.estimatedInputTokens) ||
      record.estimatedInputTokens < 0 ||
      !Number.isSafeInteger(record.reservedInputTokens) ||
      record.reservedInputTokens < 0 ||
      !Number.isSafeInteger(record.reservedOutputTokens) ||
      record.reservedOutputTokens < 1 ||
      Buffer.byteLength(record.modelId, 'utf8') < 1 ||
      Buffer.byteLength(record.modelId, 'utf8') > 256 ||
      Buffer.byteLength(record.estimatorVersion, 'utf8') < 1 ||
      Buffer.byteLength(record.estimatorVersion, 'utf8') > 64 ||
      (record.provider !== null &&
        Buffer.byteLength(record.provider, 'utf8') > 128) ||
      (record.generationId !== null &&
        Buffer.byteLength(record.generationId, 'utf8') > 256)
    )
      throw new Error('Invalid AI attempt');
    if (!(await this.steps.lockClaim(tx, claim)))
      throw new Error('AI step claim lost');
    const { client } = requireSession(tx);
    const result = await client.query(
      `INSERT INTO app.ai_attempts
       (id,org_id,run_id,step_id,ordinal,model_id,provider,estimator_version,estimated_input_tokens,reserved_input_tokens,reserved_output_tokens,generation_id,fence,active,outcome)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,NULL
       FROM app.ai_steps s JOIN app.ai_runs r ON r.org_id=s.org_id AND r.id=s.run_id
       WHERE s.org_id=$2 AND s.run_id=$3 AND s.id=$4 AND s.sequence=$14 AND s.expected_version=$15
         AND s.fence=$13 AND s.state='claimed' AND s.lease_until>clock_timestamp()
         AND r.run_version=$15 AND r.next_sequence=$14`,
      [
        record.attemptId,
        claim.orgId,
        claim.runId,
        claim.stepId,
        record.ordinal,
        record.modelId,
        record.provider,
        record.estimatorVersion,
        record.estimatedInputTokens,
        record.reservedInputTokens,
        record.reservedOutputTokens,
        record.generationId,
        claim.fence,
        claim.sequence,
        claim.expectedVersion,
      ],
    );
    if (result.rowCount !== 1) throw new Error('AI step claim lost');
  }

  async updateMetadata(
    tx: TenantSession,
    claim: StepClaim,
    input: { attemptId: string; generationId: string; provider?: string },
  ): Promise<boolean> {
    if (
      !validClaim(tx, claim) ||
      !uuid.safeParse(input.attemptId).success ||
      Buffer.byteLength(input.generationId, 'utf8') > 256 ||
      (input.provider !== undefined &&
        Buffer.byteLength(input.provider, 'utf8') > 128)
    )
      return false;
    if (!(await this.steps.lockClaim(tx, claim))) return false;
    const { client } = requireSession(tx);
    const result = await client.query(
      `UPDATE app.ai_attempts a SET generation_id=$8,provider=COALESCE($9,a.provider)
       FROM app.ai_steps s JOIN app.ai_runs r ON r.org_id=s.org_id AND r.id=s.run_id
       WHERE a.org_id=$1 AND a.run_id=$2 AND a.step_id=$3 AND a.id=$7 AND a.fence=$6 AND a.active=true
         AND s.org_id=a.org_id AND s.id=a.step_id AND s.sequence=$4 AND s.expected_version=$5
         AND s.fence=$6 AND s.state='claimed' AND s.lease_until>clock_timestamp()
         AND r.run_version=$5 AND r.next_sequence=$4 AND r.status IN ('queued','running','awaiting_approval','cancelling')`,
      [
        claim.orgId,
        claim.runId,
        claim.stepId,
        claim.sequence,
        claim.expectedVersion,
        claim.fence,
        input.attemptId,
        input.generationId,
        input.provider ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async settle(
    tx: TenantSession,
    claim: StepClaim,
    input: {
      attemptId: string;
      outcome: 'succeeded' | 'failed' | 'unknown';
      usage?: Partial<ReportedUsage>;
      costUsd?: string;
    },
  ): Promise<boolean> {
    if (
      !validClaim(tx, claim) ||
      !uuid.safeParse(input.attemptId).success ||
      !['succeeded', 'failed', 'unknown'].includes(input.outcome) ||
      !validUsage(input.usage) ||
      (input.costUsd !== undefined &&
        (!costPattern.test(input.costUsd) ||
          input.costUsd.length > 21 ||
          input.costUsd.split('.')[0]!.length > 10))
    )
      return false;
    if (!(await this.steps.lockClaim(tx, claim))) return false;
    const { client } = requireSession(tx);
    const usage = input.usage;
    const result = await client.query(
      `UPDATE app.ai_attempts a SET active=false,outcome=$8,settled_at=clock_timestamp(),
       reported_input_tokens=$9,reported_output_tokens=$10,cached_input_tokens=$11,
       reasoning_output_tokens=$12,cost_usd=$13
       FROM app.ai_steps s JOIN app.ai_runs r ON r.org_id=s.org_id AND r.id=s.run_id
       WHERE a.org_id=$1 AND a.run_id=$2 AND a.step_id=$3 AND a.id=$7 AND a.fence=$6 AND a.active=true
         AND s.org_id=a.org_id AND s.id=a.step_id AND s.sequence=$4 AND s.expected_version=$5
         AND s.fence=$6 AND s.state='claimed' AND s.lease_until>clock_timestamp()
         AND r.run_version=$5 AND r.next_sequence=$4 AND r.status IN ('queued','running','awaiting_approval','cancelling')`,
      [
        claim.orgId,
        claim.runId,
        claim.stepId,
        claim.sequence,
        claim.expectedVersion,
        claim.fence,
        input.attemptId,
        input.outcome,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.cachedInputTokens ?? null,
        usage?.reasoningOutputTokens ?? null,
        input.costUsd ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async list(tx: TenantSession, runId: string): Promise<AttemptRecord[]> {
    if (!uuid.safeParse(runId).success) throw new Error('Invalid AI run ID');
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = await client.query<AttemptRow>(
      'SELECT * FROM app.ai_attempts WHERE org_id=$1 AND run_id=$2 ORDER BY created_at,id',
      [scope.orgId, runId],
    );
    return result.rows.map(mapAttempt);
  }
}
