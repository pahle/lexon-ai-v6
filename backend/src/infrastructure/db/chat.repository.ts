import { z } from 'zod';
import { OutboxRepository } from './outbox.repository.js';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';
import {
  chatCleanupJobId,
  type ChatCleanupPhase,
} from './chat-cleanup-job-id.js';

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

export interface ChatTitleSeed {
  readonly chatId: string;
  readonly ownerUserId: string;
  readonly titleSource: ChatRecord['titleSource'];
  readonly titleVersion: number;
  readonly userText: string;
  readonly answerText: string;
}

export interface ChatTitleRunApplication extends ChatTitleSeed {
  readonly titleRunId: string;
  readonly titleRunStatus: string;
  readonly titleOutput: string | null;
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
  async insert(
    tx: TenantSession,
    chatId: string,
    excerpt = '',
  ): Promise<ChatRecord> {
    if (
      !uuid.safeParse(chatId).success ||
      Buffer.byteLength(excerpt, 'utf8') > 1024
    )
      throw new Error('Invalid chat');
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) throw new Error('Invalid chat owner');
    const result = await client.query<ChatRow>(
      `INSERT INTO app.chats(id,org_id,owner_user_id,title,title_source)
       VALUES($1,$2,$3,$4,'excerpt') RETURNING *`,
      [chatId, ctx.orgId, ctx.userId, excerpt],
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

  async titleSeedForAnswer(
    tx: TenantSession,
    answerRunId: string,
    lock = false,
  ): Promise<ChatTitleSeed | null> {
    if (!uuid.safeParse(answerRunId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const result = await client.query<{
      chat_id: string;
      owner_user_id: string;
      title_source: ChatRecord['titleSource'];
      title_version: number;
      user_text: string;
      answer_text: string;
    }>(
      `SELECT c.id AS chat_id,c.owner_user_id,c.title_source,c.title_version,
              parent.user_text,run.final_output AS answer_text
       FROM app.chat_runs link
       JOIN app.chats c ON c.org_id=link.org_id AND c.id=link.chat_id
       JOIN app.chat_messages assistant ON assistant.org_id=link.org_id
         AND assistant.chat_id=link.chat_id AND assistant.run_id=link.run_id
         AND assistant.role='assistant'
       JOIN app.chat_messages parent ON parent.org_id=assistant.org_id
         AND parent.chat_id=assistant.chat_id AND parent.id=assistant.parent_message_id
         AND parent.role='user'
       JOIN app.ai_runs run ON run.org_id=link.org_id AND run.id=link.run_id
       WHERE link.org_id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL
         AND link.run_id=$3 AND link.kind='answer' AND run.status='completed'
       ${lock ? 'FOR UPDATE OF c' : ''}`,
      [ctx.orgId, ctx.userId, answerRunId],
    );
    const row = result.rows[0];
    return row
      ? {
          chatId: row.chat_id,
          ownerUserId: row.owner_user_id,
          titleSource: row.title_source,
          titleVersion: Number(row.title_version),
          userText: row.user_text,
          answerText: row.answer_text,
        }
      : null;
  }

  async hasTitleTask(tx: TenantSession, chatId: string): Promise<boolean> {
    if (!uuid.safeParse(chatId).success) return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query(
      `SELECT 1 FROM ops.outbox WHERE org_id=$1 AND user_id=$2
       AND type='chat.title.v1' AND payload->>'chatId'=$3 LIMIT 1`,
      [ctx.orgId, ctx.userId, chatId],
    );
    return result.rowCount === 1;
  }

  async hasTitleRun(tx: TenantSession, chatId: string): Promise<boolean> {
    if (!uuid.safeParse(chatId).success) return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query(
      `SELECT 1 FROM app.chat_runs link
       JOIN app.chats c ON c.org_id=link.org_id AND c.id=link.chat_id
       WHERE link.org_id=$1 AND c.owner_user_id=$2 AND link.chat_id=$3
         AND link.kind='title' AND c.deleted_at IS NULL LIMIT 1`,
      [ctx.orgId, ctx.userId, chatId],
    );
    return result.rowCount === 1;
  }

  async isCurrentTitleRun(
    tx: TenantSession,
    titleRunId: string,
  ): Promise<boolean> {
    if (!uuid.safeParse(titleRunId).success) return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query(
      `SELECT 1 FROM app.chat_runs link
       JOIN app.chats c ON c.org_id=link.org_id AND c.id=link.chat_id
       WHERE link.org_id=$1 AND c.owner_user_id=$2 AND link.run_id=$3
         AND link.kind='title' AND c.deleted_at IS NULL
         AND c.title_source='excerpt' AND c.title_version=link.title_version
       LIMIT 1`,
      [ctx.orgId, ctx.userId, titleRunId],
    );
    return result.rowCount === 1;
  }

  async titleRunApplication(
    tx: TenantSession,
    titleRunId: string,
  ): Promise<ChatTitleRunApplication | null> {
    if (!uuid.safeParse(titleRunId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const result = await client.query<{
      chat_id: string;
      owner_user_id: string;
      title_source: ChatRecord['titleSource'];
      title_version: number;
      expected_title_version: number;
      source_answer_run_id: string;
      title_status: string;
      title_output: string | null;
      user_text: string;
      answer_text: string;
    }>(
      `SELECT c.id AS chat_id,c.owner_user_id,c.title_source,c.title_version,
              link.title_version AS expected_title_version,
              link.source_answer_run_id, title_run.status AS title_status,
              title_run.final_output AS title_output,parent.user_text,
              answer.final_output AS answer_text
       FROM app.chat_runs link
       JOIN app.chats c ON c.org_id=link.org_id AND c.id=link.chat_id
       JOIN app.ai_runs title_run ON title_run.org_id=link.org_id AND title_run.id=link.run_id
       JOIN app.chat_runs source_link ON source_link.org_id=link.org_id
         AND source_link.chat_id=link.chat_id AND source_link.run_id=link.source_answer_run_id
         AND source_link.kind='answer'
       JOIN app.chat_messages assistant ON assistant.org_id=source_link.org_id
         AND assistant.chat_id=source_link.chat_id AND assistant.run_id=source_link.run_id
         AND assistant.role='assistant'
       JOIN app.chat_messages parent ON parent.org_id=assistant.org_id
         AND parent.chat_id=assistant.chat_id AND parent.id=assistant.parent_message_id
         AND parent.role='user'
       JOIN app.ai_runs answer ON answer.org_id=source_link.org_id AND answer.id=source_link.run_id
       WHERE link.org_id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL
         AND link.run_id=$3 AND link.kind='title' FOR UPDATE OF c`,
      [ctx.orgId, ctx.userId, titleRunId],
    );
    const row = result.rows[0];
    return row
      ? {
          chatId: row.chat_id,
          ownerUserId: row.owner_user_id,
          titleSource: row.title_source,
          titleVersion: Number(row.expected_title_version),
          userText: row.user_text,
          answerText: row.answer_text,
          titleRunId,
          titleRunStatus: row.title_status,
          titleOutput: row.title_output,
        }
      : null;
  }

  async associateTitle(
    tx: TenantSession,
    input: {
      readonly chatId: string;
      readonly titleRunId: string;
      readonly sourceAnswerRunId: string;
      readonly titleVersion: number;
    },
  ): Promise<boolean> {
    if (
      !uuid.safeParse(input.chatId).success ||
      !uuid.safeParse(input.titleRunId).success ||
      !uuid.safeParse(input.sourceAnswerRunId).success ||
      !Number.isSafeInteger(input.titleVersion) ||
      input.titleVersion < 1
    )
      return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query(
      `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind,title_version,source_answer_run_id)
       SELECT $1,c.id,$3,'title',$5,$6 FROM app.chats c
       WHERE c.org_id=$1 AND c.owner_user_id=$2 AND c.id=$4 AND c.deleted_at IS NULL
         AND c.title_source='excerpt' AND c.title_version=$5
         AND EXISTS(SELECT 1 FROM app.chat_runs a WHERE a.org_id=$1
           AND a.chat_id=c.id AND a.run_id=$6 AND a.kind='answer')`,
      [
        ctx.orgId,
        ctx.userId,
        input.titleRunId,
        input.chatId,
        input.titleVersion,
        input.sourceAnswerRunId,
      ],
    );
    return result.rowCount === 1;
  }

  async applyTitle(
    tx: TenantSession,
    input: {
      readonly titleRunId: string;
      readonly title: string;
      readonly expectedVersion: number;
    },
  ): Promise<boolean> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query<{ chat_id: string }>(
      `UPDATE app.chats c SET title=$4,title_source='ai',title_version=c.title_version+1,
         updated_at=clock_timestamp()
       FROM app.chat_runs link
       WHERE link.org_id=c.org_id AND link.chat_id=c.id AND link.run_id=$3
         AND link.kind='title' AND link.title_version=$5
         AND c.org_id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL
         AND c.title_source='excerpt' AND c.title_version=$5
       RETURNING c.id AS chat_id`,
      [
        ctx.orgId,
        ctx.userId,
        input.titleRunId,
        input.title,
        input.expectedVersion,
      ],
    );
    if (result.rowCount !== 1) return false;
    await client.query("SELECT pg_notify('lexon_chat_title', $1)", [
      JSON.stringify({
        orgId: ctx.orgId,
        userId: ctx.userId,
        chatId: result.rows[0]!.chat_id,
      }),
    ]);
    return true;
  }

  async rename(
    tx: TenantSession,
    chatId: string,
    title: string,
  ): Promise<boolean> {
    if (!uuid.safeParse(chatId).success) return false;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return false;
    const result = await client.query(
      `UPDATE app.chats SET title=$4,title_source='user',title_version=title_version+1,
         updated_at=clock_timestamp()
       WHERE org_id=$1 AND owner_user_id=$2 AND id=$3 AND deleted_at IS NULL`,
      [ctx.orgId, ctx.userId, chatId, title],
    );
    if (result.rowCount !== 1) return false;
    await client.query("SELECT pg_notify('lexon_chat_title', $1)", [
      JSON.stringify({ orgId: ctx.orgId, userId: ctx.userId, chatId }),
    ]);
    return true;
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

  async markDeleted(
    tx: TenantSession,
    chatId: string,
    phase: ChatCleanupPhase = 'grace',
    outboxId = chatCleanupJobId(chatId, phase),
  ): Promise<boolean> {
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
    await this.outbox.append(
      tx,
      {
        type: 'chat.cleanup.v1',
        ctx: { orgId: ctx.orgId, userId: ctx.userId },
        payload: { chatId, phase },
      },
      { id: outboxId },
    );
    return true;
  }
}
