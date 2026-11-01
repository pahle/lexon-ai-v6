import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { z } from 'zod';

const evidenceUpdate = z
  .object({
    userId: z.uuid(),
    sessionId: z.uuid(),
    expectedChannel: z.enum(['cookie', 'bearer']),
    channel: z.enum(['cookie', 'bearer']),
    hardExpiresAt: z.iso.datetime().nullable(),
    authenticatedAt: z.iso.datetime(),
    mfaVerifiedAt: z.iso.datetime().nullable(),
    reauthenticatedAt: z.iso.datetime().nullable(),
    activeOrganizationId: z.uuid().nullable(),
    pendingOrganizationId: z.uuid().nullable(),
  })
  .strict();
export type SessionSecurityUpdate = z.infer<typeof evidenceUpdate>;
export interface SecurityPrimitives {
  lock(userId: string, sessionId: string | null): Promise<void>;
  write(input: SessionSecurityUpdate): Promise<void>;
}
interface SecurityUser {
  id: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  role: string | null;
  banned: boolean | null;
}
interface SecuritySession {
  id: string;
  userId: string;
  channel: 'cookie' | 'bearer';
  hardExpiresAt: Date | null;
  expiresAt: Date;
  authenticatedAt: Date | null;
  mfaVerifiedAt: Date | null;
  reauthenticatedAt: Date | null;
  activeOrganizationId: string | null;
  pendingOrganizationId: string | null;
}

export function securityPlugin(primitives: SecurityPrimitives) {
  return {
    id: 'lexon-security',
    endpoints: {
      lexonSecurityFacts: createAuthEndpoint(
        '/lexon/security/facts',
        { method: 'POST', metadata: { scope: 'server' } },
        async (ctx) => {
          const authenticated = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
            disableRefresh: true,
          });
          let userId = authenticated?.user.id;
          let challengeId: string | false | null = null;
          if (!userId) {
            const cookie = ctx.context.createAuthCookie('two_factor');
            challengeId = await ctx.getSignedCookie(
              cookie.name,
              ctx.context.secret,
            );
            if (challengeId) {
              const pending =
                await ctx.context.internalAdapter.findVerificationValue(
                  challengeId,
                );
              if (pending && pending.expiresAt > new Date())
                userId = pending.value;
            }
          }
          if (!userId) return { user: null, session: null, challenge: false };
          await primitives.lock(userId, authenticated?.session.id ?? null);
          const user = await ctx.context.adapter.findOne<SecurityUser>({
            model: 'user',
            where: [{ field: 'id', value: userId }],
          });
          const session = authenticated
            ? await ctx.context.adapter.findOne<SecuritySession>({
                model: 'session',
                where: [
                  { field: 'id', value: authenticated.session.id },
                  { field: 'userId', value: userId },
                ],
              })
            : null;
          let challenge = false;
          if (challengeId) {
            const pending =
              await ctx.context.internalAdapter.findVerificationValue(
                challengeId,
              );
            challenge =
              !!pending &&
              pending.value === userId &&
              pending.expiresAt > new Date();
          }
          return {
            user: user
              ? {
                  id: user.id,
                  emailVerified: user.emailVerified,
                  twoFactorEnabled: user.twoFactorEnabled,
                  role: user.role,
                  banned: user.banned,
                }
              : null,
            session: session
              ? {
                  id: session.id,
                  userId: session.userId,
                  channel: session.channel,
                  hardExpiresAt: session.hardExpiresAt,
                  expiresAt: session.expiresAt,
                  authenticatedAt: session.authenticatedAt,
                  mfaVerifiedAt: session.mfaVerifiedAt,
                  reauthenticatedAt: session.reauthenticatedAt,
                  activeOrganizationId: session.activeOrganizationId,
                  pendingOrganizationId: session.pendingOrganizationId,
                }
              : null,
            challenge,
          };
        },
      ),
      lexonSetSessionSecurity: createAuthEndpoint(
        '/lexon/security/session-evidence',
        { method: 'POST', metadata: { scope: 'server' }, body: evidenceUpdate },
        async (ctx) => {
          await primitives.write(ctx.body);
          return { status: true };
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
