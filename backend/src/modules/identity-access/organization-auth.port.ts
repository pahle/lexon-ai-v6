import { Injectable } from '@nestjs/common';
import type {
  AuthCommandSession,
  AuthIntegration,
} from '../../infrastructure/db/index.js';
import {
  assertVerifiedIdentity,
  verifiedIdentityHeaders,
  type VerifiedIdentity,
} from './identity.types.js';
import { IdentityError } from './identity-error.js';
import { IdentityPolicy } from './identity-policy.js';

function databaseFailure(error: unknown): {
  code?: string;
  constraint?: string;
} {
  const seen = new Set<unknown>();
  let current = error;
  for (
    let depth = 0;
    depth < 6 && current && typeof current === 'object' && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    const candidate = current as {
      code?: string;
      constraint?: string;
      cause?: unknown;
    };
    if (
      candidate.code === '40001' ||
      candidate.code === '40P01' ||
      candidate.constraint === 'lexon_team_owner'
    )
      return candidate;
    current = candidate.cause;
  }
  return {};
}
export function isRetryableAuthError(error: unknown): boolean {
  const failure = databaseFailure(error);
  return failure.code === '40001' || failure.code === '40P01';
}
@Injectable()
export class OrganizationAuthPort {
  constructor(private readonly integration: AuthIntegration) {}
  async transaction<T>(
    identity: VerifiedIdentity,
    work: (commands: AuthCommandSession, headers: Headers) => Promise<T>,
  ): Promise<T> {
    assertVerifiedIdentity(identity);
    const headers = verifiedIdentityHeaders(identity);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.integration.transaction(async (tx) => {
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
        });
      } catch (error) {
        const failure = databaseFailure(error);
        if (failure.constraint === 'lexon_team_owner')
          throw new IdentityError('ORG_LAST_OWNER', 409);
        if (
          attempt === 2 ||
          (failure.code !== '40001' && failure.code !== '40P01')
        )
          throw error;
      }
    }
    throw new IdentityError('AUTH_UNAVAILABLE', 503);
  }
}
