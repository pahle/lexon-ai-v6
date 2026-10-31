import {
  TenantDatabase,
  ProcessedJobsRepository,
  type TenantSession,
} from '../../infrastructure/db/index.js';
import { parseJobEnvelope, type JobEnvelope } from './job-envelope.js';

export type TenantJobHandler = (
  tx: TenantSession,
  job: JobEnvelope,
) => Promise<void>;

export class JobExecutor {
  constructor(
    private readonly database: TenantDatabase,
    private readonly receipts = new ProcessedJobsRepository(),
  ) {}
  async execute(
    input: JobEnvelope,
    handler: TenantJobHandler,
  ): Promise<'processed' | 'duplicate'> {
    const job = parseJobEnvelope(input);
    return this.database.withTenant(job.ctx, async (tx) => {
      if (!(await this.receipts.tryRecord(tx, job.outboxId)))
        return 'duplicate';
      await handler(tx, job);
      return 'processed';
    });
  }
}
