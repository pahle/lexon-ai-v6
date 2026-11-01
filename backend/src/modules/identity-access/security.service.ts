import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ExistingPasswordSchema,
  TotpInputSchema,
  RecoveryCodeInputSchema,
  ReauthenticateInputSchema,
  type ReauthenticateInput,
  type SecurityState,
} from '@lexon/contracts';
import type {
  AuthIntegration,
  AuthCommandSession,
} from '../../infrastructure/db/index.js';
import { appendAuthAudit } from '../audit/index.js';
import { IdentityError } from './identity-error.js';
import {
  assertVerifiedIdentity,
  verifiedIdentityHeaders,
  type VerifiedIdentity,
} from './identity.types.js';
import { authResponseCookies } from './auth-response-cookies.js';

const passwordInput = z.object({ password: ExistingPasswordSchema }).strict();
type Facts = Awaited<ReturnType<SecurityService['facts']>>;
const factorPaths = [
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
];

@Injectable()
export class SecurityService {
  constructor(
    private readonly integration: AuthIntegration,
    private readonly config: { reauthSeconds: number },
  ) {}

  async facts(tx: AuthCommandSession, headers: Headers) {
    return tx.call('lexonSecurityFacts', { headers });
  }
  private requireUser(facts: Facts) {
    if (!facts.user || facts.user.banned)
      throw new IdentityError('AUTH_REQUIRED', 401);
    if (!facts.user.emailVerified)
      throw new IdentityError('AUTH_EMAIL_VERIFICATION_REQUIRED', 403);
    return facts.user;
  }
  private requireRecent(date: Date | null) {
    const age = date ? Date.now() - date.getTime() : Number.NaN;
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age >= this.config.reauthSeconds * 1000
    )
      throw new IdentityError('AUTH_REAUTH_REQUIRED', 403);
  }
  async prepareOperation(
    tx: AuthCommandSession,
    path: string,
    body: Record<string, unknown>,
    headers: Headers,
  ): Promise<(response: Response) => Promise<Response>> {
    const isFactor = factorPaths.includes(path);
    const isSecurity =
      path.startsWith('/two-factor/') ||
      [
        '/change-password',
        '/change-email',
        '/revoke-sessions',
        '/revoke-other-sessions',
      ].includes(path);
    if (path !== '/sign-in/email' && !isSecurity)
      return async (response) => response;
    if (path === '/two-factor/verify-totp') TotpInputSchema.parse(body);
    else if (path === '/two-factor/verify-backup-code')
      RecoveryCodeInputSchema.parse(body);
    else if (path.startsWith('/two-factor/')) passwordInput.parse(body);
    const before = await this.facts(tx, headers);
    if (isSecurity) {
      const user = this.requireUser(before);
      if (path === '/two-factor/verify-backup-code' && !user.twoFactorEnabled)
        throw new IdentityError('AUTH_2FA_REQUIRED', 403);
      if (!before.session) {
        if (!isFactor || !before.challenge)
          throw new IdentityError('AUTH_REQUIRED', 401);
      } else {
        if (user.twoFactorEnabled && !before.session.mfaVerifiedAt)
          throw new IdentityError('AUTH_2FA_REQUIRED', 403);
        if (!isFactor || !user.twoFactorEnabled)
          this.requireRecent(before.session.reauthenticatedAt);
        if (
          before.session.hardExpiresAt &&
          before.session.hardExpiresAt <= new Date()
        )
          throw new IdentityError('AUTH_REQUIRED', 401);
      }
    }
    return async (response) => {
      if (response.status >= 400) return response;
      const next = await tx.call('getSession', {
        headers: authResponseCookies(response) ?? headers,
        query: { disableRefresh: true },
      });
      if (!next) {
        if (path === '/sign-in/email') return response;
        throw new IdentityError('AUTH_REQUIRED', 401);
      }
      if (path === '/sign-in/email' && next.user.twoFactorEnabled)
        throw new IdentityError('AUTH_2FA_REQUIRED', 403);
      if (before.user && isSecurity && before.user.id !== next.user.id)
        throw new IdentityError('AUTH_REQUIRED', 401);
      const previous = before.session;
      const replaced = !!previous && previous.id !== next.session.id;
      const now = new Date().toISOString();
      const fullAuthentication =
        path === '/sign-in/email' ||
        (isFactor &&
          (before.challenge || before.user?.twoFactorEnabled === false));
      const mfa = isFactor
        ? now
        : replaced
          ? null
          : (previous?.mfaVerifiedAt?.toISOString() ?? null);
      await tx.call('lexonSetSessionSecurity', {
        body: {
          userId: next.user.id,
          sessionId: next.session.id,
          expectedChannel: next.session.channel,
          channel: previous?.channel ?? 'cookie',
          hardExpiresAt: previous?.hardExpiresAt?.toISOString() ?? null,
          authenticatedAt: previous?.authenticatedAt?.toISOString() ?? now,
          mfaVerifiedAt: path === '/two-factor/disable' ? null : mfa,
          reauthenticatedAt: fullAuthentication
            ? now
            : replaced
              ? null
              : (previous?.reauthenticatedAt?.toISOString() ?? null),
          activeOrganizationId:
            previous?.activeOrganizationId ??
            next.session.activeOrganizationId ??
            null,
          pendingOrganizationId: previous?.pendingOrganizationId ?? null,
        },
      });
      const action =
        path === '/two-factor/enable'
          ? 'enrollment_started'
          : path === '/two-factor/disable'
            ? 'disabled'
            : path === '/two-factor/generate-backup-codes'
              ? 'recovery_regenerated'
              : isFactor
                ? 'mfa_verified'
                : null;
      if (action) await this.audit(tx, next.user.id, next.session.id, action);
      if (isFactor && before.challenge)
        await appendAuthAudit(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: now,
          type: 'identity.sign_in_succeeded.v1',
          outcome: 'success',
          subjectUserId: next.user.id,
          sessionId: next.session.id,
          metadata: { channel: previous?.channel ?? 'cookie' },
        });
      return response;
    };
  }
  private async audit(
    tx: AuthCommandSession,
    userId: string,
    sessionId: string,
    action:
      | 'enrollment_started'
      | 'disabled'
      | 'recovery_regenerated'
      | 'mfa_verified'
      | 'reauthenticated',
  ) {
    await appendAuthAudit(tx, {
      version: 1,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: 'identity.security_changed.v1',
      outcome: 'success',
      subjectUserId: userId,
      actorUserId: userId,
      sessionId,
      metadata: { action },
    });
  }
  async recordFailedFactor(headers: Headers): Promise<void> {
    await this.integration.transaction(async (tx) => {
      const facts = await this.facts(tx, headers);
      if (!facts.user) return;
      await appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        type: 'identity.sign_in_failed.v1',
        outcome: 'failure',
        subjectUserId: facts.user.id,
        ...(facts.session ? { sessionId: facts.session.id } : {}),
        metadata: { reason: 'invalid_factor' },
      });
    });
  }
  async reauthenticate(
    identity: VerifiedIdentity,
    input: ReauthenticateInput,
  ): Promise<void> {
    assertVerifiedIdentity(identity);
    const headers = verifiedIdentityHeaders(identity);
    const body = ReauthenticateInputSchema.parse(input);
    await this.integration.transaction(async (tx) => {
      const facts = await this.facts(tx, headers);
      const user = this.requireUser(facts);
      if (
        !facts.session ||
        facts.session.id !== identity.sessionId ||
        user.id !== identity.userId
      )
        throw new IdentityError('AUTH_REQUIRED', 401);
      await tx.call('verifyPassword', {
        headers,
        body: { password: body.password },
      });
      if (user.twoFactorEnabled) {
        if (body.totp)
          await tx.call('verifyTOTP', { headers, body: { code: body.totp } });
        else if (body.recoveryCode)
          await tx.call('verifyBackupCode', {
            headers,
            body: { code: body.recoveryCode, disableSession: true },
          });
        else throw new IdentityError('AUTH_2FA_REQUIRED', 403);
      }
      const now = new Date().toISOString();
      const session = facts.session;
      await tx.call('lexonSetSessionSecurity', {
        body: {
          userId: user.id,
          sessionId: session.id,
          expectedChannel: session.channel,
          channel: session.channel,
          hardExpiresAt: session.hardExpiresAt?.toISOString() ?? null,
          authenticatedAt: session.authenticatedAt?.toISOString() ?? now,
          mfaVerifiedAt: user.twoFactorEnabled ? now : null,
          reauthenticatedAt: now,
          activeOrganizationId: session.activeOrganizationId,
          pendingOrganizationId: session.pendingOrganizationId,
        },
      });
      await this.audit(tx, user.id, session.id, 'reauthenticated');
    });
  }
  async state(identity: VerifiedIdentity): Promise<SecurityState> {
    assertVerifiedIdentity(identity);
    const headers = verifiedIdentityHeaders(identity);
    return this.integration.transaction(async (tx) => {
      const facts = await this.facts(tx, headers);
      const user = this.requireUser(facts);
      const session = facts.session;
      if (
        !session ||
        session.id !== identity.sessionId ||
        user.id !== identity.userId
      )
        throw new IdentityError('AUTH_REQUIRED', 401);
      let recoveryCodesRemaining = 0;
      if (user.twoFactorEnabled && session.mfaVerifiedAt)
        recoveryCodesRemaining = (
          await tx.call('viewBackupCodes', { body: { userId: user.id } })
        ).backupCodes.length;
      const expires = session.reauthenticatedAt
        ? new Date(
            session.reauthenticatedAt.getTime() +
              this.config.reauthSeconds * 1000,
          )
        : null;
      return {
        version: 1,
        twoFactorEnabled: user.twoFactorEnabled,
        mfaVerified: !!session.mfaVerifiedAt,
        reauthenticationExpiresAt:
          expires && expires > new Date() ? expires.toISOString() : null,
        recoveryCodesRemaining,
      };
    });
  }
}
