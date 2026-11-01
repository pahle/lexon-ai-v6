import {
  pgSchema,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
} from 'drizzle-orm/pg-core';
const ops = pgSchema('ops');
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
