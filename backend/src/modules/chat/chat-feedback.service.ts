import { randomUUID } from 'node:crypto';
import type { ChatFeedback } from '@lexon/contracts';
import { ChatApiError } from '@lexon/contracts';
import {
  MessageFeedbackRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';
import { AuditService } from '../audit/index.js';

export class ChatFeedbackService {
  private readonly feedback = new MessageFeedbackRepository();
  private readonly audit = new AuditService();

  constructor(
    private readonly database: TenantDatabase,
    private readonly authorization: RunAuthorizationService,
  ) {}

  async set(
    actor: RunActor,
    chatId: string,
    messageId: string,
    rating: ChatFeedback,
  ): Promise<void> {
    this.authorization.assertLiveActor(actor);
    await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const result = await this.feedback.set(tx, chatId, messageId, rating);
        if (!result.found) throw new ChatApiError('CHAT_NOT_FOUND');
        if (!result.action) return;
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          type: 'chat.message_feedback.v1',
          occurredAt: new Date().toISOString(),
          outcome: 'success',
          orgId: actor.orgId,
          actorUserId: actor.userId,
          metadata: {
            chatId,
            messageId,
            runId: messageId,
            action: result.action,
          },
        });
      },
    );
  }
}
