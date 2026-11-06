import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { canonicalJson, jsonbTextBytes } from './canonical-json.js';
import { requireSession, type TenantSession } from './tenant-session.js';
import type {
  OperationProposal,
  OperationRecord,
  StepClaim,
} from './ai-records.js';

const uuid = z.uuid();

interface OperationRow {
  id: string;
  org_id: string;
  run_id: string;
  step_id: string;
  call_occurrence: number;
  tool_name: string;
  tool_version: number;
  idempotency_mode: OperationRecord['mode'];
  args: unknown;
  args_hash: string;
  snapshot_hash: string;
  approval_required: boolean;
  status: OperationRecord['status'];
  result: unknown | null;
  error_code: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function mapOperation(row: OperationRow): OperationRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    stepId: row.step_id,
    callOccurrence: Number(row.call_occurrence),
    toolName: row.tool_name,
    toolVersion: Number(row.tool_version),
    mode: row.idempotency_mode,
    args: row.args,
    argsHash: row.args_hash,
    snapshotHash: row.snapshot_hash,
    approvalRequired: row.approval_required,
    status: row.status,
    result: row.result,
    errorCode: row.error_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
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

export function hashOperationArgs(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export class AiOperationRepository {
  async persist(
    tx: TenantSession,
    claim: StepClaim,
    proposal: OperationProposal,
  ): Promise<OperationRecord> {
    if (
      !validClaim(tx, claim) ||
      !Number.isSafeInteger(proposal.callOccurrence) ||
      proposal.callOccurrence < 0 ||
      !proposal.toolName.trim() ||
      !Number.isSafeInteger(proposal.toolVersion) ||
      proposal.toolVersion < 1 ||
      !/^[0-9a-f]{64}$/.test(proposal.snapshotHash) ||
      hashOperationArgs(proposal.args) !== proposal.argsHash ||
      jsonbTextBytes(proposal.args) > 16_384
    )
      throw new Error('Invalid AI operation proposal');
    const { client, ctx } = requireSession(tx);
    const inserted = await client.query<OperationRow>(
      `INSERT INTO app.ai_operations(
         id,org_id,run_id,step_id,call_occurrence,tool_name,tool_version,
         idempotency_mode,args,args_hash,snapshot_hash,approval_required,status
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
       ON CONFLICT(org_id,run_id,step_id,call_occurrence) DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        ctx.orgId,
        claim.runId,
        claim.stepId,
        proposal.callOccurrence,
        proposal.toolName,
        proposal.toolVersion,
        proposal.mode,
        JSON.stringify(proposal.args),
        proposal.argsHash,
        proposal.snapshotHash,
        proposal.approvalRequired,
        proposal.approvalRequired ? 'awaiting_approval' : 'pending',
      ],
    );
    const existing =
      inserted.rows[0] ??
      (
        await client.query<OperationRow>(
          `SELECT * FROM app.ai_operations
           WHERE org_id=$1 AND run_id=$2 AND step_id=$3 AND call_occurrence=$4`,
          [ctx.orgId, claim.runId, claim.stepId, proposal.callOccurrence],
        )
      ).rows[0];
    if (!existing) throw new Error('AI operation persistence failed');
    if (
      existing.tool_name !== proposal.toolName ||
      Number(existing.tool_version) !== proposal.toolVersion ||
      existing.idempotency_mode !== proposal.mode ||
      existing.args_hash !== proposal.argsHash ||
      existing.snapshot_hash !== proposal.snapshotHash ||
      existing.approval_required !== proposal.approvalRequired
    )
      throw new Error('AI operation occurrence conflict');
    return mapOperation(existing);
  }

  async forRun(
    tx: TenantSession,
    input: { runId: string; throughSequence: number },
  ): Promise<OperationRecord[]> {
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = await client.query<OperationRow>(
      `SELECT o.* FROM app.ai_operations o
       JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
       WHERE o.org_id=$1 AND o.run_id=$2 AND s.sequence<$3
       ORDER BY s.sequence,o.call_occurrence`,
      [scope.orgId, input.runId, input.throughSequence],
    );
    return result.rows.map(mapOperation);
  }

  async pendingFromPreviousStep(
    tx: TenantSession,
    claim: StepClaim,
  ): Promise<OperationRecord[]> {
    if (!validClaim(tx, claim) || claim.sequence <= 1) return [];
    const { client, ctx } = requireSession(tx);
    const result = await client.query<OperationRow>(
      `SELECT o.* FROM app.ai_operations o
       JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
       WHERE o.org_id=$1 AND o.run_id=$2 AND s.sequence<$3
         AND o.status IN ('pending','awaiting_approval')
       ORDER BY s.sequence,o.call_occurrence FOR UPDATE OF o`,
      [ctx.orgId, claim.runId, claim.sequence],
    );
    return result.rows.map(mapOperation);
  }

  async findForExecution(
    tx: TenantSession,
    claim: StepClaim,
    operationId: string,
  ): Promise<OperationRecord | null> {
    if (!validClaim(tx, claim) || !uuid.safeParse(operationId).success)
      return null;
    const { client, ctx } = requireSession(tx);
    const row = (
      await client.query<OperationRow>(
        `SELECT o.* FROM app.ai_operations o
         JOIN app.ai_steps source ON source.org_id=o.org_id AND source.run_id=o.run_id AND source.id=o.step_id
         JOIN app.ai_steps current ON current.org_id=source.org_id AND current.run_id=source.run_id
         WHERE o.org_id=$1 AND o.run_id=$2 AND o.id=$3
           AND source.sequence<$4 AND current.id=$5 AND current.sequence=$4
           AND current.expected_version=$6 AND current.fence=$7 AND current.state='claimed'
           AND current.lease_until>clock_timestamp()
         FOR UPDATE OF o`,
        [
          ctx.orgId,
          claim.runId,
          operationId,
          claim.sequence,
          claim.stepId,
          claim.expectedVersion,
          claim.fence,
        ],
      )
    ).rows[0];
    return row ? mapOperation(row) : null;
  }

  async complete(
    tx: TenantSession,
    operationId: string,
    input: {
      status: 'succeeded' | 'failed' | 'outcome_unknown';
      result: unknown;
      errorCode?: string;
    },
  ): Promise<boolean> {
    if (jsonbTextBytes(input.result) > 16_384)
      throw new Error('AI operation result exceeds storage limit');
    const { client, ctx } = requireSession(tx);
    const result = await client.query(
      `UPDATE app.ai_operations
       SET status=$3,result=$4::jsonb,error_code=$5,completed_at=clock_timestamp()
       WHERE org_id=$1 AND id=$2 AND status='pending'`,
      [
        ctx.orgId,
        operationId,
        input.status,
        JSON.stringify(input.result),
        input.errorCode ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async stageApproval(
    tx: TenantSession,
    operationId: string,
  ): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    const result = await client.query(
      `UPDATE app.ai_operations
       SET status='awaiting_approval',approval_required=true
       WHERE org_id=$1 AND id=$2 AND status='pending'`,
      [ctx.orgId, operationId],
    );
    return result.rowCount === 1;
  }
}
