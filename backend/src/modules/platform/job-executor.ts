import {
  TenantDatabase,
  ProcessedJobsRepository,
  parseJobEnvelope,
  type TenantSession,
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
      return this.executeWithin(tx, job, handler);
    });
  }

  /** Record the receipt and effects inside a tenant transaction owned by the caller. */
  async executeWithin(
    tx: TenantSession,
    input: JobEnvelope,
    handler: TenantJobHandler,
  ): Promise<'processed' | 'duplicate'> {
    const job = parseJobEnvelope(input);
    this.database.assertSessionContext(tx, job.ctx);
    if (!(await this.receipts.tryRecord(tx, job.outboxId))) return 'duplicate';
    await handler(tx, job);
    return 'processed';
  }
}
