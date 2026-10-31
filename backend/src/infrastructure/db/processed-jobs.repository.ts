import { z } from 'zod';
import { requireSession, type TenantSession } from './tenant-session.js';

export class ProcessedJobsRepository {
  async tryRecord(tx: TenantSession, outboxId: string): Promise<boolean> {
    const { client } = requireSession(tx);
    if (!z.uuid().safeParse(outboxId).success)
      throw new Error('Invalid outbox ID');
    const result = await client.query(
      'INSERT INTO ops.processed_jobs (outbox_id) VALUES ($1) ON CONFLICT (outbox_id) DO NOTHING RETURNING outbox_id',
      [outboxId],
    );
    return result.rowCount === 1;
  }
}
