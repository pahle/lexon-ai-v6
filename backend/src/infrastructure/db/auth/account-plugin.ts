import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, APIError } from 'better-auth/api';
import { z } from 'zod';
import { verifyJWT } from 'better-auth/crypto';

export interface AccountLocks {
  grants(
    invitationId: string | undefined,
    setupDigest: string | undefined,
  ): Promise<void>;
  user(userId: string): Promise<void>;
}
interface InvitationRow {
  organizationId: string;
  email: string;
  status: string;
  expiresAt: Date;
  purpose: string;
}
interface OrganizationRow {
  state: string;
}
interface VerificationRow {
  value: string;
  expiresAt: Date;
}
interface ProfileRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  onboardingComplete: boolean;
}

// Private server-only primitives. Callers supply explicit IDs and domain
// decisions inside the same transaction; no role matrix or admission policy.
export function accountPlugin(locks: AccountLocks) {
  return {
    id: 'lexon-account',
    endpoints: {
      lexonAccountOperationFacts: createAuthEndpoint(
        '/lexon/account/operation-facts',
        {
          method: 'POST',
          metadata: { scope: 'server' },
          body: z
            .object({
              email: z.email().optional(),
              resetToken: z.string().max(4096).optional(),
              verificationToken: z.string().max(4096).optional(),
            })
            .strict(),
        },
        async (ctx) => {
          let email = ctx.body.email;
          let emailUpdate = false;
          if (ctx.body.verificationToken) {
            const payload = await verifyJWT<unknown>(
              ctx.body.verificationToken,
              ctx.context.secret,
            );
            const parsed = z
              .object({ email: z.email(), updateTo: z.email().optional() })
              .safeParse(payload);
            if (parsed.success) {
              email = parsed.data.email;
              emailUpdate = !!parsed.data.updateTo;
            }
          }
          const reset = ctx.body.resetToken
            ? await ctx.context.adapter.findOne<{
                value: string;
                expiresAt: Date;
              }>({
                model: 'verification',
                where: [
                  {
                    field: 'identifier',
                    value: `reset-password:${ctx.body.resetToken}`,
                  },
                ],
              })
            : null;
          const subject = email
            ? await ctx.context.adapter.findOne<{ id: string }>({
                model: 'user',
                where: [{ field: 'email', value: email }],
              })
            : null;
          const userId =
            subject?.id ??
            (reset && reset.expiresAt > new Date() ? reset.value : null);
          if (userId) await locks.user(userId);
          return { userId, emailUpdate };
        },
      ),
      lexonSignupEligibility: createAuthEndpoint(
        '/lexon/account/signup-facts',
        {
          method: 'POST',
          metadata: { scope: 'server' },
          body: z
            .object({
              invitationId: z.uuid().optional(),
              setupDigest: z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .optional(),
            })
            .strict(),
        },
        async (ctx) => {
          await locks.grants(ctx.body.invitationId, ctx.body.setupDigest);
          const invitation = ctx.body.invitationId
            ? await ctx.context.adapter.findOne<InvitationRow>({
                model: 'invitation',
                where: [{ field: 'id', value: ctx.body.invitationId }],
              })
            : null;
          const organization = invitation
            ? await ctx.context.adapter.findOne<OrganizationRow>({
                model: 'organization',
                where: [{ field: 'id', value: invitation.organizationId }],
              })
            : null;
          const setup = ctx.body.setupDigest
            ? await ctx.context.adapter.findOne<VerificationRow>({
                model: 'verification',
                where: [
                  {
                    field: 'identifier',
                    value: `lexon.admin-setup.v1:${ctx.body.setupDigest}`,
                  },
                ],
              })
            : null;
          return {
            invitation:
              invitation && organization
                ? {
                    email: invitation.email,
                    status: invitation.status,
                    expiresAt: invitation.expiresAt.toISOString(),
                    purpose: invitation.purpose,
                    organizationState: organization.state,
                  }
                : null,
            setup: setup
              ? { value: setup.value, expiresAt: setup.expiresAt.toISOString() }
              : null,
          };
        },
      ),
      lexonAccountProfile: createAuthEndpoint(
        '/lexon/account/profile',
        {
          method: 'POST',
          metadata: { scope: 'server' },
          body: z
            .object({
              userId: z.uuid(),
              name: z.string().trim().min(1).max(100).optional(),
              completeOnboarding: z.literal(true).optional(),
            })
            .strict(),
        },
        async (ctx) => {
          await locks.user(ctx.body.userId);
          const where = [{ field: 'id', value: ctx.body.userId }];
          const data = {
            ...(ctx.body.name !== undefined ? { name: ctx.body.name } : {}),
            ...(ctx.body.completeOnboarding
              ? { onboardingComplete: true }
              : {}),
          };
          if (Object.keys(data).length)
            await ctx.context.adapter.update({
              model: 'user',
              where,
              update: data,
            });
          const user = await ctx.context.adapter.findOne<ProfileRow>({
            model: 'user',
            where,
          });
          if (!user)
            throw new APIError('UNAUTHORIZED', {
              message: 'Authentication required.',
            });
          return {
            version: 1 as const,
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            twoFactorEnabled: user.twoFactorEnabled,
            onboardingCompleted: user.onboardingComplete,
          };
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
