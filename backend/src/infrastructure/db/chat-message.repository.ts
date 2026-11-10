import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const uuid = z.uuid();

export interface ChatMessageRecord {
  readonly id: string;
  readonly parentMessageId: string | null;
  readonly role: 'user' | 'assistant';
  readonly userText: string | null;
  readonly assistantText: string | null;
  readonly runId: string | null;
  readonly status: string | null;
  readonly createdAt: Date;
}

export interface ChatTree {
  readonly chatId: string;
  readonly viewedLeafId: string | null;
  readonly messages: readonly ChatMessageRecord[];
}

interface TreeRow {
  id: string;
  parent_message_id: string | null;
  role: ChatMessageRecord['role'];
  user_text: string | null;
  run_id: string | null;
  status: string | null;
  assistant_text: string | null;
  created_at: Date;
}

export class ChatMessageRepository {
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
       WHERE c.org_id=$2 AND c.owner_user_id=$3 AND c.id=$7 AND c.deleted_at IS NULL`,
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
       WHERE c.org_id=$2 AND c.owner_user_id=$3 AND c.id=$6 AND c.deleted_at IS NULL`,
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
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<
      TreeRow & { viewed_leaf_id: string | null }
    >(
      `SELECT m.id,m.parent_message_id,m.role,m.user_text,m.run_id,r.status,
        CASE WHEN m.role='user' THEN NULL
          WHEN r.final_output IS NOT NULL THEN r.final_output
          WHEN r.status IN ('queued','running','awaiting_approval','cancelling')
            THEN COALESCE(r.partial_output,'') || COALESCE(cp.text,'')
          ELSE COALESCE(r.partial_output,'') END AS assistant_text,
        m.created_at,c.viewed_leaf_id
       FROM app.chats c
       LEFT JOIN app.chat_messages m ON m.org_id=c.org_id AND m.chat_id=c.id
       LEFT JOIN app.ai_runs r ON r.org_id=m.org_id AND r.id=m.run_id
       LEFT JOIN LATERAL (
         SELECT checkpoint.text FROM app.ai_checkpoints checkpoint
         WHERE checkpoint.org_id=r.org_id AND checkpoint.run_id=r.id
         ORDER BY checkpoint.created_at DESC,checkpoint.id DESC LIMIT 1
       ) cp ON true
       WHERE c.org_id=$1 AND c.owner_user_id=$2 AND c.id=$3 AND c.deleted_at IS NULL
       ORDER BY m.created_at,m.id`,
      [scope.orgId, scope.userId, chatId],
    );
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
        assistantText: row.assistant_text,
        runId: row.run_id,
        status: row.status,
        createdAt: row.created_at,
      })),
    };
  }
}
