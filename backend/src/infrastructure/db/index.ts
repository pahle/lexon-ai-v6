export { DbModule } from './db.module.js';
export {
  TenantDatabase,
  TenantTransactionTimeoutError,
  type DatabaseOptions,
  type TenantTransactionOptions,
} from './tenant-database.js';
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
export { AiRunRepository } from './ai-run.repository.js';
export {
  assertRunActorFactsSession,
  RunActorFactsRepository,
  type RunActorFacts,
} from './run-actor-facts.js';
export { AiStepRepository } from './ai-step.repository.js';
export { AiAttemptRepository } from './ai-attempt.repository.js';
export { AiOperationRepository } from './ai-operation.repository.js';
export { canonicalJson, jsonbTextBytes } from './canonical-json.js';
export { hashOperationArgs } from './ai-operation.repository.js';
export { AiCapacityRepository } from './ai-capacity.repository.js';
export { DispatcherSession } from './dispatcher-session.js';
export {
  isJobQueue,
  parseJobEnvelope,
  type JobQueue,
  type JobEnvelope,
  type TenantJobHandler,
} from './job-envelope.js';
export type { ClaimedOutbox } from './outbox.repository.js';
export type {
  AiRunStatus,
  RunRecord,
  RunInsert,
  StepRecord,
  StepState,
  StepClaim,
  StepCommit,
  AttemptRecord,
  AttemptInsert,
  ReportedUsage,
  OperationProposal,
  OperationRecord,
  AiOperationMode,
  AiOperationStatus,
} from './ai-records.js';
export type {
  AdminSetupOperator,
  AdminSetupOperatorFacts,
  AdminSetupGrant,
} from './auth/admin-setup-operator.js';
export { createAdminSetupOperator } from './auth/admin-setup-operator.js';
export async function createAuthRuntime(
  options: import('./auth/auth-types.js').AuthEngineOptions,
) {
  return (await import('./auth/auth-runtime.js')).createAuthRuntime(options);
}
