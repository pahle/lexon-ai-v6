export { DbModule } from './db.module.js';
export { TenantDatabase, type DatabaseOptions } from './tenant-database.js';
export {
  buildAuthorizationPredicate,
  type TenantContext,
} from './authorization-predicate.js';
export type { TenantSession } from './tenant-session.js';
export { AuditRepository } from './audit.repository.js';
export type { AuditWriteRecord } from './audit-write-record.js';
export type { AuthCommandSession } from './auth/auth-types.js';
export type { AuthIntegration } from './auth/auth-types.js';
export { appendAuthAuditRecord } from './auth/auth-functions.js';
export { OutboxRepository } from './outbox.repository.js';
export { ProcessedJobsRepository } from './processed-jobs.repository.js';
export { DispatcherSession } from './dispatcher-session.js';
export {
  parseJobEnvelope,
  type JobEnvelope,
  type TenantJobHandler,
} from './job-envelope.js';
export type { ClaimedOutbox } from './outbox.repository.js';
export type {
  AdminSetupOperator,
  AdminSetupOperatorFacts,
  AdminSetupGrant,
} from './auth/admin-setup-operator.js';
export { createAdminSetupOperator } from './auth/admin-setup-operator.js';
