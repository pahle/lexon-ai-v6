import { randomUUID } from 'node:crypto';
import { appendAuthAudit } from '../audit/index.js';
import { Injectable } from '@nestjs/common';
import {
  OwnSessionSummarySchema,
  UuidSchema,
  type OwnSessionSummary,
  type BearerSessionResponse,
} from '@lexon/contracts';
import { OrganizationAuthPort } from './organization-auth.port.js';
import {
  assertVerifiedIdentity,
  type VerifiedIdentity,
} from './identity.types.js';
import { IdentityError } from './identity-error.js';
@Injectable()
export class SessionService {
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly config: { bearerSeconds: number },
  ) {}
  async issueBearer(
    identity: VerifiedIdentity,
  ): Promise<BearerSessionResponse> {
    assertVerifiedIdentity(identity);
    if (identity.channel !== 'cookie')
      throw new IdentityError('ORG_FORBIDDEN', 403);
    return this.port.transaction(identity, async (tx, headers) => {
      if (headers.has('authorization'))
        throw new IdentityError('ORG_FORBIDDEN', 403);
      const facts = await tx.call('lexonSecurityFacts', { headers });
      if (!facts.session?.authenticatedAt)
        throw new IdentityError('AUTH_REQUIRED', 401);
      const selection = await tx.call('lexonSelectionFacts', {
        body: { userId: identity.userId, sessionId: identity.sessionId },
      });
      if (!selection.selectedMember || selection.selected?.state !== 'active')
        throw new IdentityError('ORG_MEMBERSHIP_REQUIRED', 403);
      if (selection.selected.require2fa && !facts.session.mfaVerifiedAt)
        throw new IdentityError('AUTH_2FA_REQUIRED', 403);
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + this.config.bearerSeconds * 1000,
      );
      const result = await tx.call('lexonIssueBearer', {
        body: {
          userId: identity.userId,
          sourceSessionId: identity.sessionId,
          expectedOrganizationId: selection.selected.id,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          authenticatedAt: facts.session.authenticatedAt.toISOString(),
          mfaVerifiedAt: facts.session.mfaVerifiedAt?.toISOString() ?? null,
          reauthenticatedAt:
            facts.session.reauthenticatedAt?.toISOString() ?? null,
        },
      });
      await appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        type: 'identity.session_changed.v1',
        outcome: 'success',
        actorUserId: identity.userId,
        subjectUserId: identity.userId,
        sessionId: result.sessionId,
        metadata: { action: 'bearer_issued' },
      });
      return result;
    });
  }
  list(identity: VerifiedIdentity): Promise<OwnSessionSummary[]> {
    return this.port.transaction(identity, async (tx) =>
      (
        await tx.call('lexonListOwnSessions', {
          body: {
            userId: identity.userId,
            currentSessionId: identity.sessionId,
          },
        })
      ).map((row) => OwnSessionSummarySchema.parse(row)),
    );
  }
  revoke(identity: VerifiedIdentity, sessionId: string): Promise<void> {
    UuidSchema.parse(sessionId);
    return this.port.transaction(identity, async (tx) => {
      const result = await tx.call('lexonRevokeOwnSession', {
        body: { userId: identity.userId, sessionId },
      });
      if (!result.revoked) throw new IdentityError('ORG_FORBIDDEN', 403);
      await appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        type: 'identity.session_changed.v1',
        outcome: 'success',
        actorUserId: identity.userId,
        subjectUserId: identity.userId,
        sessionId,
        metadata: { action: 'revoked' },
      });
    });
  }
}
