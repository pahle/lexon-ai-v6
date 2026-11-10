import { z } from 'zod';
import type { ChatMutationResult } from '@lexon/contracts';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const uuid = z.uuid();

export interface ChatCreateRequestRecord {
  readonly chatId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly text: string | null;
  readonly effort: 'high' | 'max' | null;
}

export interface ExistingChatMessageMutation {
  readonly chatId: string;
  readonly userMessageId: string;
  readonly parentMessageId: string | null;
  readonly text: string;
  readonly effort: 'high' | 'max';
  readonly assistantMessageId: string;
}

export class ChatMutationRepository {
  async findCreateRequest(
    tx: TenantSession,
    requestId: string,
  ): Promise<ChatCreateRequestRecord | null> {
    if (!uuid.safeParse(requestId).success) return null;
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return null;
    const scope = buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: ctx.orgId,
      userId: ctx.userId,
      excludeDeleted: true,
    });
    const result = await client.query<{
      chat_id: string;
      user_message_id: string;
      assistant_message_id: string;
      user_text: string | null;
      effort: 'high' | 'max' | null;
    }>(
      `SELECT request.chat_id,request.user_message_id,request.assistant_message_id,
        message.user_text,message.effort
       FROM app.chat_create_requests request
       LEFT JOIN app.chat_messages message ON message.org_id=request.org_id
         AND message.chat_id=request.chat_id AND message.id=request.user_message_id
       WHERE request.org_id=$1 AND request.owner_user_id=$2 AND request.request_id=$3`,
      [scope.orgId, scope.userId, requestId],
    );
    const row = result.rows[0];
    return row
      ? {
          chatId: row.chat_id,
          userMessageId: row.user_message_id,
          assistantMessageId: row.assistant_message_id,
          text: row.user_text,
          effort: row.effort,
        }
      : null;
  }

  async insertCreateRequest(
    tx: TenantSession,
    input: {
      readonly requestId: string;
      readonly chatId: string;
      readonly userMessageId: string;
      readonly assistantMessageId: string;
    },
  ): Promise<void> {
    if (
      !uuid.safeParse(input.requestId).success ||
      !uuid.safeParse(input.chatId).success ||
      !uuid.safeParse(input.userMessageId).success ||
      !uuid.safeParse(input.assistantMessageId).success
    )
      throw new Error('Invalid chat create request');
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) throw new Error('Invalid chat owner');
    await client.query(
      `INSERT INTO app.chat_create_requests
       (org_id,owner_user_id,request_id,chat_id,user_message_id,assistant_message_id)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        ctx.orgId,
        ctx.userId,
        input.requestId,
        input.chatId,
        input.userMessageId,
        input.assistantMessageId,
      ],
    );
  }

  async findMessageMutation(
    tx: TenantSession,
    chatId: string,
    userMessageId: string,
  ): Promise<ExistingChatMessageMutation | null> {
    if (
      !uuid.safeParse(chatId).success ||
      !uuid.safeParse(userMessageId).success
    )
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
      chat_id: string;
      user_message_id: string;
      parent_message_id: string | null;
      user_text: string;
      effort: 'high' | 'max';
      assistant_message_id: string;
    }>(
      `SELECT message.chat_id,message.id AS user_message_id,message.parent_message_id,
        message.user_text,message.effort,answer.id AS assistant_message_id
       FROM app.chat_messages message
       JOIN app.chats chat ON chat.org_id=message.org_id AND chat.id=message.chat_id
       JOIN app.chat_messages answer ON answer.org_id=message.org_id
        AND answer.chat_id=message.chat_id AND answer.parent_message_id=message.id
        AND answer.role='assistant'
       WHERE message.org_id=$1 AND chat.owner_user_id=$2 AND chat.id=$3
         AND chat.deleted_at IS NULL AND message.id=$4 AND message.role='user'`,
      [scope.orgId, scope.userId, chatId, userMessageId],
    );
    const row = result.rows[0];
    return row
      ? {
          chatId: row.chat_id,
          userMessageId: row.user_message_id,
          parentMessageId: row.parent_message_id,
          text: row.user_text,
          effort: row.effort,
          assistantMessageId: row.assistant_message_id,
        }
      : null;
  }

  toMutationResult(
    input: ChatCreateRequestRecord | ExistingChatMessageMutation,
  ): ChatMutationResult {
    return {
      chatId: input.chatId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      runId: input.assistantMessageId,
    };
  }
}
