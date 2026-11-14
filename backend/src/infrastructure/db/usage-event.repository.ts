import { z } from 'zod';
import { requireSession, type TenantSession } from './tenant-session.js';
import type { AttemptRecord, StepClaim } from './ai-records.js';

const uuid = z.uuid();
const costPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const safeIdentity = /^[A-Za-z0-9._/-]+$/;

export interface UsageEventDescriptor {
  readonly profileId: string;
  readonly requestedProvider: string;
  readonly resolvedEffort: string | null;
  readonly instructionVersion: string | null;
}

export interface UsageEventSettlement {
  readonly outcome: 'succeeded' | 'failed' | 'unknown';
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly costUsd?: string;
}

interface UsageEventRow {
  attempt_id: string;
  actor_user_id: string;
  run_id: string;
  step_id: string;
  model_id: string;
  requested_provider: string;
  observed_provider: string | null;
  profile_id: string;
  resolved_effort: string | null;
  estimated_input_tokens: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  estimator_version: string;
  instruction_version: string | null;
  reported_input_tokens: number | null;
  reported_output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_output_tokens: number | null;
  cost_usd: string | null;
  generation_id: string | null;
  outcome: 'reserved' | 'succeeded' | 'failed' | 'unknown';
}

function validUsage(input: UsageEventSettlement): boolean {
  return (
    ['succeeded', 'failed', 'unknown'].includes(input.outcome) &&
    [
      input.inputTokens,
      input.outputTokens,
      input.cachedInputTokens,
      input.reasoningOutputTokens,
    ].every(
      (value) =>
        value === undefined || (Number.isSafeInteger(value) && value >= 0),
    ) &&
    (input.costUsd === undefined ||
      (input.costUsd.length <= 512 &&
        costPattern.test(input.costUsd) &&
        Number.isFinite(Number(input.costUsd))))
  );
}

function sameSettlement(
  row: UsageEventRow,
  input: UsageEventSettlement,
): boolean {
  return (
    row.outcome === input.outcome &&
    row.reported_input_tokens === (input.inputTokens ?? null) &&
    row.reported_output_tokens === (input.outputTokens ?? null) &&
    row.cached_input_tokens === (input.cachedInputTokens ?? null) &&
    row.reasoning_output_tokens === (input.reasoningOutputTokens ?? null) &&
    normalizeCost(row.cost_usd) === normalizeCost(input.costUsd ?? null)
  );
}

function normalizeCost(value: string | null): string | null {
  if (value === null) return null;
  const [integer, fraction = ''] = value.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${integer}.${normalizedFraction}` : integer!;
}

export class UsageEventRepository {
  async exists(tx: TenantSession, attemptId: string): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId || !uuid.safeParse(attemptId).success) return false;
    const result = await client.query(
      `SELECT 1 FROM app.usage_events
       WHERE org_id=$1 AND actor_user_id=$2 AND attempt_id=$3`,
      [ctx.orgId, ctx.userId, attemptId],
    );
    return result.rowCount === 1;
  }

  async reserve(
    tx: TenantSession,
    claim: StepClaim,
    attempt: AttemptRecord,
    descriptor: UsageEventDescriptor,
  ): Promise<void> {
    const { client, ctx } = requireSession(tx);
    if (
      !uuid.safeParse(attempt.attemptId).success ||
      !uuid.safeParse(claim.orgId).success ||
      !uuid.safeParse(claim.userId).success ||
      claim.orgId !== ctx.orgId ||
      claim.userId !== ctx.userId ||
      attempt.orgId !== claim.orgId ||
      attempt.runId !== claim.runId ||
      attempt.stepId !== claim.stepId ||
      !Buffer.byteLength(attempt.modelId, 'utf8') ||
      Buffer.byteLength(attempt.modelId, 'utf8') > 256 ||
      !safeIdentity.test(attempt.modelId) ||
      !Buffer.byteLength(descriptor.requestedProvider, 'utf8') ||
      Buffer.byteLength(descriptor.requestedProvider, 'utf8') > 128 ||
      !safeIdentity.test(descriptor.requestedProvider) ||
      !Buffer.byteLength(descriptor.profileId, 'utf8') ||
      Buffer.byteLength(descriptor.profileId, 'utf8') > 128 ||
      !safeIdentity.test(descriptor.profileId) ||
      (descriptor.resolvedEffort !== null &&
        !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
          descriptor.resolvedEffort,
        )) ||
      (descriptor.instructionVersion !== null &&
        (!Buffer.byteLength(descriptor.instructionVersion, 'utf8') ||
          Buffer.byteLength(descriptor.instructionVersion, 'utf8') > 128 ||
          !safeIdentity.test(descriptor.instructionVersion)))
    )
      throw new Error('Invalid usage event reservation');
    await client.query(
      `INSERT INTO app.usage_events
       (attempt_id,org_id,actor_user_id,run_id,step_id,model_id,requested_provider,
        profile_id,resolved_effort,estimated_input_tokens,reserved_input_tokens,
        reserved_output_tokens,estimator_version,instruction_version,outcome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'reserved')`,
      [
        attempt.attemptId,
        attempt.orgId,
        claim.userId,
        attempt.runId,
        attempt.stepId,
        attempt.modelId,
        descriptor.requestedProvider,
        descriptor.profileId,
        descriptor.resolvedEffort,
        attempt.estimatedInputTokens,
        attempt.reservedInputTokens,
        attempt.reservedOutputTokens,
        attempt.estimatorVersion,
        descriptor.instructionVersion,
      ],
    );
  }

  async metadata(
    tx: TenantSession,
    attemptId: string,
    metadata: { generationId: string; provider?: string },
  ): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    if (
      !ctx.userId ||
      !uuid.safeParse(attemptId).success ||
      !Buffer.byteLength(metadata.generationId, 'utf8') ||
      Buffer.byteLength(metadata.generationId, 'utf8') > 256 ||
      (metadata.provider !== undefined &&
        (!Buffer.byteLength(metadata.provider, 'utf8') ||
          Buffer.byteLength(metadata.provider, 'utf8') > 128 ||
          !safeIdentity.test(metadata.provider)))
    )
      return false;
    const result = await client.query(
      `UPDATE app.usage_events SET generation_id=$3,observed_provider=COALESCE($4,observed_provider)
       WHERE org_id=$1 AND actor_user_id=$2 AND attempt_id=$5 AND outcome IN ('reserved','unknown')`,
      [
        ctx.orgId,
        ctx.userId,
        metadata.generationId,
        metadata.provider ?? null,
        attemptId,
      ],
    );
    return result.rowCount === 1;
  }

  async settle(
    tx: TenantSession,
    attemptId: string,
    input: UsageEventSettlement,
  ): Promise<'recorded' | 'duplicate'> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId || !uuid.safeParse(attemptId).success || !validUsage(input))
      throw new Error('Invalid usage event settlement');
    const selected = await client.query<UsageEventRow>(
      `SELECT * FROM app.usage_events
       WHERE org_id=$1 AND actor_user_id=$2 AND attempt_id=$3 FOR UPDATE`,
      [ctx.orgId, ctx.userId, attemptId],
    );
    const row = selected.rows[0];
    if (!row) throw new Error('Usage event reservation unavailable');
    if (row.outcome === 'reserved' || row.outcome === 'unknown') {
      if (row.outcome === 'unknown' && input.outcome === 'unknown') {
        if (sameSettlement(row, input)) return 'duplicate';
      } else {
        await client.query(
          `UPDATE app.usage_events SET outcome=$4,settled_at=COALESCE(settled_at,clock_timestamp()),
           reported_input_tokens=$5,reported_output_tokens=$6,cached_input_tokens=$7,
           reasoning_output_tokens=$8,cost_usd=$9
           WHERE org_id=$1 AND actor_user_id=$2 AND attempt_id=$3`,
          [
            ctx.orgId,
            ctx.userId,
            attemptId,
            input.outcome,
            input.inputTokens ?? null,
            input.outputTokens ?? null,
            input.cachedInputTokens ?? null,
            input.reasoningOutputTokens ?? null,
            input.costUsd ?? null,
          ],
        );
        return 'recorded';
      }
    }
    if (sameSettlement(row, input)) return 'duplicate';
    throw new Error('Conflicting usage event settlement');
  }

  async markUnknown(tx: TenantSession, attemptId: string): Promise<void> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId || !uuid.safeParse(attemptId).success) return;
    await client.query(
      `UPDATE app.usage_events SET outcome='unknown',settled_at=clock_timestamp()
       WHERE org_id=$1 AND actor_user_id=$2 AND attempt_id=$3 AND outcome='reserved'`,
      [ctx.orgId, ctx.userId, attemptId],
    );
  }
}
