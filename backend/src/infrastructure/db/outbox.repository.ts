import { randomUUID } from 'node:crypto';
import {
  parseJobEnvelope,
  type JobEnvelope,
} from '../../modules/platform/index.js';
import { TenantDatabase } from './tenant-database.js';
import { inspectPool } from './tenant-session.js';
import { requireSession, type TenantSession } from './tenant-session.js';

export interface ClaimedOutbox {
  id: string;
  job: JobEnvelope | null;
  claimToken: string;
  attempts: number;
}
export class OutboxRepository {
  constructor(private readonly database?: TenantDatabase) {}
  private pool() {
    if (!this.database) throw new Error('Dispatcher database required');
    return inspectPool(this.database);
  }
  async claimBatch(options: {
    now: Date;
    limit: number;
    leaseMs: number;
  }): Promise<ClaimedOutbox[]> {
    if (
      !Number.isFinite(options.now.getTime()) ||
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      !Number.isSafeInteger(options.leaseMs) ||
      options.leaseMs < 1
    )
      throw new Error('Invalid claim options');
    const result = await this.pool().query<{
      id: string;
      type: string;
      org_id: string;
      user_id: string | null;
      payload: unknown;
      claim_token: string;
      attempts: number;
    }>(
      `WITH eligible AS (
 SELECT id FROM ops.outbox WHERE sent_at IS NULL AND next_attempt_at <= $1
 AND (claim_expires_at IS NULL OR claim_expires_at <= $1)
 ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $2
 ) UPDATE ops.outbox AS target SET claimed_at=$1,claim_token=gen_random_uuid(),
 claim_expires_at=$1::timestamptz + $3 * interval '1 millisecond',attempts=attempts+1
 FROM eligible WHERE target.id=eligible.id RETURNING target.*`,
      [options.now, options.limit, options.leaseMs],
    );
    return result.rows.map((row) => {
      let job: JobEnvelope | null = null;
      try {
        job = parseJobEnvelope({
          outboxId: row.id,
          type: row.type,
          ctx: {
            orgId: row.org_id,
            ...(row.user_id ? { userId: row.user_id } : {}),
          },
          payload: row.payload,
        });
      } catch {
        /* Retain malformed metadata and back off without exposing it. */
      }
      return {
        id: row.id,
        job,
        claimToken: row.claim_token,
        attempts: row.attempts,
      };
    });
  }
  async markSent(id: string, claimToken: string): Promise<boolean> {
    const result = await this.pool().query(
      `UPDATE ops.outbox SET sent_at=clock_timestamp(),claim_token=NULL,claim_expires_at=NULL,last_error_code=NULL WHERE id=$1 AND claim_token=$2 AND sent_at IS NULL AND claim_expires_at>clock_timestamp()`,
      [id, claimToken],
    );
    return result.rowCount === 1;
  }
  async reschedule(
    id: string,
    claimToken: string,
    nextAttemptAt: Date,
    errorCode: 'invalid_job' | 'enqueue_failed' = 'enqueue_failed',
  ): Promise<boolean> {
    const result = await this.pool().query(
      `UPDATE ops.outbox SET next_attempt_at=$3,claim_token=NULL,claim_expires_at=NULL,last_error_code=$4 WHERE id=$1 AND claim_token=$2 AND sent_at IS NULL AND claim_expires_at>clock_timestamp()`,
      [id, claimToken, nextAttemptAt, errorCode],
    );
    return result.rowCount === 1;
  }

  async append(
    tx: TenantSession,
    input: Omit<JobEnvelope, 'outboxId'>,
  ): Promise<string> {
    const { client, ctx } = requireSession(tx);
    const job = parseJobEnvelope({ ...input, outboxId: randomUUID() });
    if (job.ctx.orgId !== ctx.orgId || job.ctx.userId !== ctx.userId)
      throw new Error('Job context differs from tenant session context');
    await client.query(
      'INSERT INTO ops.outbox (id,type,org_id,user_id,payload) VALUES ($1,$2,$3,$4,$5)',
      [
        job.outboxId,
        job.type,
        job.ctx.orgId,
        job.ctx.userId ?? null,
        job.payload,
      ],
    );
    // Notifications are delivered only if the caller's transaction commits.
    await client.query("SELECT pg_notify('lexon_outbox', '')");
    return job.outboxId;
  }
}
