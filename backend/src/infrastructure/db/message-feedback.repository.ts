import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const uuid = z.uuid();

export type MessageFeedbackRating = 'good' | 'bad' | null;
export type MessageFeedbackAction = 'set' | 'changed' | 'cleared';
export interface MessageFeedbackResult {
  readonly found: boolean;
  readonly action: MessageFeedbackAction | null;
}

export class MessageFeedbackRepository {
  async set(
    tx: TenantSession,
    chatId: string,
    messageId: string,
    rating: MessageFeedbackRating,
  ): Promise<MessageFeedbackResult> {
    if (!uuid.safeParse(chatId).success || !uuid.safeParse(messageId).success)
      return { found: false, action: null };
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return { found: false, action: null };
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const chat = await client.query(
      `SELECT id FROM app.chats
       WHERE org_id=$1 AND owner_user_id=$2 AND id=$3 AND deleted_at IS NULL
       FOR UPDATE`,
      [scope.orgId, scope.userId, chatId],
    );
    if (chat.rowCount !== 1) return { found: false, action: null };
    const target = await client.query(
      `SELECT message.id FROM app.chat_messages message
       JOIN app.chat_runs link ON link.org_id=message.org_id
         AND link.chat_id=message.chat_id AND link.run_id=message.run_id AND link.kind='answer'
       WHERE message.org_id=$1 AND message.chat_id=$2 AND message.id=$3
         AND message.role='assistant'`,
      [scope.orgId, chatId, messageId],
    );
    if (target.rowCount !== 1) return { found: false, action: null };
    const existing = await client.query<{ rating: 'good' | 'bad' }>(
      `SELECT rating FROM app.message_feedback
       WHERE org_id=$1 AND owner_user_id=$2 AND chat_id=$3 AND message_id=$4`,
      [scope.orgId, scope.userId, chatId, messageId],
    );
    const oldRating = existing.rows[0]?.rating;
    if (oldRating === rating) return { found: true, action: null };
    if (rating === null) {
      if (!oldRating) return { found: true, action: null };
      await client.query(
        `DELETE FROM app.message_feedback
         WHERE org_id=$1 AND owner_user_id=$2 AND chat_id=$3 AND message_id=$4`,
        [scope.orgId, scope.userId, chatId, messageId],
      );
      return { found: true, action: 'cleared' };
    }
    await client.query(
      `INSERT INTO app.message_feedback(org_id,owner_user_id,chat_id,message_id,rating)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (org_id,owner_user_id,chat_id,message_id)
       DO UPDATE SET rating=EXCLUDED.rating,updated_at=clock_timestamp()`,
      [scope.orgId, scope.userId, chatId, messageId, rating],
    );
    return { found: true, action: oldRating ? 'changed' : 'set' };
  }
}
