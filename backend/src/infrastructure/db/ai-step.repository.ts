import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';
import type {
  StepClaim,
  StepCommit,
  StepRecord,
  StepState,
} from './ai-records.js';

const uuid = z.uuid();
interface StepRow {
  id: string;
  org_id: string;
  run_id: string;
  sequence: number;
  expected_version: number;
  state: StepState;
  fence: string | number;
  lease_until: Date | null;
  committed_text: string | null;
  commit_data: unknown | null;
  updated_at: Date;
}

function mapStep(row: StepRow): StepRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    sequence: row.sequence,
    expectedVersion: row.expected_version,
    state: row.state,
    fence: Number(row.fence),
    leaseUntil: row.lease_until,
    committedText: row.committed_text,
    commitData: row.commit_data,
    updatedAt: row.updated_at,
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
    claim.fence > 0 &&
    claim.leaseUntil instanceof Date &&
    Number.isFinite(claim.leaseUntil.getTime())
  );
}

function validLease(leaseMs: number): boolean {
  return Number.isSafeInteger(leaseMs) && leaseMs > 0;
}

export class AiStepRepository {
  async find(
    tx: TenantSession,
    input: { runId: string; sequence: number },
  ): Promise<StepRecord | null> {
    if (
      !uuid.safeParse(input.runId).success ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 1
    )
      throw new Error('Invalid AI step lookup');
    const { client, ctx } = requireSession(tx);
    const scope = buildAuthorizationPredicate(ctx);
    const result = await client.query<StepRow>(
      'SELECT * FROM app.ai_steps WHERE org_id=$1 AND run_id=$2 AND sequence=$3',
      [scope.orgId, input.runId, input.sequence],
    );
    return result.rows[0] ? mapStep(result.rows[0]) : null;
  }

  /** Lock and revalidate the run before the step; locks remain held by the caller's transaction. */
  async lockClaim(tx: TenantSession, claim: StepClaim): Promise<boolean> {
    if (!validClaim(tx, claim)) return false;
    const { client } = requireSession(tx);
    const run = await client.query(
      `SELECT 1 FROM app.ai_runs
       WHERE org_id=$1 AND id=$2 AND run_version=$3 AND next_sequence=$4
         AND status IN ('queued','running','awaiting_approval','cancelling')
       FOR UPDATE`,
      [claim.orgId, claim.runId, claim.expectedVersion, claim.sequence],
    );
    if (run.rowCount !== 1) return false;
    const step = await client.query(
      `SELECT 1 FROM app.ai_steps
       WHERE org_id=$1 AND run_id=$2 AND id=$3 AND sequence=$4 AND expected_version=$5
         AND fence=$6 AND state='claimed' AND lease_until>clock_timestamp()
       FOR UPDATE`,
      [
        claim.orgId,
        claim.runId,
        claim.stepId,
        claim.sequence,
        claim.expectedVersion,
        claim.fence,
      ],
    );
    return step.rowCount === 1;
  }

  async claim(
    tx: TenantSession,
    input: {
      runId: string;
      sequence: number;
      expectedVersion: number;
      leaseMs: number;
    },
  ): Promise<StepClaim | null> {
    const { client, ctx } = requireSession(tx);
    if (
      !ctx.userId ||
      !uuid.safeParse(input.runId).success ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 1 ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !validLease(input.leaseMs)
    )
      return null;
    const scope = buildAuthorizationPredicate(ctx);
    const run = await client.query(
      `SELECT 1 FROM app.ai_runs WHERE org_id=$1 AND id=$2 AND run_version=$3
       AND next_sequence=$4 AND status IN ('queued','running','awaiting_approval','cancelling') FOR UPDATE`,
      [scope.orgId, input.runId, input.expectedVersion, input.sequence],
    );
    if (run.rowCount !== 1) return null;
    const selected = await client.query<StepRow & { lease_live: boolean }>(
      `SELECT s.*,(s.lease_until IS NOT NULL AND s.lease_until>clock_timestamp()) AS lease_live
       FROM app.ai_steps s
       WHERE s.org_id=$1 AND s.run_id=$2 AND s.sequence=$3 AND s.expected_version=$4
       FOR UPDATE`,
      [scope.orgId, input.runId, input.sequence, input.expectedVersion],
    );
    const current = selected.rows[0];
    if (!current || !['pending', 'claimed'].includes(current.state))
      return null;
    if (current.state === 'claimed' && current.lease_live) return null;

    if (current.state === 'claimed') {
      await client.query(
        `UPDATE app.ai_attempts SET active=false,outcome='unknown',settled_at=clock_timestamp()
         WHERE org_id=$1 AND step_id=$2 AND fence=$3 AND active=true`,
        [scope.orgId, current.id, current.fence],
      );
    }
    const claimed = await client.query<StepRow>(
      `UPDATE app.ai_steps SET state='claimed',fence=fence+1,
       lease_until=clock_timestamp()+($5 * interval '1 millisecond'),updated_at=clock_timestamp()
       WHERE org_id=$1 AND run_id=$2 AND sequence=$3 AND expected_version=$4
       RETURNING *`,
      [
        scope.orgId,
        input.runId,
        input.sequence,
        input.expectedVersion,
        input.leaseMs,
      ],
    );
    const row = claimed.rows[0];
    if (!row) return null;
    return {
      runId: row.run_id,
      orgId: row.org_id,
      userId: ctx.userId,
      stepId: row.id,
      sequence: row.sequence,
      expectedVersion: row.expected_version,
      fence: Number(row.fence),
      leaseUntil: row.lease_until!,
    };
  }

  async renew(
    tx: TenantSession,
    claim: StepClaim,
    leaseMs: number,
  ): Promise<boolean> {
    if (
      !validClaim(tx, claim) ||
      !validLease(leaseMs) ||
      !(await this.lockClaim(tx, claim))
    )
      return false;
    const { client } = requireSession(tx);
    const result = await client.query(
      `UPDATE app.ai_steps s SET lease_until=clock_timestamp()+($7 * interval '1 millisecond'),updated_at=clock_timestamp()
       FROM app.ai_runs r
       WHERE s.org_id=$1 AND s.run_id=$2 AND s.id=$3 AND s.sequence=$4
         AND s.expected_version=$5 AND s.fence=$6 AND s.state='claimed'
         AND s.lease_until>clock_timestamp() AND r.org_id=s.org_id AND r.id=s.run_id
         AND r.run_version=$5 AND r.next_sequence=$4
         AND r.status IN ('queued','running','awaiting_approval','cancelling')`,
      [
        claim.orgId,
        claim.runId,
        claim.stepId,
        claim.sequence,
        claim.expectedVersion,
        claim.fence,
        leaseMs,
      ],
    );
    return result.rowCount === 1;
  }

  async checkpoint(
    tx: TenantSession,
    claim: StepClaim,
    input: { attemptId: string; text: string },
  ): Promise<boolean> {
    if (
      !validClaim(tx, claim) ||
      !uuid.safeParse(input.attemptId).success ||
      Buffer.byteLength(input.text, 'utf8') > 262144
    )
      return false;
    if (!(await this.lockClaim(tx, claim))) return false;
    const { client } = requireSession(tx);
    const result = await client.query(
      `INSERT INTO app.ai_checkpoints(org_id,run_id,step_id,attempt_id,fence,text)
       SELECT s.org_id,s.run_id,s.id,a.id,s.fence,$7
       FROM app.ai_steps s JOIN app.ai_attempts a ON a.org_id=s.org_id AND a.step_id=s.id
       JOIN app.ai_runs r ON r.org_id=s.org_id AND r.id=s.run_id
       WHERE s.org_id=$1 AND s.run_id=$2 AND s.id=$3 AND s.sequence=$4 AND s.expected_version=$5
         AND s.fence=$6 AND s.state='claimed' AND s.lease_until>clock_timestamp()
         AND r.run_version=$5 AND r.next_sequence=$4 AND r.status IN ('queued','running','awaiting_approval','cancelling')
         AND a.id=$8 AND a.fence=s.fence AND a.active=true
       ON CONFLICT(step_id,fence) DO UPDATE SET text=EXCLUDED.text,attempt_id=EXCLUDED.attempt_id,created_at=clock_timestamp()
         WHERE app.ai_checkpoints.attempt_id=EXCLUDED.attempt_id OR EXISTS (
           SELECT 1 FROM app.ai_attempts prior
           WHERE prior.org_id=app.ai_checkpoints.org_id AND prior.id=app.ai_checkpoints.attempt_id
             AND prior.active=false
         )
       RETURNING id`,
      [
        claim.orgId,
        claim.runId,
        claim.stepId,
        claim.sequence,
        claim.expectedVersion,
        claim.fence,
        input.text,
        input.attemptId,
      ],
    );
    return result.rowCount === 1;
  }

  async commit(
    tx: TenantSession,
    claim: StepClaim,
    commit: StepCommit,
  ): Promise<boolean> {
    let data: string;
    try {
      data = JSON.stringify(commit.data);
    } catch {
      return false;
    }
    if (
      !validClaim(tx, claim) ||
      !['committed', 'awaiting_approval'].includes(commit.state) ||
      Buffer.byteLength(commit.text, 'utf8') > 262144 ||
      typeof data !== 'string' ||
      Buffer.byteLength(data, 'utf8') > 262144 ||
      !(await this.lockClaim(tx, claim))
    )
      return false;
    const { client } = requireSession(tx);
    const result = await client.query(
      `UPDATE app.ai_steps s SET state=$7,committed_text=$8,commit_data=$9::jsonb,
       lease_until=NULL,updated_at=clock_timestamp()
       FROM app.ai_runs r
       WHERE s.org_id=$1 AND s.run_id=$2 AND s.id=$3 AND s.sequence=$4 AND s.expected_version=$5
         AND s.fence=$6 AND s.state='claimed' AND s.lease_until>clock_timestamp()
         AND r.org_id=s.org_id AND r.id=s.run_id AND r.run_version=$5 AND r.next_sequence=$4
         AND r.status IN ('queued','running','awaiting_approval')`,
      [
        claim.orgId,
        claim.runId,
        claim.stepId,
        claim.sequence,
        claim.expectedVersion,
        claim.fence,
        commit.state,
        commit.text,
        data,
      ],
    );
    return result.rowCount === 1;
  }
}
