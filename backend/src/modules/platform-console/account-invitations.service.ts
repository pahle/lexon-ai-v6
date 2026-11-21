import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AccountInvitationInputSchema,
  AccountInvitationSchema,
  UuidSchema,
  type AccountInvitation,
} from '@lexon/contracts';
import {
  IdentityError,
  OrganizationAuthPort,
  type VerifiedIdentity,
} from '../identity-access/index.js';
import { appendAuthAudit } from '../audit/index.js';
import {
  AuthLimitError,
  type AuthLimiter,
} from '../../infrastructure/queue/index.js';
import type { AuthCommandSession } from '../../infrastructure/db/index.js';
import { invitationItem } from './platform-console.repository.js';

export const INVITATION_CONFLICT_MESSAGE =
  'This address already has a Lexon account or a pending invitation.';
type Row = Record<string, unknown>;
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class AccountInvitationsService {
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly config: { reauthSeconds: number },
    private readonly limiter: Pick<AuthLimiter, 'consume'>,
  ) {}
  private async call(
    tx: AuthCommandSession,
    name: string,
    params: unknown[],
  ): Promise<Row[]> {
    const out = await tx.call('lexonPlatformRead', {
      body: { name, params } as never,
    });
    return (out as { rows: Row[] }).rows;
  }
  private async consume(
    action: 'platform-account-invite' | 'platform-account-invite-resend',
    key: string,
  ) {
    try {
      await this.limiter.consume({
        action,
        clientAddress: '127.0.0.1',
        scope: 'account',
        accountKey: sha256(key),
      });
    } catch (error) {
      if (error instanceof AuthLimitError)
        throw new IdentityError(error.code, error.status);
      throw error;
    }
  }
  private async audit(
    tx: AuthCommandSession,
    identity: VerifiedIdentity,
    type:
      | 'platform.account_invitation_created.v1'
      | 'platform.account_invitation_resent.v1'
      | 'platform.account_invitation_cancelled.v1',
    invitationId: string,
  ) {
    await appendAuthAudit(tx, {
      version: 1,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      type,
      outcome: 'success',
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
      invitationId,
      metadata: {},
    } as never);
  }
  private mail(tx: AuthCommandSession, email: string, token: string) {
    return tx.call('lexonSendAccountInvitation', {
      body: { email, token },
    });
  }
  create(
    identity: VerifiedIdentity,
    input: unknown,
  ): Promise<AccountInvitation> {
    const body = AccountInvitationInputSchema.parse(input);
    return this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => {
        await this.consume('platform-account-invite', identity.userId);
        const token = randomBytes(32).toString('base64url');
        const rows = await this.call(tx, 'createInvitation', [
          body.email,
          body.name ?? null,
          sha256(token),
          identity.userId,
        ]);
        const row = rows[0];
        if (!row)
          throw new IdentityError('PLATFORM_INVITATION_CONFLICT', 409, [
            { path: 'email', message: INVITATION_CONFLICT_MESSAGE },
          ]);
        await this.mail(tx, String(row.email), token);
        await this.audit(
          tx,
          identity,
          'platform.account_invitation_created.v1',
          String(row.id),
        );
        return AccountInvitationSchema.parse(invitationItem(row));
      },
    );
  }
  async resend(identity: VerifiedIdentity, id: string): Promise<void> {
    UuidSchema.parse(id);
    await this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => {
        await this.consume('platform-account-invite-resend', id);
        const token = randomBytes(32).toString('base64url');
        const row = (
          await this.call(tx, 'resendInvitation', [id, sha256(token)])
        )[0];
        if (!row) throw new IdentityError('NOT_FOUND', 404);
        await this.mail(tx, String(row.email), token);
        await this.audit(
          tx,
          identity,
          'platform.account_invitation_resent.v1',
          id,
        );
      },
    );
  }
  async cancel(identity: VerifiedIdentity, id: string): Promise<void> {
    UuidSchema.parse(id);
    await this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => {
        const row = (await this.call(tx, 'cancelInvitation', [id]))[0];
        if (row?.cancelled !== true) throw new IdentityError('NOT_FOUND', 404);
        await this.audit(
          tx,
          identity,
          'platform.account_invitation_cancelled.v1',
          id,
        );
      },
    );
  }
}
