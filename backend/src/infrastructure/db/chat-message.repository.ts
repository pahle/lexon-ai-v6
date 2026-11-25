import { z } from 'zod';
import {
  buildAuthorizationPredicate,
  type ChatAuthorizationPredicate,
} from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const uuid = z.uuid();

export interface ChatMessageRecord {
  readonly id: string;
  readonly parentMessageId: string | null;
  readonly role: 'user' | 'assistant';
  readonly userText: string | null;
  readonly effort: 'high' | 'max' | null;
  readonly assistantText: string | null;
  readonly reasoningSummary: string | null;
  readonly reasoningDurationMs: number | null;
  readonly feedback: 'good' | 'bad' | null;
  readonly runId: string | null;
  readonly status: string | null;
  readonly operations: readonly unknown[];
  readonly createdAt: Date;
}

export interface ChatTree {
  readonly chatId: string;
  readonly viewedLeafId: string | null;
  readonly messages: readonly ChatMessageRecord[];
}

export interface ChatHistoryRecord {
  readonly role: 'user' | 'assistant';
  readonly text: string | null;
  readonly status: string | null;
}

export interface ChatBranchSource {
  readonly id: string;
  readonly parentMessageId: string | null;
  readonly role: ChatMessageRecord['role'];
  readonly userText: string | null;
  readonly effort: 'high' | 'max' | null;
}

interface TreeRow {
  id: string;
  parent_message_id: string | null;
  role: ChatMessageRecord['role'];
  user_text: string | null;
  effort: 'high' | 'max' | null;
  run_id: string | null;
  status: string | null;
  assistant_text: string | null;
  reasoning_summary: string | null;
  reasoning_duration_ms: number | null;
  feedback: 'good' | 'bad' | null;
  operations: unknown[] | null;
  created_at: Date;
}

/**
 * The literal column list the `tree` query projects (spec §5 item 15 coverage
 * guard). Kept next to the query; `VALIDATOR_INPUTS` in
 * `chat-tree-validator.ts` must name validator inputs for every entry.
 */
export const TREE_SELECTED_COLUMNS = [
  'id',
  'parent_message_id',
  'role',
  'user_text',
  'effort',
  'run_id',
  'status',
  'assistant_text',
  'reasoning_summary',
  'reasoning_duration_ms',
  'feedback',
  'operations',
  'created_at',
  'viewed_leaf_id',
] as const;

/**
 * The tree query — built per call so its WHERE is the F6 §4.1 ChatRead
 * fragment (owner OR project access OR standalone share, deny-wins; §5 row
 * 5) instead of a hand-rolled owner clause. Exported so the cost spec can
 * EXPLAIN exactly what `tree()` runs.
 */
export function treeSql(
  scope: Pick<ChatAuthorizationPredicate, 'where'>,
): string {
  return `SELECT m.id,m.parent_message_id,m.role,m.user_text,m.effort,m.run_id,r.status,
    CASE WHEN m.role='user' THEN NULL
      WHEN r.final_output IS NOT NULL THEN r.final_output
      WHEN r.status IN ('queued','running','awaiting_approval','cancelling')
        THEN COALESCE(r.partial_output,'') || COALESCE(cp.text,'')
      ELSE COALESCE(r.partial_output,'') END AS assistant_text,
    CASE WHEN m.role='assistant' THEN r.reasoning_summary ELSE NULL END AS reasoning_summary,
    CASE WHEN m.role='assistant' THEN r.reasoning_duration_ms ELSE NULL END AS reasoning_duration_ms,
    feedback.rating AS feedback,m.created_at,c.viewed_leaf_id,
    COALESCE(ops.operations,'[]'::jsonb) AS operations
  FROM app.chats c
  LEFT JOIN app.chat_messages m ON m.org_id=c.org_id AND m.chat_id=c.id
  LEFT JOIN app.ai_runs r ON r.org_id=m.org_id AND r.id=m.run_id
  LEFT JOIN app.message_feedback feedback ON feedback.org_id=m.org_id
    AND feedback.chat_id=m.chat_id AND feedback.message_id=m.id
    AND feedback.owner_user_id=c.owner_user_id
  LEFT JOIN LATERAL (
    SELECT checkpoint.text FROM app.ai_steps current_step
    JOIN app.ai_checkpoints checkpoint
      ON checkpoint.org_id=current_step.org_id
      AND checkpoint.run_id=current_step.run_id
      AND checkpoint.step_id=current_step.id
      AND checkpoint.fence=current_step.fence
    JOIN app.ai_attempts attempt
      ON attempt.org_id=checkpoint.org_id AND attempt.run_id=checkpoint.run_id
      AND attempt.id=checkpoint.attempt_id AND attempt.active=true
    WHERE current_step.org_id=r.org_id AND current_step.run_id=r.id
      AND current_step.sequence=r.next_sequence AND current_step.state='claimed'
    ORDER BY checkpoint.created_at DESC,checkpoint.id DESC LIMIT 1
  ) cp ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(op.document ORDER BY op.step_sequence,op.call_occurrence) AS operations
    FROM (
      SELECT s.sequence AS step_sequence,o.call_occurrence,
        (jsonb_build_object(
          'operationId',o.id,
          'kind',o.kind,
          'status',CASE WHEN o.status='succeeded' THEN 'completed' ELSE o.status END,
          'approvalRequired',o.approval_required,
          'snapshotHash',o.snapshot_hash,
          'expiresAt',to_char(o.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'decidedAt',to_char(o.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'toolName',o.tool_name,
          'input',o.args,
          'output',o.result
        ) || CASE WHEN o.tool_name='rename_chat'
          THEN jsonb_build_object('display',jsonb_build_object('currentTitle',c.title))
          ELSE '{}'::jsonb END) AS document
      FROM app.ai_operations o
      JOIN app.ai_steps s ON s.org_id=o.org_id AND s.run_id=o.run_id AND s.id=o.step_id
      WHERE o.org_id=m.org_id AND o.run_id=m.run_id
        AND s.state IN ('committed','awaiting_approval')
    ) op
  ) ops ON true
  WHERE ${scope.where('c', '$1', '$2')} AND c.id=$3
  ORDER BY m.created_at,m.id`;
}

export class ChatMessageRepository {
  async branchSource(
    tx: TenantSession,
    chatId: string,
    messageId: string,
  ): Promise<ChatBranchSource | null> {
    if (!uuid.safeParse(chatId).success || !uuid.safeParse(messageId).success)
      return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<{
      id: string;
      parent_message_id: string | null;
      role: ChatMessageRecord['role'];
      user_text: string | null;
      effort: 'high' | 'max' | null;
    }>(
      `SELECT message.id,message.parent_message_id,message.role,message.user_text,message.effort
       FROM app.chat_messages message JOIN app.chats chat
         ON chat.org_id=message.org_id AND chat.id=message.chat_id
       WHERE message.org_id=$1 AND ${scope.where('chat', '$1', '$2')}
         AND chat.id=$3 AND message.id=$4`,
      [scope.orgId, scope.userId, chatId, messageId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          parentMessageId: row.parent_message_id,
          role: row.role,
          userText: row.user_text,
          effort: row.effort,
        }
      : null;
  }

  async isLeaf(
    tx: TenantSession,
    chatId: string,
    messageId: string,
  ): Promise<boolean> {
    if (!uuid.safeParse(chatId).success || !uuid.safeParse(messageId).success)
      return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<{ is_leaf: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM app.chat_messages target
         JOIN app.chats chat ON chat.org_id=target.org_id AND chat.id=target.chat_id
         WHERE target.org_id=$1 AND ${scope.where('chat', '$1', '$2')}
           AND target.chat_id=$3 AND target.id=$4
           AND NOT EXISTS (SELECT 1 FROM app.chat_messages child
             WHERE child.org_id=target.org_id AND child.chat_id=target.chat_id
               AND child.parent_message_id=target.id)) AS is_leaf`,
      [scope.orgId, scope.userId, chatId, messageId],
    );
    return result.rows[0]?.is_leaf === true;
  }

  async historyForRun(
    tx: TenantSession,
    runId: string,
  ): Promise<readonly ChatHistoryRecord[]> {
    if (!uuid.safeParse(runId).success) return [];
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return [];
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<{
      role: 'user' | 'assistant';
      user_text: string | null;
      answer_text: string | null;
      status: string | null;
    }>(
      `WITH RECURSIVE target AS (
         SELECT m.org_id,m.chat_id,m.parent_message_id
         FROM app.chat_messages m
         JOIN app.chat_runs cr ON cr.org_id=m.org_id AND cr.chat_id=m.chat_id
           AND cr.run_id=m.run_id AND cr.kind='answer'
         JOIN app.chats c ON c.org_id=m.org_id AND c.id=m.chat_id
         WHERE m.run_id=$1 AND m.role='assistant'
           AND ${scope.where('c', '$2', '$3')}
       ), path AS (
         SELECT ancestor.*,0 AS depth FROM target t
         JOIN app.chat_messages current_turn
           ON current_turn.org_id=t.org_id AND current_turn.chat_id=t.chat_id
          AND current_turn.id=t.parent_message_id AND current_turn.role='user'
         JOIN app.chat_messages ancestor
           ON ancestor.org_id=t.org_id AND ancestor.chat_id=t.chat_id
          AND ancestor.id=current_turn.parent_message_id
         UNION ALL
         SELECT parent.*,path.depth+1 FROM path
         JOIN app.chat_messages parent
           ON parent.org_id=path.org_id AND parent.chat_id=path.chat_id
          AND parent.id=path.parent_message_id
       )
       SELECT path.role,path.user_text,
         CASE WHEN run.status='completed' THEN run.final_output
           ELSE run.partial_output END AS answer_text,run.status
       FROM path LEFT JOIN app.ai_runs run
         ON path.role='assistant' AND run.org_id=path.org_id
        AND run.id=path.run_id
       ORDER BY path.depth DESC`,
      [runId, scope.orgId, scope.userId],
    );
    return result.rows.map((row) => ({
      role: row.role,
      text: row.role === 'user' ? row.user_text : row.answer_text,
      status: row.status,
    }));
  }

  async insertUser(
    tx: TenantSession,
    input: {
      readonly chatId: string;
      readonly messageId: string;
      readonly parentMessageId: string | null;
      readonly text: string;
      readonly effort: 'high' | 'max';
    },
  ): Promise<void> {
    if (
      !uuid.safeParse(input.chatId).success ||
      !uuid.safeParse(input.messageId).success ||
      (input.parentMessageId !== null &&
        !uuid.safeParse(input.parentMessageId).success) ||
      Buffer.byteLength(input.text, 'utf8') < 1 ||
      Buffer.byteLength(input.text, 'utf8') > 16384
    )
      throw new Error('Invalid chat message');
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) throw new Error('Invalid chat owner');
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query(
      `INSERT INTO app.chat_messages(id,org_id,chat_id,parent_message_id,role,user_text,effort)
       SELECT $1,$2,c.id,$4,'user',$5,$6 FROM app.chats c
       WHERE ${scope.where('c', '$2', '$3')} AND c.id=$7`,
      [
        input.messageId,
        scope.orgId,
        scope.userId,
        input.parentMessageId,
        input.text,
        input.effort,
        input.chatId,
      ],
    );
    if (result.rowCount !== 1) throw new Error('Chat unavailable');
  }

  async insertAssistant(
    tx: TenantSession,
    input: {
      readonly chatId: string;
      readonly messageId: string;
      readonly parentMessageId: string;
      readonly runId: string;
    },
  ): Promise<void> {
    if (
      !uuid.safeParse(input.chatId).success ||
      !uuid.safeParse(input.messageId).success ||
      !uuid.safeParse(input.parentMessageId).success ||
      !uuid.safeParse(input.runId).success
    )
      throw new Error('Invalid chat message');
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) throw new Error('Invalid chat owner');
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query(
      `INSERT INTO app.chat_messages(id,org_id,chat_id,parent_message_id,role,run_id)
       SELECT $1,$2,c.id,$4,'assistant',$5 FROM app.chats c
       JOIN app.chat_runs cr ON cr.org_id=c.org_id AND cr.chat_id=c.id
         AND cr.run_id=$5 AND cr.kind='answer'
       WHERE ${scope.where('c', '$2', '$3')} AND c.id=$6`,
      [
        input.messageId,
        scope.orgId,
        scope.userId,
        input.parentMessageId,
        input.runId,
        input.chatId,
      ],
    );
    if (result.rowCount !== 1) throw new Error('Chat unavailable');
  }

  async tree(tx: TenantSession, chatId: string): Promise<ChatTree | null> {
    if (!uuid.safeParse(chatId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const scope = buildAuthorizationPredicate({
      scope: 'chat-read',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<
      TreeRow & { viewed_leaf_id: string | null }
    >(treeSql(scope), [scope.orgId, scope.userId, chatId]);
    if (!result.rows.length) return null;
    const rows = result.rows.filter((row) => row.id !== null);
    return {
      chatId,
      viewedLeafId: result.rows[0]!.viewed_leaf_id,
      messages: rows.map((row) => ({
        id: row.id,
        parentMessageId: row.parent_message_id,
        role: row.role,
        userText: row.user_text,
        effort: row.effort,
        assistantText: row.assistant_text,
        reasoningSummary: row.reasoning_summary,
        reasoningDurationMs: row.reasoning_duration_ms,
        feedback: row.feedback,
        runId: row.run_id,
        status: row.status,
        operations: row.operations ?? [],
        createdAt: row.created_at,
      })),
    };
  }
}
