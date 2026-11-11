import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const uuid = z.uuid();

export interface ChatListCursor {
  readonly activityAt: string;
  readonly chatId: string;
}

export interface ChatSearchCursor extends ChatListCursor {
  readonly score: string;
  readonly messageId: string | null;
}

export interface ChatSearchRow {
  readonly chatId: string;
  readonly title: string;
  readonly messageId: string | null;
  readonly excerpt: string;
  readonly matchStart: number | null;
  readonly matchEnd: number | null;
  readonly updatedAt: Date;
  readonly activityAt: string;
  readonly score: string;
}

export class ChatSearchRepository {
  async list(
    tx: TenantSession,
    cursor: ChatListCursor | null,
    limit: number,
  ) {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return [];
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<{
      id: string;
      title: string;
      updated_at: Date;
      last_message_at: Date | null;
      activity_at: string;
    }>(
      `SELECT chat.id,chat.title,chat.updated_at,
         to_char(chat.last_activity_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS activity_at,
         latest.created_at AS last_message_at
       FROM app.chats chat
       LEFT JOIN LATERAL (
         SELECT message.created_at FROM app.chat_messages message
         WHERE message.org_id=chat.org_id AND message.chat_id=chat.id
         ORDER BY message.created_at DESC,message.id DESC LIMIT 1
       ) latest ON true
       WHERE chat.org_id=$1 AND chat.owner_user_id=$2 AND chat.deleted_at IS NULL
         AND ($3::timestamptz IS NULL OR (chat.last_activity_at,chat.id)<($3,$4::uuid))
       ORDER BY chat.last_activity_at DESC,chat.id DESC
       LIMIT $5`,
      [
        scope.orgId,
        scope.userId,
        cursor?.activityAt ?? null,
        cursor?.chatId ?? null,
        limit,
      ],
    );
    return result.rows;
  }

  async search(
    tx: TenantSession,
    queryText: string,
    cursor: ChatSearchCursor | null,
    limit: number,
  ): Promise<ChatSearchRow[]> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return [];
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<ChatSearchRow>(
      `WITH search_input AS (
         SELECT $3::text AS query_text, lower($3::text) AS query_lower,
           plainto_tsquery('english', $3::text) AS query_ts
       ), raw_matches AS (
         SELECT chat.id AS chat_id,NULL::uuid AS message_id,chat.title AS match_text,
           chat.title AS title,chat.updated_at,chat.last_activity_at,
           greatest(
             ts_rank_cd(setweight(to_tsvector('english',coalesce(chat.title,'')),'A'),input.query_ts),
             word_similarity(input.query_lower,lower(chat.title))*0.25
           )::numeric(16,12) AS score,0 AS source_order
         FROM app.chats chat CROSS JOIN search_input input
         WHERE chat.org_id=$1 AND chat.owner_user_id=$2 AND chat.deleted_at IS NULL
           AND (setweight(to_tsvector('english',coalesce(chat.title,'')),'A') @@ input.query_ts
             OR input.query_lower <% lower(chat.title))
         UNION ALL
         SELECT chat.id,message.id,message.user_text,chat.title,chat.updated_at,
           chat.last_activity_at,
           greatest(
             ts_rank_cd(to_tsvector('english',coalesce(message.user_text,'')),input.query_ts)*0.75,
             word_similarity(input.query_lower,lower(message.user_text))*0.2
           )::numeric(16,12),1
         FROM app.chat_messages message
         JOIN app.chats chat ON chat.org_id=message.org_id AND chat.id=message.chat_id
         CROSS JOIN search_input input
         WHERE message.org_id=$1 AND chat.owner_user_id=$2 AND chat.deleted_at IS NULL
           AND message.role='user'
           AND (to_tsvector('english',coalesce(message.user_text,'')) @@ input.query_ts
             OR input.query_lower <% lower(message.user_text))
         UNION ALL
         SELECT chat.id,message.id,
           CASE WHEN run.status='completed' THEN run.final_output ELSE run.partial_output END,
           chat.title,chat.updated_at,chat.last_activity_at,
           greatest(
             ts_rank_cd(to_tsvector('english',coalesce(CASE WHEN run.status='completed'
               THEN run.final_output ELSE run.partial_output END,'')),input.query_ts)*0.75,
             word_similarity(input.query_lower,lower(CASE WHEN run.status='completed'
               THEN run.final_output ELSE run.partial_output END))*0.2
           )::numeric(16,12),2
         FROM app.ai_runs run
         JOIN app.chat_runs link ON link.org_id=run.org_id AND link.run_id=run.id AND link.kind='answer'
         JOIN app.chat_messages message ON message.org_id=link.org_id AND message.chat_id=link.chat_id
           AND message.run_id=link.run_id AND message.role='assistant'
         JOIN app.chats chat ON chat.org_id=link.org_id AND chat.id=link.chat_id
         CROSS JOIN search_input input
         WHERE run.org_id=$1 AND chat.owner_user_id=$2 AND chat.deleted_at IS NULL
           AND (to_tsvector('english',coalesce(CASE WHEN run.status='completed'
             THEN run.final_output ELSE run.partial_output END,'')) @@ input.query_ts
             OR input.query_lower <% lower(CASE WHEN run.status='completed'
               THEN run.final_output ELSE run.partial_output END))
       ), best_per_chat AS (
         SELECT matched.*,row_number() OVER (PARTITION BY matched.chat_id
           ORDER BY matched.score DESC,matched.source_order,matched.message_id ASC NULLS FIRST) AS match_rank
         FROM raw_matches matched
       ), page AS (
         SELECT best.chat_id,best.title,best.message_id,best.match_text,best.updated_at,
           to_char(best.last_activity_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "activityAt",
           best.score::text AS score
         FROM best_per_chat best
         WHERE best.match_rank=1
           AND ($4::numeric IS NULL OR best.score < $4::numeric
             OR (best.score=$4::numeric AND best.last_activity_at<$5::timestamptz)
             OR (best.score=$4::numeric AND best.last_activity_at=$5::timestamptz
               AND best.chat_id>$6::uuid))
         ORDER BY best.score DESC,best.last_activity_at DESC,best.chat_id ASC
         LIMIT $7
       )
       SELECT page.chat_id AS "chatId",page.title,page.message_id AS "messageId",
         page.match_text AS "excerpt",NULL::integer AS "matchStart",NULL::integer AS "matchEnd",
         page.updated_at AS "updatedAt",page."activityAt",page.score
       FROM page
       ORDER BY page.score::numeric DESC,page.last_activity_at DESC,page.chat_id ASC`,
      [
        scope.orgId,
        scope.userId,
        queryText,
        cursor?.score ?? null,
        cursor?.activityAt ?? null,
        cursor?.chatId ?? null,
        limit,
      ],
    );
    return result.rows;
  }

  async resolveMatch(
    tx: TenantSession,
    chatId: string,
    messageId: string,
  ): Promise<{ leafId: string; messageId: string } | null> {
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
    const result = await client.query<{ leaf_id: string }>(
      `WITH RECURSIVE descendants AS (
         SELECT message.id,message.parent_message_id,message.created_at
         FROM app.chat_messages message
         JOIN app.chats chat ON chat.org_id=message.org_id AND chat.id=message.chat_id
         WHERE message.org_id=$1 AND chat.owner_user_id=$2 AND chat.id=$3
           AND chat.deleted_at IS NULL AND message.id=$4
         UNION ALL
         SELECT child.id,child.parent_message_id,child.created_at
         FROM descendants parent
         JOIN app.chat_messages child ON child.org_id=$1 AND child.chat_id=$3
           AND child.parent_message_id=parent.id
       ), leaves AS (
         SELECT descendant.id,descendant.created_at
         FROM descendants descendant
         WHERE NOT EXISTS (SELECT 1 FROM app.chat_messages child
           WHERE child.org_id=$1 AND child.chat_id=$3
             AND child.parent_message_id=descendant.id)
       )
       SELECT CASE WHEN EXISTS (SELECT 1 FROM leaves WHERE id=chat.viewed_leaf_id)
         THEN chat.viewed_leaf_id
         ELSE (SELECT id FROM leaves ORDER BY created_at DESC,id DESC LIMIT 1)
       END AS leaf_id
       FROM app.chats chat
       WHERE chat.org_id=$1 AND chat.owner_user_id=$2 AND chat.id=$3
         AND chat.deleted_at IS NULL AND EXISTS (SELECT 1 FROM descendants)`,
      [scope.orgId, scope.userId, chatId, messageId],
    );
    const leafId = result.rows[0]?.leaf_id;
    if (!leafId) return null;
    const selected = await client.query(
      `UPDATE app.chats SET viewed_leaf_id=$4
       WHERE org_id=$1 AND owner_user_id=$2 AND id=$3 AND deleted_at IS NULL`,
      [scope.orgId, scope.userId, chatId, leafId],
    );
    return selected.rowCount === 1 ? { leafId, messageId } : null;
  }
}
