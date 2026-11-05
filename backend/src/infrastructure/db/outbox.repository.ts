import { randomUUID } from 'node:crypto';
import {
  isJobQueue,
  parseJobEnvelope,
  type JobEnvelope,
  type JobQueue,
} from './job-envelope.js';
import { TenantDatabase } from './tenant-database.js';
import { inspectPool } from './tenant-session.js';
import { requireSession, type TenantSession } from './tenant-session.js';

export interface ClaimedOutbox {
  id: string;
  job: JobEnvelope | null;
  claimToken: string;
  attempts: number;
  queue: JobQueue | null;
  priority: number | null;
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
      queue_name: string | null;
      priority: number | null;
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
      const queue = row.queue_name === null ? null : row.queue_name;
      const priority = row.priority;
      const validRouting =
        (queue === null || isJobQueue(queue)) &&
        (priority === null ||
          (Number.isSafeInteger(priority) && priority >= 1 && priority <= 10));
      return {
        id: row.id,
        job: validRouting ? job : null,
        claimToken: row.claim_token,
        attempts: row.attempts,
        queue: isJobQueue(queue) ? queue : null,
        priority: validRouting ? priority : null,
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
    routing: { id?: string; queue?: JobQueue; priority?: number } = {},
  ): Promise<string> {
    const { client, ctx } = requireSession(tx);
    if (
      (routing.id !== undefined &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          routing.id,
        )) ||
      (routing.queue !== undefined && !isJobQueue(routing.queue)) ||
      (routing.priority !== undefined &&
        (!Number.isSafeInteger(routing.priority) ||
          routing.priority < 1 ||
          routing.priority > 10))
    )
      throw new Error('Invalid outbox routing');
    const job = parseJobEnvelope({
      ...input,
      outboxId: routing.id ?? randomUUID(),
    });
    if (job.ctx.orgId !== ctx.orgId || job.ctx.userId !== ctx.userId)
      throw new Error('Job context differs from tenant session context');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ops.outbox
       (id,type,org_id,user_id,payload,queue_name,priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        job.outboxId,
        job.type,
        job.ctx.orgId,
        job.ctx.userId ?? null,
        job.payload,
        routing.queue ?? null,
        routing.priority ?? null,
      ],
    );
    if (inserted.rowCount !== 1) {
      const existing = await client.query(
        `SELECT 1 FROM ops.outbox WHERE id=$1 AND org_id=$2
         AND user_id IS NOT DISTINCT FROM $3 AND type=$4 AND payload=$5::jsonb
         AND queue_name IS NOT DISTINCT FROM $6 AND priority IS NOT DISTINCT FROM $7`,
        [
          job.outboxId,
          job.ctx.orgId,
          job.ctx.userId ?? null,
          job.type,
          JSON.stringify(job.payload),
          routing.queue ?? null,
          routing.priority ?? null,
        ],
      );
      if (existing.rowCount !== 1)
        throw new Error('Outbox ID conflicts with existing job');
      return job.outboxId;
    }
    // Notifications are delivered only if the caller's transaction commits.
    await client.query("SELECT pg_notify('lexon_outbox', '')");
    return job.outboxId;
  }
}
