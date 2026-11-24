import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const uuid = z.uuid();

/**
 * Spec §5 item 15: the validator is one aggregate query over the same rows
 * the tree query reads, using only columns that every tree-changing write
 * already updates. No revision column, no trigger. The tuple below is the
 * exact input set from the spec table, joined as text in a fixed order, then
 * hashed: `W/"v1.<base64url(sha256(tuple))>"`.
 */
export const VALIDATOR_SQL = `SELECT
   c.updated_at::text AS chat_updated_at,
   c.title_version::text AS chat_title_version,
   COALESCE(c.viewed_leaf_id::text,'') AS chat_viewed_leaf_id,
   c.title AS chat_title,
   (SELECT count(*)::text FROM app.chat_messages m
      WHERE m.org_id=c.org_id AND m.chat_id=c.id) AS messages_count,
   COALESCE((SELECT max(m.created_at)::text FROM app.chat_messages m
      WHERE m.org_id=c.org_id AND m.chat_id=c.id),'') AS messages_max_created_at,
   COALESCE((SELECT max(m.id::text) FROM app.chat_messages m
      WHERE m.org_id=c.org_id AND m.chat_id=c.id),'') AS messages_max_id,
   (SELECT count(*)::text FROM app.chat_runs cr
      JOIN app.ai_runs r ON r.org_id=cr.org_id AND r.id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id) AS runs_count,
   COALESCE((SELECT sum(r.run_version)::text FROM app.chat_runs cr
      JOIN app.ai_runs r ON r.org_id=cr.org_id AND r.id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'0') AS runs_version_sum,
   COALESCE((SELECT max(r.updated_at)::text FROM app.chat_runs cr
      JOIN app.ai_runs r ON r.org_id=cr.org_id AND r.id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'') AS runs_max_updated_at,
   (SELECT count(*)::text FROM app.chat_runs cr
      JOIN app.ai_steps s ON s.org_id=cr.org_id AND s.run_id=cr.run_id
      JOIN app.ai_checkpoints cp ON cp.org_id=s.org_id AND cp.step_id=s.id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id) AS checkpoints_count,
   COALESCE((SELECT max(cp.created_at)::text FROM app.chat_runs cr
      JOIN app.ai_steps s ON s.org_id=cr.org_id AND s.run_id=cr.run_id
      JOIN app.ai_checkpoints cp ON cp.org_id=s.org_id AND cp.step_id=s.id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'') AS checkpoints_max_created_at,
   COALESCE((SELECT max(s.updated_at)::text FROM app.chat_runs cr
      JOIN app.ai_steps s ON s.org_id=cr.org_id AND s.run_id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'') AS steps_max_updated_at,
   (SELECT count(*) FILTER (WHERE a.active)::text FROM app.chat_runs cr
      JOIN app.ai_attempts a ON a.org_id=cr.org_id AND a.run_id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id) AS attempts_active_count,
   COALESCE((SELECT max(a.settled_at)::text FROM app.chat_runs cr
      JOIN app.ai_attempts a ON a.org_id=cr.org_id AND a.run_id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'') AS attempts_max_settled_at,
   (SELECT count(*)::text FROM app.message_feedback f
      WHERE f.org_id=c.org_id AND f.chat_id=c.id
        AND f.owner_user_id=c.owner_user_id) AS feedback_count,
   COALESCE((SELECT max(f.updated_at)::text FROM app.message_feedback f
      WHERE f.org_id=c.org_id AND f.chat_id=c.id
        AND f.owner_user_id=c.owner_user_id),'') AS feedback_max_updated_at,
   (SELECT count(*)::text FROM app.chat_runs cr
      JOIN app.ai_operations o ON o.org_id=cr.org_id AND o.run_id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id) AS operations_count,
   COALESCE((SELECT max(o.created_at)::text FROM app.chat_runs cr
      JOIN app.ai_operations o ON o.org_id=cr.org_id AND o.run_id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'') AS operations_max_created_at,
   COALESCE((SELECT max(o.decided_at)::text FROM app.chat_runs cr
      JOIN app.ai_operations o ON o.org_id=cr.org_id AND o.run_id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'') AS operations_max_decided_at,
   COALESCE((SELECT max(o.completed_at)::text FROM app.chat_runs cr
      JOIN app.ai_operations o ON o.org_id=cr.org_id AND o.run_id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'') AS operations_max_completed_at,
   COALESCE((SELECT max(o.expires_at)::text FROM app.chat_runs cr
      JOIN app.ai_operations o ON o.org_id=cr.org_id AND o.run_id=cr.run_id
      WHERE cr.org_id=c.org_id AND cr.chat_id=c.id),'') AS operations_max_expires_at
 FROM app.chats c
 WHERE c.org_id=$1 AND c.owner_user_id=$2 AND c.id=$3 AND c.deleted_at IS NULL`;

interface ValidatorRow {
  chat_updated_at: string;
  chat_title_version: string;
  chat_viewed_leaf_id: string;
  chat_title: string;
  messages_count: string;
  messages_max_created_at: string;
  messages_max_id: string;
  runs_count: string;
  runs_version_sum: string;
  runs_max_updated_at: string;
  checkpoints_count: string;
  checkpoints_max_created_at: string;
  steps_max_updated_at: string;
  attempts_active_count: string;
  attempts_max_settled_at: string;
  feedback_count: string;
  feedback_max_updated_at: string;
  operations_count: string;
  operations_max_created_at: string;
  operations_max_decided_at: string;
  operations_max_completed_at: string;
  operations_max_expires_at: string;
}

/**
 * The literal map from each column `ChatMessageRepository.tree` selects to
 * the validator inputs that cover it (the coverage guard in
 * `chat-tree-validator-coverage.spec.ts`). Literal, not derived from the
 * validator itself.
 */
export const VALIDATOR_INPUTS: Record<string, readonly string[]> = {
  id: [
    'chat_messages.count',
    'chat_messages.max_created_at',
    'chat_messages.max_id',
  ],
  parent_message_id: [
    'chat_messages.count',
    'chat_messages.max_created_at',
    'chat_messages.max_id',
  ],
  role: [
    'chat_messages.count',
    'chat_messages.max_created_at',
    'chat_messages.max_id',
  ],
  user_text: [
    'chat_messages.count',
    'chat_messages.max_created_at',
    'chat_messages.max_id',
  ],
  effort: [
    'chat_messages.count',
    'chat_messages.max_created_at',
    'chat_messages.max_id',
  ],
  run_id: [
    'chat_messages.count',
    'chat_messages.max_created_at',
    'chat_messages.max_id',
    'ai_runs.count',
  ],
  status: [
    'ai_runs.count',
    'ai_runs.run_version_sum',
    'ai_runs.max_updated_at',
  ],
  assistant_text: [
    'ai_runs.run_version_sum',
    'ai_runs.max_updated_at',
    'ai_checkpoints.count',
    'ai_checkpoints.max_created_at',
    'ai_steps.max_updated_at',
    'ai_attempts.active_count',
    'ai_attempts.max_settled_at',
  ],
  reasoning_summary: ['ai_runs.run_version_sum', 'ai_runs.max_updated_at'],
  reasoning_duration_ms: ['ai_runs.run_version_sum', 'ai_runs.max_updated_at'],
  feedback: ['message_feedback.count', 'message_feedback.max_updated_at'],
  operations: [
    'ai_operations.count',
    'ai_operations.max_created_at',
    'ai_operations.max_decided_at',
    'ai_operations.max_completed_at',
    'ai_operations.max_expires_at',
  ],
  created_at: [
    'chat_messages.count',
    'chat_messages.max_created_at',
    'chat_messages.max_id',
  ],
  viewed_leaf_id: ['chats.viewed_leaf_id', 'chats.updated_at'],
};

/**
 * Reads the validator tuple for one owned live chat and returns its weak
 * entity tag `W/"v1.<base64url(sha256(tuple))>"`. `null` when the filtered
 * chats row is absent — the same org/owner/chat/deleted_at filter as `tree`,
 * so a chat deleted mid-transaction surfaces as not-found, never as a 304.
 */
export async function readTreeValidator(
  tx: TenantSession,
  chatId: string,
): Promise<string | null> {
  if (!uuid.safeParse(chatId).success) return null;
  const { client, ctx } = requireSession(tx);
  if (!ctx.userId) return null;
  const scope = buildAuthorizationPredicate({
    scope: 'owned-chat',
    orgId: ctx.orgId,
    userId: ctx.userId,
    excludeDeleted: true,
  });
  const result = await client.query<ValidatorRow>(VALIDATOR_SQL, [
    scope.orgId,
    scope.userId,
    chatId,
  ]);
  const row = result.rows[0];
  if (!row) return null;
  // The tuple order is fixed; it must stay in lockstep with VALIDATOR_INPUTS
  // and with the spec §5 item 15 table.
  const tuple = [
    `chats.updated_at=${row.chat_updated_at}`,
    `chats.title_version=${row.chat_title_version}`,
    `chats.viewed_leaf_id=${row.chat_viewed_leaf_id}`,
    `chats.title=${row.chat_title}`,
    `chat_messages.count=${row.messages_count}`,
    `chat_messages.max_created_at=${row.messages_max_created_at}`,
    `chat_messages.max_id=${row.messages_max_id}`,
    `ai_runs.count=${row.runs_count}`,
    `ai_runs.run_version_sum=${row.runs_version_sum}`,
    `ai_runs.max_updated_at=${row.runs_max_updated_at}`,
    `ai_checkpoints.count=${row.checkpoints_count}`,
    `ai_checkpoints.max_created_at=${row.checkpoints_max_created_at}`,
    `ai_steps.max_updated_at=${row.steps_max_updated_at}`,
    `ai_attempts.active_count=${row.attempts_active_count}`,
    `ai_attempts.max_settled_at=${row.attempts_max_settled_at}`,
    `message_feedback.count=${row.feedback_count}`,
    `message_feedback.max_updated_at=${row.feedback_max_updated_at}`,
    `ai_operations.count=${row.operations_count}`,
    `ai_operations.max_created_at=${row.operations_max_created_at}`,
    `ai_operations.max_decided_at=${row.operations_max_decided_at}`,
    `ai_operations.max_completed_at=${row.operations_max_completed_at}`,
    `ai_operations.max_expires_at=${row.operations_max_expires_at}`,
  ].join('|');
  const digest = createHash('sha256').update(tuple, 'utf8').digest('base64url');
  return `W/"v1.${digest}"`;
}
