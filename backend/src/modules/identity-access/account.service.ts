import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SignUpInputSchema,
  ProfileInputSchema,
  SafeProfileSchema,
  type SafeProfile,
  type ProfileInput,
} from '@lexon/contracts';
import type {
  AuthIntegration,
  AuthCommandSession,
} from '../../infrastructure/db/index.js';
import { SignupPolicy } from './signup-policy.js';
import {
  assertVerifiedIdentity,
  type VerifiedIdentity,
} from './identity.types.js';
import { appendAuthAudit, correlateEmail } from '../audit/index.js';
import { IdentityError } from './identity-error.js';
import { authResponseCookies } from './auth-response-cookies.js';

@Injectable()
export class AccountService {
  constructor(
    private readonly integration: AuthIntegration,
    private readonly config: {
      openSignup: boolean;
      audit?: { secret: string; keyId: string };
    },
  ) {}

  async prepareOperation(
    tx: AuthCommandSession,
    path: string,
    body: Record<string, unknown>,
    headers: Headers,
  ): Promise<(response: Response) => Promise<Response>> {
    const session = await tx.call('getSession', {
      headers,
      query: { disableRefresh: true },
    });
    const facts = await tx.call('lexonAccountOperationFacts', {
      body: {
        ...(typeof body.email === 'string'
          ? { email: body.email.trim().toLowerCase() }
          : {}),
        ...(path === '/reset-password' && typeof body.token === 'string'
          ? { resetToken: body.token }
          : {}),
        ...(path === '/verify-email' && typeof body.token === 'string'
          ? { verificationToken: body.token }
          : {}),
      },
    });
    return async (response) => {
      if (response.status >= 400) return response;
      const actions: Record<
        string,
        | 'password_changed'
        | 'password_reset'
        | 'email_change_requested'
        | 'email_changed'
        | 'sessions_revoked'
        | 'signed_out'
      > = {
        '/change-password': 'password_changed',
        '/reset-password': 'password_reset',
        '/change-email': 'email_change_requested',
        '/revoke-sessions': 'sessions_revoked',
        '/revoke-other-sessions': 'sessions_revoked',
        '/sign-out': 'signed_out',
      };
      const subjectUserId =
        path === '/reset-password' || path === '/verify-email'
          ? facts.userId
          : (session?.user.id ?? facts.userId);
      const action =
        path === '/verify-email' && facts.emailUpdate
          ? 'email_changed'
          : actions[path];
      if (action && subjectUserId)
        await appendAuthAudit(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'identity.account_changed.v1',
          outcome: 'success',
          subjectUserId,
          ...(session && session.user.id === subjectUserId
            ? { actorUserId: session.user.id, sessionId: session.session.id }
            : {}),
          metadata: { action },
        });
      if (path === '/sign-in/email') {
        const data: unknown = await response.clone().json();
        const result = data as {
          twoFactorRedirect?: boolean;
          user?: { id?: string };
        };
        if (result.user?.id && !result.twoFactorRedirect)
          await appendAuthAudit(tx, {
            version: 1,
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            type: 'identity.sign_in_succeeded.v1',
            outcome: 'success',
            subjectUserId: result.user.id,
            metadata: { channel: 'cookie' },
          });
      }
      if (path === '/verify-email') {
        // Pinned Better Auth's email-change verification can create a session
        // even when autoSignInAfterVerification=false. Remove only the session
        // named by its response, never another concurrent sign-in's session.
        const credentials = authResponseCookies(response);
        if (credentials) {
          const issued = await tx.call('getSession', {
            headers: credentials,
          });
          if (issued && issued.session.id !== session?.session.id)
            await tx.call('revokeSession', {
              headers: credentials,
              body: { token: issued.session.token },
            });
        }
        const safeHeaders = new Headers(response.headers);
        safeHeaders.delete('set-cookie');
        safeHeaders.delete('set-auth-token');
        return new Response(response.body, {
          status: response.status,
          headers: safeHeaders,
        });
      }
      return response;
    };
  }
  async recordFailedSignIn(email: string): Promise<void> {
    if (!this.config.audit) throw new IdentityError('AUTH_UNAVAILABLE', 503);
    const metadata = correlateEmail(
      email,
      this.config.audit.secret,
      this.config.audit.keyId,
    );
    await this.integration.transaction(async (tx) => {
      const facts = await tx.call('lexonAccountOperationFacts', {
        body: { email: email.trim().toLowerCase() },
      });
      await appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        type: 'identity.sign_in_failed.v1',
        outcome: 'failure',
        ...(facts.userId
          ? {
              subjectUserId: facts.userId,
              metadata: { reason: 'invalid_credentials' },
            }
          : { metadata: { ...metadata, reason: 'invalid_credentials' } }),
      });
    });
  }

  async authorizeSignup(tx: AuthCommandSession, input: unknown): Promise<void> {
    const body = SignUpInputSchema.parse(input);
    const policy = new SignupPolicy({
      openSignup: this.config.openSignup,
      readFacts: (proof) => tx.call('lexonSignupEligibility', { body: proof }),
    });
    await policy.authorize({
      email: body.email,
      ...(body.invitationId ? { invitationId: body.invitationId } : {}),
      ...(body.setupToken ? { setupToken: body.setupToken } : {}),
    });
  }
  async signUp(input: unknown): Promise<{ status: true }> {
    const body = SignUpInputSchema.parse(input);
    await this.integration.transaction(async (tx) => {
      await this.authorizeSignup(tx, body);
      // Grant fields are proofs of registration eligibility only. They never
      // reach native user creation or assign organization/admin rights.
      await tx.call('signUpEmail', {
        body: { name: body.name, email: body.email, password: body.password },
      });
    });
    return { status: true };
  }
  async profile(identity: VerifiedIdentity): Promise<SafeProfile> {
    assertVerifiedIdentity(identity);
    return this.integration.transaction(async (tx) =>
      SafeProfileSchema.parse(
        await tx.call('lexonAccountProfile', {
          body: { userId: identity.userId },
        }),
      ),
    );
  }
  async updateProfile(
    identity: VerifiedIdentity,
    input: ProfileInput,
  ): Promise<SafeProfile> {
    assertVerifiedIdentity(identity);
    const body = ProfileInputSchema.parse(input);
    return this.integration.transaction(async (tx) =>
      SafeProfileSchema.parse(
        await tx.call('lexonAccountProfile', {
          body: { userId: identity.userId, name: body.name },
        }),
      ),
    );
  }
  async completeOnboarding(identity: VerifiedIdentity): Promise<void> {
    assertVerifiedIdentity(identity);
    await this.integration.transaction((tx) =>
      tx.call('lexonAccountProfile', {
        body: { userId: identity.userId, completeOnboarding: true },
      }),
    );
  }
}
