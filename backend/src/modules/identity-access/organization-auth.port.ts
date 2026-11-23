import { Injectable } from '@nestjs/common';
import type {
  AuthCommandSession,
  AuthIntegration,
} from '../../infrastructure/db/index.js';
import {
  isRetryableAuthError,
  pgFailure,
  withAuthRetry,
} from '../../infrastructure/db/index.js';
import {
  assertVerifiedIdentity,
  verifiedIdentityHeaders,
  type VerifiedIdentity,
} from './identity.types.js';
import { IdentityError, mapSlugConflict } from './identity-error.js';
import { IdentityPolicy } from './identity-policy.js';

@Injectable()
export class OrganizationAuthPort {
  constructor(private readonly integration: AuthIntegration) {}
  private async platformFacts(tx: AuthCommandSession, headers: Headers) {
    const facts = await tx.call('lexonSecurityFacts', { headers });
    if (!facts.user || !facts.session)
      throw new IdentityError('AUTH_REQUIRED', 401);
    new IdentityPolicy().requireAccount(
      facts.user,
      facts.session.mfaVerifiedAt,
      { platform: true },
    );
    return facts.session;
  }
  // Platform policy re-check without the re-authentication age: reads are not
  // sensitive actions (F4.3 spec 4.2); mutations keep platformTransaction.
  async platformRead<T>(
    identity: VerifiedIdentity,
    work: (tx: AuthCommandSession) => Promise<T>,
  ): Promise<T> {
    return this.transaction(identity, async (tx, headers) => {
      await this.platformFacts(tx, headers);
      return work(tx);
    });
  }
  async platformTransaction<T>(
    identity: VerifiedIdentity,
    reauthSeconds: number,
    work: (commands: AuthCommandSession, headers: Headers) => Promise<T>,
  ): Promise<T> {
    return this.transaction(identity, async (tx, headers) => {
      const session = await this.platformFacts(tx, headers);
      const age = session.reauthenticatedAt
        ? Date.now() - session.reauthenticatedAt.getTime()
        : Number.NaN;
      if (!Number.isFinite(age) || age < 0 || age >= reauthSeconds * 1000)
        throw new IdentityError('AUTH_REAUTH_REQUIRED', 403);
      return work(tx, headers);
    });
  }
  async transaction<T>(
    identity: VerifiedIdentity,
    work: (commands: AuthCommandSession, headers: Headers) => Promise<T>,
  ): Promise<T> {
    assertVerifiedIdentity(identity);
    const headers = verifiedIdentityHeaders(identity);
    return withAuthRetry(
      () =>
        this.integration.transaction(async (tx) => {
          const facts = await tx.call('lexonSecurityFacts', { headers });
          const user = facts.user;
          const session = facts.session;
          if (
            !user ||
            !session ||
            user.banned ||
            user.id !== identity.userId ||
            session.id !== identity.sessionId ||
            session.channel !== identity.channel
          )
            throw new IdentityError('AUTH_REQUIRED', 401);
          new IdentityPolicy().requireAccount(user, session.mfaVerifiedAt);
          if (identity.mfaVerifiedAt && !session.mfaVerifiedAt)
            throw new IdentityError('AUTH_2FA_REQUIRED', 403);
          if (session.hardExpiresAt && session.hardExpiresAt <= new Date())
            throw new IdentityError('AUTH_REQUIRED', 401);
          return work(tx, new Headers(headers));
        }),
      {
        attempts: 3,
        retryable: isRetryableAuthError,
        map: (error) =>
          mapSlugConflict(error) ??
          (pgFailure(error).constraint === 'lexon_team_owner'
            ? new IdentityError('ORG_LAST_OWNER', 409)
            : error),
      },
    );
  }
}
