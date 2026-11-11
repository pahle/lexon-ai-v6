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
export { assertTenantSession } from './tenant-session.js';
export { AuditRepository } from './audit.repository.js';
export type { AuditWriteRecord } from './audit-write-record.js';
export type { AuthCommandSession } from './auth/auth-types.js';
export type { AuthIntegration } from './auth/auth-types.js';
export { appendAuthAuditRecord } from './auth/auth-functions.js';
export { OutboxRepository } from './outbox.repository.js';
export { ProcessedJobsRepository } from './processed-jobs.repository.js';
export { AiRunRepository } from './ai-run.repository.js';
export { AiChatResourceRepository } from './ai-chat-resource.repository.js';
export { ChatRepository } from './chat.repository.js';
export { chatTitleJobId } from './chat-title-job-id.js';
export { ChatDeletionRepository } from './chat-deletion.repository.js';
export { chatCleanupJobId } from './chat-cleanup-job-id.js';
export type { ChatCleanupPhase } from './chat-cleanup-job-id.js';
export type {
  ChatDeletionState,
  ChatDeletionWork,
} from './chat-deletion.repository.js';
export { StepPermitReferenceRepository } from './step-permit.repository.js';
export type {
  StepPermitOwner,
  StepPermitReference,
} from './step-permit.repository.js';
export type { ChatRecord } from './chat.repository.js';
export { ChatMessageRepository } from './chat-message.repository.js';
export type { ChatMessageRecord, ChatTree } from './chat-message.repository.js';
export { ChatMutationRepository } from './chat-mutation.repository.js';
export type {
  ChatCreateRequestRecord,
  ExistingChatMessageMutation,
} from './chat-mutation.repository.js';
export {
  assertRunActorFactsSession,
  RunActorFactsRepository,
  type RunActorFacts,
} from './run-actor-facts.js';
export { AiStepRepository } from './ai-step.repository.js';
export { AiAttemptRepository } from './ai-attempt.repository.js';
export { UsageEventRepository } from './usage-event.repository.js';
export type {
  UsageEventDescriptor,
  UsageEventSettlement,
} from './usage-event.repository.js';
export { AiOperationRepository } from './ai-operation.repository.js';
export { canonicalJson, jsonbTextBytes } from './canonical-json.js';
export { hashOperationArgs } from './ai-operation.repository.js';
export { AiCapacityRepository } from './ai-capacity.repository.js';
export { DispatcherSession } from './dispatcher-session.js';
export {
  CHAT_DELETION_NOTIFICATION_CHANNEL,
  PgNotificationListener,
} from './pg-notification-listener.js';
export {
  isJobQueue,
  parseJobEnvelope,
  isRunStepJob,
  type JobQueue,
  type JobEnvelope,
  type RunStepJobEnvelope,
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
  CommittedStreamReference,
  TerminalStreamReference,
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
