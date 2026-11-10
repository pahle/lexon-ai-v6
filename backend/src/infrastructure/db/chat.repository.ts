import { z } from 'zod';
import { OutboxRepository } from './outbox.repository.js';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const uuid = z.uuid();

export interface ChatRecord {
  readonly id: string;
  readonly orgId: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly titleSource: 'excerpt' | 'ai' | 'user';
  readonly titleVersion: number;
  readonly viewedLeafId: string | null;
  readonly activeAnswerRunId: string | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastActivityAt: Date;
}

interface ChatRow {
  id: string;
  org_id: string;
  owner_user_id: string;
  title: string;
  title_source: ChatRecord['titleSource'];
  title_version: number;
  viewed_leaf_id: string | null;
  active_answer_run_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_activity_at: Date;
}

function mapChat(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    titleSource: row.title_source,
    titleVersion: row.title_version,
    viewedLeafId: row.viewed_leaf_id,
    activeAnswerRunId: row.active_answer_run_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  };
}

export class ChatRepository {
  private readonly outbox = new OutboxRepository();
  async insert(tx: TenantSession, chatId: string): Promise<ChatRecord> {
    if (!uuid.safeParse(chatId).success) throw new Error('Invalid chat');
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) throw new Error('Invalid chat owner');
    const result = await client.query<ChatRow>(
      `INSERT INTO app.chats(id,org_id,owner_user_id)
       VALUES($1,$2,$3) RETURNING *`,
      [chatId, ctx.orgId, ctx.userId],
    );
    return mapChat(result.rows[0]!);
  }

  async lockLive(
    tx: TenantSession,
    chatId: string,
  ): Promise<ChatRecord | null> {
    if (!uuid.safeParse(chatId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<ChatRow>(
      `SELECT * FROM app.chats
       WHERE org_id=$1 AND owner_user_id=$2 AND id=$3 AND deleted_at IS NULL
       FOR UPDATE`,
      [scope.orgId, scope.userId, chatId],
    );
    return result.rows[0] ? mapChat(result.rows[0]) : null;
  }

  async readLive(
    tx: TenantSession,
    chatId: string,
  ): Promise<ChatRecord | null> {
    if (!uuid.safeParse(chatId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<ChatRow>(
      `SELECT * FROM app.chats
       WHERE org_id=$1 AND owner_user_id=$2 AND id=$3 AND deleted_at IS NULL`,
      [scope.orgId, scope.userId, chatId],
    );
    return result.rows[0] ? mapChat(result.rows[0]) : null;
  }

  async hasLiveAnswerRun(tx: TenantSession, runId: string): Promise<boolean> {
    if (!uuid.safeParse(runId).success) return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<{ authorized: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM app.chat_runs run_link
        JOIN app.chats chat ON chat.org_id=run_link.org_id AND chat.id=run_link.chat_id
        WHERE run_link.org_id=$1 AND chat.owner_user_id=$2 AND chat.deleted_at IS NULL
          AND run_link.run_id=$3 AND run_link.kind='answer') AS authorized`,
      [scope.orgId, scope.userId, runId],
    );
    return result.rows[0]?.authorized === true;
  }

  async associateAnswer(
    tx: TenantSession,
    chatId: string,
    runId: string,
  ): Promise<void> {
    if (!uuid.safeParse(chatId).success || !uuid.safeParse(runId).success)
      throw new Error('Invalid chat run');
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) throw new Error('Invalid chat owner');
    const result = await client.query(
      `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
       SELECT $1,c.id,$3,'answer' FROM app.chats c
       WHERE c.org_id=$1 AND c.owner_user_id=$2 AND c.id=$4 AND c.deleted_at IS NULL`,
      [ctx.orgId, ctx.userId, runId, chatId],
    );
    if (result.rowCount !== 1) throw new Error('Chat unavailable');
  }

  async selectLeaf(
    tx: TenantSession,
    chatId: string,
    leafId: string,
  ): Promise<boolean> {
    if (!uuid.safeParse(chatId).success || !uuid.safeParse(leafId).success)
      return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query(
      `UPDATE app.chats c SET viewed_leaf_id=$4,updated_at=clock_timestamp()
       WHERE c.org_id=$1 AND c.owner_user_id=$2 AND c.id=$3 AND c.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM app.chat_messages m
           WHERE m.org_id=c.org_id AND m.chat_id=c.id AND m.id=$4
             AND NOT EXISTS (SELECT 1 FROM app.chat_messages child
               WHERE child.org_id=m.org_id AND child.chat_id=m.chat_id
                 AND child.parent_message_id=m.id))`,
      [scope.orgId, scope.userId, chatId, leafId],
    );
    return result.rowCount === 1;
  }

  async markDeleted(tx: TenantSession, chatId: string): Promise<boolean> {
    if (!uuid.safeParse(chatId).success) return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<{ deleted: boolean }>(
      'SELECT ops.ai_mark_chat_deleted($1,$2,$3) AS deleted',
      [scope.orgId, scope.userId, chatId],
    );
    if (result.rows[0]?.deleted !== true) return false;
    await this.outbox.append(tx, {
      type: 'chat.cleanup.v1',
      ctx: { orgId: ctx.orgId, userId: ctx.userId },
      payload: { chatId },
    });
    return true;
  }
}
