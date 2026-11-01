import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import { OrganizationAuthPort } from './organization-auth.port.js';
import type { VerifiedIdentity } from './identity.types.js';
import { appendAuthAudit } from '../audit/index.js';
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly config: { reauthSeconds: number },
  ) {}
  setDisabled(
    identity: VerifiedIdentity,
    userId: string,
    disabled: boolean,
  ): Promise<void> {
    UuidSchema.parse(userId);
    return this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx, headers) => {
        if (disabled)
          await tx.call('banUser', {
            headers,
            body: { userId, banReason: 'Disabled by platform administrator' },
          });
        else await tx.call('unbanUser', { headers, body: { userId } });
        await appendAuthAudit(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'platform.user_disabled_changed.v1',
          outcome: 'success',
          actorUserId: identity.userId,
          subjectUserId: userId,
          sessionId: identity.sessionId,
          metadata: { disabled },
        });
      },
    );
  }
}
