import {
  pgSchema,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  bigint,
  numeric,
  index,
  uniqueIndex,
  foreignKey,
  smallint,
} from 'drizzle-orm/pg-core';
const ops = pgSchema('ops');
const app = pgSchema('app');
export const outbox = ops.table('outbox', {
  id: uuid().primaryKey(),
  type: text().notNull(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id'),
  payload: jsonb().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  claimToken: uuid('claim_token'),
  claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
  lastErrorCode: text('last_error_code'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  attempts: integer().default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  queueName: text('queue_name'),
  priority: smallint('priority'),
});
export const processedJobs = ops.table('processed_jobs', {
  outboxId: uuid('outbox_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const auditEvents = ops.table('audit_events', {
  eventId: uuid('event_id').primaryKey(),
  version: integer().notNull(),
  type: text().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  outcome: text().notNull(),
  actorUserId: uuid('actor_user_id'),
  subjectUserId: uuid('subject_user_id'),
  sessionId: uuid('session_id'),
  orgId: uuid('org_id'),
  invitationId: uuid('invitation_id'),
  memberId: uuid('member_id'),
  requestId: uuid('request_id'),
  metadata: jsonb().notNull(),
});

export const aiRuns = app.table(
  'ai_runs',
  {
    id: uuid().primaryKey(),
    orgId: uuid('org_id').notNull(),
    initiatingUserId: uuid('initiating_user_id').notNull(),
    profileId: text('profile_id').notNull(),
    profileVersion: integer('profile_version').notNull(),
    resolvedConfig: jsonb('resolved_config').notNull(),
    modelId: text('model_id').notNull(),
    inputText: text('input_text').notNull(),
    status: text().notNull(),
    runVersion: integer('run_version').notNull(),
    nextSequence: integer('next_sequence').notNull(),
    modelIterations: integer('model_iterations').notNull(),
    inputBudgetTokens: bigint('input_budget_tokens', {
      mode: 'number',
    }).notNull(),
    outputBudgetTokens: bigint('output_budget_tokens', {
      mode: 'number',
    }).notNull(),
    partialOutput: text('partial_output').notNull(),
    finalOutput: text('final_output'),
    reasoningSummary: text('reasoning_summary'),
    reasoningDurationMs: integer('reasoning_duration_ms'),
    streamGeneration: bigint('stream_generation', { mode: 'number' }).notNull(),
    streamSnapshotGeneration: bigint('stream_snapshot_generation', {
      mode: 'number',
    }).notNull(),
    streamEventId: text('stream_event_id'),
    streamAttemptId: uuid('stream_attempt_id'),
    streamRevision: integer('stream_revision').notNull(),
    streamResumable: boolean('stream_resumable').notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ai_runs_org_id_id').on(table.orgId, table.id),
    index('ai_runs_org_created').on(table.orgId, table.createdAt, table.id),
  ],
);

export const aiSteps = app.table(
  'ai_steps',
  {
    id: uuid().primaryKey(),
    orgId: uuid('org_id').notNull(),
    runId: uuid('run_id').notNull(),
    sequence: integer().notNull(),
    expectedVersion: integer('expected_version').notNull(),
    state: text().notNull(),
    fence: bigint({ mode: 'number' }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    committedText: text('committed_text'),
    commitData: jsonb('commit_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('ai_steps_run_sequence').on(table.runId, table.sequence),
    uniqueIndex('ai_steps_org_id_id').on(table.orgId, table.id),
    uniqueIndex('ai_steps_org_run_id').on(table.orgId, table.runId, table.id),
    index('ai_steps_claimable').on(
      table.orgId,
      table.runId,
      table.sequence,
      table.state,
      table.leaseUntil,
    ),
    foreignKey({
      name: 'ai_steps_run_fk',
      columns: [table.orgId, table.runId],
      foreignColumns: [aiRuns.orgId, aiRuns.id],
    }).onDelete('cascade'),
  ],
);

export const aiOperations = app.table(
  'ai_operations',
  {
    id: uuid().primaryKey(),
    orgId: uuid('org_id').notNull(),
    runId: uuid('run_id').notNull(),
    stepId: uuid('step_id').notNull(),
    callOccurrence: integer('call_occurrence').notNull(),
    toolName: text('tool_name').notNull(),
    toolVersion: integer('tool_version').notNull(),
    idempotencyMode: text('idempotency_mode').notNull(),
    args: jsonb().notNull(),
    argsHash: text('args_hash').notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    approvalRequired: boolean('approval_required').notNull(),
    status: text().notNull(),
    result: jsonb(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ai_operations_step_occurrence').on(
      table.orgId,
      table.runId,
      table.stepId,
      table.callOccurrence,
    ),
    uniqueIndex('ai_operations_org_run_id').on(
      table.orgId,
      table.runId,
      table.id,
    ),
    index('ai_operations_run_status').on(
      table.orgId,
      table.runId,
      table.status,
      table.stepId,
      table.callOccurrence,
    ),
    foreignKey({
      name: 'ai_operations_run_fk',
      columns: [table.orgId, table.runId],
      foreignColumns: [aiRuns.orgId, aiRuns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ai_operations_step_fk',
      columns: [table.orgId, table.runId, table.stepId],
      foreignColumns: [aiSteps.orgId, aiSteps.runId, aiSteps.id],
    }).onDelete('cascade'),
  ],
);

export const aiAttempts = app.table(
  'ai_attempts',
  {
    id: uuid().primaryKey(),
    orgId: uuid('org_id').notNull(),
    runId: uuid('run_id').notNull(),
    stepId: uuid('step_id').notNull(),
    ordinal: integer().notNull(),
    modelId: text('model_id').notNull(),
    provider: text(),
    estimatorVersion: text('estimator_version').notNull(),
    estimatedInputTokens: integer('estimated_input_tokens').notNull(),
    reservedInputTokens: integer('reserved_input_tokens').notNull(),
    reservedOutputTokens: integer('reserved_output_tokens').notNull(),
    reportedInputTokens: integer('reported_input_tokens'),
    reportedOutputTokens: integer('reported_output_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    reasoningOutputTokens: integer('reasoning_output_tokens'),
    costUsd: numeric('cost_usd'),
    generationId: text('generation_id'),
    fence: bigint({ mode: 'number' }).notNull(),
    active: boolean().notNull(),
    outcome: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ai_attempts_run_step_ordinal').on(
      table.runId,
      table.stepId,
      table.ordinal,
    ),
    uniqueIndex('ai_attempts_org_id_id').on(table.orgId, table.id),
    uniqueIndex('ai_attempts_org_run_id').on(
      table.orgId,
      table.runId,
      table.id,
    ),
    index('ai_attempts_run').on(
      table.orgId,
      table.runId,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      name: 'ai_attempts_run_fk',
      columns: [table.orgId, table.runId],
      foreignColumns: [aiRuns.orgId, aiRuns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ai_attempts_step_fk',
      columns: [table.orgId, table.runId, table.stepId],
      foreignColumns: [aiSteps.orgId, aiSteps.runId, aiSteps.id],
    }).onDelete('cascade'),
  ],
);

export const usageEvents = app.table('usage_events', {
  attemptId: uuid('attempt_id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  actorUserId: uuid('actor_user_id').notNull(),
  runId: uuid('run_id').notNull(),
  stepId: uuid('step_id').notNull(),
  modelId: text('model_id').notNull(),
  requestedProvider: text('requested_provider').notNull(),
  observedProvider: text('observed_provider'),
  profileId: text('profile_id').notNull(),
  resolvedEffort: text('resolved_effort'),
  estimatedInputTokens: integer('estimated_input_tokens').notNull(),
  reservedInputTokens: integer('reserved_input_tokens').notNull(),
  reservedOutputTokens: integer('reserved_output_tokens').notNull(),
  estimatorVersion: text('estimator_version').notNull(),
  instructionVersion: text('instruction_version'),
  reportedInputTokens: integer('reported_input_tokens'),
  reportedOutputTokens: integer('reported_output_tokens'),
  cachedInputTokens: integer('cached_input_tokens'),
  reasoningOutputTokens: integer('reasoning_output_tokens'),
  costUsd: numeric('cost_usd'),
  generationId: text('generation_id'),
  outcome: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
});

export const aiCheckpoints = app.table(
  'ai_checkpoints',
  {
    id: uuid().primaryKey(),
    orgId: uuid('org_id').notNull(),
    runId: uuid('run_id').notNull(),
    stepId: uuid('step_id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    fence: bigint({ mode: 'number' }).notNull(),
    text: text().notNull(),
    reasoningSummary: text('reasoning_summary'),
    reasoningDurationMs: integer('reasoning_duration_ms'),
    streamGeneration: bigint('stream_generation', { mode: 'number' }).notNull(),
    streamEventId: text('stream_event_id'),
    streamRevision: integer('stream_revision').notNull(),
    streamResumable: boolean('stream_resumable').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('ai_checkpoints_step_fence').on(table.stepId, table.fence),
    foreignKey({
      name: 'ai_checkpoints_run_fk',
      columns: [table.orgId, table.runId],
      foreignColumns: [aiRuns.orgId, aiRuns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ai_checkpoints_step_fk',
      columns: [table.orgId, table.runId, table.stepId],
      foreignColumns: [aiSteps.orgId, aiSteps.runId, aiSteps.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ai_checkpoints_attempt_fk',
      columns: [table.orgId, table.runId, table.attemptId],
      foreignColumns: [aiAttempts.orgId, aiAttempts.runId, aiAttempts.id],
    }).onDelete('cascade'),
  ],
);

export const aiEngineCapacity = ops.table('ai_engine_capacity', {
  singleton: boolean().primaryKey(),
  maxActive: integer('max_active').notNull(),
  maxActivePerOrg: integer('max_active_per_org').notNull(),
  terminalSlots: integer('terminal_slots').notNull(),
  maxLen: integer('max_len').notNull(),
  eventBytes: integer('event_bytes').notNull(),
  slotBytes: integer('slot_bytes').notNull(),
  memoryBudgetBytes: bigint('memory_budget_bytes', {
    mode: 'number',
  }).notNull(),
  configFingerprint: text('config_fingerprint').notNull(),
  configuredAt: timestamp('configured_at', { withTimezone: true }).notNull(),
});

export const aiRunSlots = ops.table(
  'ai_run_slots',
  {
    runId: uuid('run_id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    admittedAt: timestamp('admitted_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: 'ai_run_slots_run_fk',
      columns: [table.orgId, table.runId],
      foreignColumns: [aiRuns.orgId, aiRuns.id],
    }).onDelete('cascade'),
  ],
);

export const chats = app.table(
  'chats',
  {
    id: uuid().primaryKey(),
    orgId: uuid('org_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    title: text().notNull(),
    titleSource: text('title_source').notNull(),
    titleVersion: integer('title_version').notNull(),
    viewedLeafId: uuid('viewed_leaf_id'),
    activeAnswerRunId: uuid('active_answer_run_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    lastActivityAt: timestamp('last_activity_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex('chats_org_id_id').on(table.orgId, table.id),
    index('chats_owner_activity').on(
      table.orgId,
      table.ownerUserId,
      table.lastActivityAt,
      table.id,
    ),
  ],
);

export const chatRuns = app.table(
  'chat_runs',
  {
    orgId: uuid('org_id').notNull(),
    chatId: uuid('chat_id').notNull(),
    runId: uuid('run_id').notNull(),
    kind: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('chat_runs_org_chat_run').on(
      table.orgId,
      table.chatId,
      table.runId,
    ),
    uniqueIndex('chat_runs_org_run').on(table.orgId, table.runId),
    foreignKey({
      name: 'chat_runs_chat_fk',
      columns: [table.orgId, table.chatId],
      foreignColumns: [chats.orgId, chats.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'chat_runs_run_fk',
      columns: [table.orgId, table.runId],
      foreignColumns: [aiRuns.orgId, aiRuns.id],
    }).onDelete('cascade'),
  ],
);

export const chatMessages = app.table(
  'chat_messages',
  {
    id: uuid().primaryKey(),
    orgId: uuid('org_id').notNull(),
    chatId: uuid('chat_id').notNull(),
    parentMessageId: uuid('parent_message_id'),
    role: text().notNull(),
    userText: text('user_text'),
    effort: text(),
    runId: uuid('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('chat_messages_org_chat_id').on(
      table.orgId,
      table.chatId,
      table.id,
    ),
    uniqueIndex('chat_messages_org_run').on(table.orgId, table.runId),
    index('chat_messages_tree').on(
      table.orgId,
      table.chatId,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      name: 'chat_messages_chat_fk',
      columns: [table.orgId, table.chatId],
      foreignColumns: [chats.orgId, chats.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'chat_messages_parent_fk',
      columns: [table.orgId, table.chatId, table.parentMessageId],
      foreignColumns: [table.orgId, table.chatId, table.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'chat_messages_run_fk',
      columns: [table.orgId, table.chatId, table.runId],
      foreignColumns: [chatRuns.orgId, chatRuns.chatId, chatRuns.runId],
    }).onDelete('cascade'),
  ],
);
