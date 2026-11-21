import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import { OrganizationAuthPort } from './organization-auth.port.js';
import type { VerifiedIdentity } from './identity.types.js';
import { IdentityError } from './identity-error.js';
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
        if (disabled) {
          if (userId === identity.userId)
            throw new IdentityError('PLATFORM_SELF_ACTION', 409);
          // Lock before counting: concurrent disables serialise on the rows.
          const locked = await tx.call('lexonPlatformRead', {
            body: { name: 'lockEnabledAdmins', params: [] } as never,
          });
          const ids = (locked as { rows: { id: string }[] }).rows.map(
            (r) => r.id,
          );
          if (ids.length === 1 && ids[0] === userId)
            throw new IdentityError('PLATFORM_LAST_ADMINISTRATOR', 409);
          await tx.call('banUser', {
            headers,
            body: { userId, banReason: 'Disabled by platform administrator' },
          });
        } else await tx.call('unbanUser', { headers, body: { userId } });
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
