export { DbModule } from './db.module.js';
export { TenantDatabase, type DatabaseOptions } from './tenant-database.js';
export {
  buildAuthorizationPredicate,
  type TenantContext,
} from './authorization-predicate.js';
export type { TenantSession } from './tenant-session.js';
export { OutboxRepository } from './outbox.repository.js';
export { ProcessedJobsRepository } from './processed-jobs.repository.js';
