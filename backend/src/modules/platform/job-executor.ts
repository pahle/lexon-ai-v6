import {
  TenantDatabase,
  ProcessedJobsRepository,
  parseJobEnvelope,
  type JobEnvelope,
  type TenantJobHandler,
} from '../../infrastructure/db/index.js';

export type { TenantJobHandler };

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
