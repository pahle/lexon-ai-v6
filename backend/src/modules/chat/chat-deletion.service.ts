import { randomUUID } from 'node:crypto';
import { ChatApiError } from '@lexon/contracts';
import {
  AiStepRepository,
  ChatDeletionRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';
import { AuditService } from '../audit/index.js';
import { RunEventsService } from './run-events.service.js';

export interface DeletionSignalPublisher {
  publish(runId: string): Promise<void>;
}

export class ChatDeletionService {
  private readonly audit = new AuditService();
  private readonly deletions = new ChatDeletionRepository();
  private readonly steps = new AiStepRepository();

  constructor(
    private readonly database: TenantDatabase,
    private readonly authorization: RunAuthorizationService,
    private readonly signals: DeletionSignalPublisher | undefined,
    private readonly graceMs: number,
    private readonly events: RunEventsService | undefined,
  ) {}

  async request(actor: RunActor, chatId: string): Promise<void> {
    this.authorization.assertLiveActor(actor);
    const work = await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        await this.steps.lockTenantClaimGuard(tx);
        if (!(await this.deletions.request(tx, chatId, this.graceMs)))
          throw new ChatApiError('CHAT_NOT_FOUND');
        const accepted = await this.deletions.read(tx, chatId);
        if (!accepted) throw new Error('Chat deletion work unavailable');
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          type: 'chat.deletion_requested.v1',
          occurredAt: new Date().toISOString(),
          outcome: 'success',
          orgId: actor.orgId,
          actorUserId: actor.userId,
          metadata: { chatId },
        });
        return accepted;
      },
    );
    await Promise.all(work.runIds.map((runId) => this.events?.closeRun(runId)));
    await Promise.all(
      work.runIds.map((runId) =>
        this.signals?.publish(runId).catch(() => undefined),
      ),
    );
  }
}
