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
