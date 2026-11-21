import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import { OrganizationAuthPort } from './organization-auth.port.js';
import type { VerifiedIdentity } from './identity.types.js';
import { IdentityError } from './identity-error.js';
import { emailLimitKey } from './auth-http.js';
import { appendAuthAudit } from '../audit/index.js';
import {
  AuthLimitError,
  type AuthLimiter,
} from '../../infrastructure/queue/index.js';
export function assertNotLastAdministrator(
  enabledAdminIds: string[],
  targetUserId: string,
): void {
  if (enabledAdminIds.length === 1 && enabledAdminIds[0] === targetUserId)
    throw new IdentityError('PLATFORM_LAST_ADMINISTRATOR', 409);
}
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly config: {
      reauthSeconds: number;
      correlationSecret: string;
    },
    private readonly limiter: Pick<AuthLimiter, 'consume'>,
  ) {}
  async resendVerification(
    identity: VerifiedIdentity,
    userId: string,
  ): Promise<void> {
    UuidSchema.parse(userId);
    await this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => {
        const read = await tx.call('lexonPlatformRead', {
          body: { name: 'account', params: [userId] } as never,
        });
        const row = (
          read as { rows: { email: string; email_verified: boolean }[] }
        ).rows[0];
        if (!row) throw new IdentityError('NOT_FOUND', 404);
        if (row.email_verified)
          throw new IdentityError('PLATFORM_ALREADY_VERIFIED', 409);
        try {
          // The user's own resend bucket (same key as the public endpoint).
          await this.limiter.consume({
            action: 'verification-resend',
            clientAddress: '127.0.0.1',
            scope: 'account',
            accountKey: emailLimitKey(this.config.correlationSecret, row.email),
          });
        } catch (error) {
          if (error instanceof AuthLimitError)
            throw new IdentityError(error.code, error.status);
          throw error;
        }
        // No admin headers: a session would trigger EMAIL_MISMATCH.
        await tx.call('sendVerificationEmail', { body: { email: row.email } });
        await appendAuthAudit(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'platform.verification_email_resent.v1',
          outcome: 'success',
          actorUserId: identity.userId,
          subjectUserId: userId,
          sessionId: identity.sessionId,
          metadata: {},
        });
      },
    );
  }
  async revokeSessions(
    identity: VerifiedIdentity,
    userId: string,
  ): Promise<void> {
    UuidSchema.parse(userId);
    if (userId === identity.userId)
      throw new IdentityError('PLATFORM_SELF_ACTION', 409);
    await this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx, headers) => {
        try {
          await this.limiter.consume({
            action: 'platform-session-revoke',
            clientAddress: '127.0.0.1',
            scope: 'account',
            accountKey: createHash('sha256').update(userId).digest('hex'),
          });
        } catch (error) {
          if (error instanceof AuthLimitError)
            throw new IdentityError(error.code, error.status);
          throw error;
        }
        await tx.call('revokeUserSessions', { headers, body: { userId } });
        await appendAuthAudit(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'platform.user_sessions_revoked.v1',
          outcome: 'success',
          actorUserId: identity.userId,
          subjectUserId: userId,
          sessionId: identity.sessionId,
          metadata: {},
        });
      },
    );
  }
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
          assertNotLastAdministrator(ids, userId);
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
