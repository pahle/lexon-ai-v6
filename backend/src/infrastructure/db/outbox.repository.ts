import { randomUUID } from 'node:crypto';
import {
  parseJobEnvelope,
  type JobEnvelope,
} from '../../modules/platform/index.js';
import { requireSession, type TenantSession } from './tenant-session.js';

export class OutboxRepository {
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
