import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { canonicalJson, jsonbTextBytes } from './canonical-json.js';
import {
  inspectPool,
  requireSession,
  type TenantSession,
} from './tenant-session.js';
import type { TenantDatabase } from './tenant-database.js';
import type {
  ExpiredOperationCandidate,
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
  kind: OperationRecord['kind'];
  status: OperationRecord['status'];
  result: unknown | null;
  error_code: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
  decision?: OperationRecord['decision'];
  decision_by_user_id?: string | null;
  decided_at?: Date | null;
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
    kind: row.kind,
    status: row.status,
    result: row.result,
    errorCode: row.error_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    decision: row.decision ?? null,
    decidedByUserId: row.decision_by_user_id ?? null,
    decidedAt: row.decided_at ?? null,
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
  constructor(private readonly database?: TenantDatabase) {}

  private pool() {
    if (!this.database) throw new Error('Expiry discovery database required');
    return inspectPool(this.database);
  }

  /**
   * §7 sweep discovery: `app.ai_expired_operations` is a cross-tenant
   * SECURITY DEFINER function granted to `lexon_app`; it returns candidate
   * ids only, ordered by expires_at. The expiry itself still runs per
   * candidate inside `withTenant` under the candidate's own org.
   */
  async listExpired(
    limit: number,
  ): Promise<readonly ExpiredOperationCandidate[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024)
      throw new Error('Invalid expiry batch limit');
    const result = await this.pool().query<{
      org_id: string;
      id: string;
      run_id: string;
      initiating_user_id: string;
    }>(
      `SELECT org_id,id,run_id,initiating_user_id
       FROM app.ai_expired_operations($1)`,
      [limit],
    );
    return result.rows.map((row) =>
      Object.freeze({
        orgId: row.org_id,
        id: row.id,
        runId: row.run_id,
        initiatingUserId: row.initiating_user_id,
      }),
    );
  }

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
      jsonbTextBytes(proposal.args) > 16_384 ||
      (proposal.kind !== undefined &&
        !['approval', 'question'].includes(proposal.kind))
    )
      throw new Error('Invalid AI operation proposal');
    const kind = proposal.kind ?? 'approval';
    const { client, ctx } = requireSession(tx);
    const inserted = await client.query<OperationRow>(
      `INSERT INTO app.ai_operations(
         id,org_id,run_id,step_id,call_occurrence,tool_name,tool_version,
         idempotency_mode,args,args_hash,snapshot_hash,approval_required,status,
         kind,expires_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,
         CASE WHEN $13='awaiting_approval' THEN clock_timestamp()+interval '24 hours' END)
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
        kind,
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
      existing.approval_required !== proposal.approvalRequired ||
      existing.kind !== kind
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
         AND o.status IN ('pending','awaiting_approval','approved')
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
       WHERE org_id=$1 AND id=$2 AND status IN ('pending','approved')`,
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
       SET status='awaiting_approval',approval_required=true,
           expires_at=clock_timestamp()+interval '24 hours'
       WHERE org_id=$1 AND id=$2 AND status='pending'`,
      [ctx.orgId, operationId],
    );
    return result.rowCount === 1;
  }

  async decideApproval(
    tx: TenantSession,
    input: {
      runId: string;
      operationId: string;
      snapshotHash: string;
      userId: string;
      decision: 'approve' | 'reject' | 'answer' | 'dismiss';
      /** Stored result required for an 'answer' decision (the answers payload). */
      result?: unknown;
    },
  ): Promise<OperationRecord | null> {
    const { client, ctx } = requireSession(tx);
    if (
      ctx.userId !== input.userId ||
      !uuid.safeParse(input.runId).success ||
      !uuid.safeParse(input.operationId).success ||
      !/^[0-9a-f]{64}$/.test(input.snapshotHash) ||
      (input.decision === 'answer' && input.result === undefined)
    )
      return null;
    if (input.result !== undefined && jsonbTextBytes(input.result) > 16_384)
      throw new Error('AI operation result exceeds storage limit');
    const status = {
      approve: 'approved',
      reject: 'rejected',
      answer: 'answered',
      dismiss: 'dismissed',
    }[input.decision] as OperationRecord['status'];
    const result =
      input.decision === 'approve'
        ? null
        : input.decision === 'reject'
          ? { denied: true }
          : input.decision === 'dismiss'
            ? { answered_in_chat: true }
            : input.result;
    const updated = await client.query<OperationRow>(
      `UPDATE app.ai_operations
       SET status=$5,decision=$6,decision_by_user_id=$4,decided_at=clock_timestamp(),
           expires_at=NULL,result=$7::jsonb,
           completed_at=CASE WHEN $6='approve' THEN NULL ELSE clock_timestamp() END
       WHERE org_id=$1 AND run_id=$2 AND id=$3 AND snapshot_hash=$8
         AND approval_required=true AND status='awaiting_approval' AND decision IS NULL
         AND ((kind='approval' AND $6 IN ('approve','reject'))
           OR (kind='question' AND $6 IN ('answer','dismiss')))
       RETURNING *`,
      [
        ctx.orgId,
        input.runId,
        input.operationId,
        input.userId,
        status,
        input.decision,
        result === null || result === undefined ? null : JSON.stringify(result),
        input.snapshotHash,
      ],
    );
    return updated.rows[0] ? mapOperation(updated.rows[0]) : null;
  }

  /**
   * §6.4 send-while-paused supersede CAS: a still-waiting panel op settles
   * by kind — approvals reject with {denied:'superseded'}, questions dismiss
   * with {answered_in_chat:true}. decision/decision_by_user_id/decided_at are
   * stamped like an owner decision; the message send carries the reason in
   * the audit trail instead. Returns null when a concurrent decide already
   * won the row.
   */
  async supersedeForMessage(
    tx: TenantSession,
    input: { runId: string; operationId: string; userId: string },
  ): Promise<OperationRecord | null> {
    const { client, ctx } = requireSession(tx);
    if (
      ctx.userId !== input.userId ||
      !uuid.safeParse(input.runId).success ||
      !uuid.safeParse(input.operationId).success
    )
      return null;
    const updated = await client.query<OperationRow>(
      `UPDATE app.ai_operations
       SET status=CASE WHEN kind='approval' THEN 'rejected' ELSE 'dismissed' END,
           decision=CASE WHEN kind='approval' THEN 'reject' ELSE 'dismiss' END,
           decision_by_user_id=$4,decided_at=clock_timestamp(),
           result=CASE WHEN kind='approval' THEN '{"denied":"superseded"}'::jsonb
                       ELSE '{"answered_in_chat":true}'::jsonb END,
           completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=$1 AND run_id=$2 AND id=$3
         AND status='awaiting_approval' AND decision IS NULL
       RETURNING *`,
      [ctx.orgId, input.runId, input.operationId, input.userId],
    );
    return updated.rows[0] ? mapOperation(updated.rows[0]) : null;
  }

  /**
   * §6.4 supersede leftovers: pending ops (and any still-waiting sibling) of
   * the superseded run settle failed with {not_run:'superseded_by_message'}.
   * decision, decision_by_user_id and decided_at stay NULL — the lifecycle
   * CHECK requires undecided rows to keep all three clear.
   */
  async failUnresolvedForSupersede(
    tx: TenantSession,
    input: { runId: string },
  ): Promise<number> {
    const { client, ctx } = requireSession(tx);
    if (!uuid.safeParse(input.runId).success) return 0;
    const updated = await client.query(
      `UPDATE app.ai_operations
       SET status='failed',
           result='{"not_run":"superseded_by_message"}'::jsonb,
           completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=$1 AND run_id=$2
         AND status IN ('pending','awaiting_approval') AND decision IS NULL`,
      [ctx.orgId, input.runId],
    );
    return updated.rowCount ?? 0;
  }

  /**
   * Expiry sweep CAS: closes a still-waiting op as 'expired' with the stored
   * result the model or thread record reads ({expired:'approval'} /
   * {unanswered:true}). decision stays NULL and decision_by_user_id
   * stays NULL — expiry is actor-less by contract.
   */
  async expire(
    tx: TenantSession,
    input: { runId: string; operationId: string },
  ): Promise<OperationRecord | null> {
    const { client, ctx } = requireSession(tx);
    if (
      !uuid.safeParse(input.runId).success ||
      !uuid.safeParse(input.operationId).success
    )
      return null;
    const updated = await client.query<OperationRow>(
      `UPDATE app.ai_operations
       SET status='expired',decided_at=clock_timestamp(),expires_at=NULL,
           result=CASE WHEN kind='approval' THEN '{"expired":"approval"}'::jsonb
            ELSE '{"unanswered":true}'::jsonb END,
           completed_at=clock_timestamp()
       WHERE org_id=$1 AND run_id=$2 AND id=$3
         AND status='awaiting_approval' AND decision IS NULL
         AND expires_at <= clock_timestamp()
       RETURNING *`,
      [ctx.orgId, input.runId, input.operationId],
    );
    return updated.rows[0] ? mapOperation(updated.rows[0]) : null;
  }

  async rejectApprovalForAccessLoss(
    tx: TenantSession,
    input: {
      runId: string;
      operationId: string;
      snapshotHash: string;
      initiatorUserId: string;
    },
  ): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    if (
      ctx.userId !== input.initiatorUserId ||
      !uuid.safeParse(input.runId).success ||
      !uuid.safeParse(input.operationId).success ||
      !/^[0-9a-f]{64}$/.test(input.snapshotHash)
    )
      return false;
    const result = await client.query(
      `UPDATE app.ai_operations
       SET status='rejected',decision='reject',decision_by_user_id=$4,
           decided_at=clock_timestamp(),result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
           error_code='AI_ACCESS_REVOKED',completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=$1 AND run_id=$2 AND id=$3 AND snapshot_hash=$5
         AND approval_required=true AND status='awaiting_approval' AND decision IS NULL`,
      [
        ctx.orgId,
        input.runId,
        input.operationId,
        input.initiatorUserId,
        input.snapshotHash,
      ],
    );
    return result.rowCount === 1;
  }

  async rejectApprovedForAccessLoss(
    tx: TenantSession,
    operationId: string,
  ): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    const result = await client.query(
      `UPDATE app.ai_operations
       SET status='rejected',error_code='AI_ACCESS_REVOKED',
           result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
           completed_at=clock_timestamp(),expires_at=NULL
       WHERE org_id=$1 AND id=$2 AND status='approved' AND decision='approve'`,
      [ctx.orgId, operationId],
    );
    return result.rowCount === 1;
  }

  async failPendingForAccessLoss(
    tx: TenantSession,
    operationId: string,
  ): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    const result = await client.query(
      `UPDATE app.ai_operations
       SET status='failed',error_code='AI_ACCESS_REVOKED',
           result='{"errorCode":"AI_ACCESS_REVOKED"}'::jsonb,
           completed_at=clock_timestamp()
       WHERE org_id=$1 AND id=$2 AND approval_required=false
         AND status='pending' AND decision IS NULL`,
      [ctx.orgId, operationId],
    );
    return result.rowCount === 1;
  }
}
