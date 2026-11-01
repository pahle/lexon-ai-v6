import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, APIError } from 'better-auth/api';
import { z } from 'zod';
export interface AdminSetupPrimitives {
  lock(digest: string, userId: string | null): Promise<void>;
  hasTeamMembership(userId: string): Promise<boolean>;
  consume(
    digest: string,
    userId: string,
    expectedValue: string,
  ): Promise<boolean>;
}
export interface SetupVerificationRow {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const scope = { scope: 'server' } as const;
export function adminSetupPlugin(primitives: AdminSetupPrimitives) {
  return {
    id: 'lexon-admin-setup',
    endpoints: {
      lexonRedeemAdminSetup: createAuthEndpoint(
        '/lexon/admin-setup/facts',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({ digest, userId: z.uuid().optional() }),
        },
        async (ctx) => {
          await primitives.lock(ctx.body.digest, ctx.body.userId ?? null);
          const grant = await ctx.context.adapter.findOne<SetupVerificationRow>(
            {
              model: 'verification',
              where: [
                {
                  field: 'identifier',
                  value: `lexon.admin-setup.v1:${ctx.body.digest}`,
                },
              ],
            },
          );
          return {
            grant,
            hasTeamMembership: ctx.body.userId
              ? await primitives.hasTeamMembership(ctx.body.userId)
              : false,
          };
        },
      ),
      lexonActivateAdmin: createAuthEndpoint(
        '/lexon/admin-setup/activate',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({
            digest,
            userId: z.uuid(),
            expectedValue: z.string(),
            expectedRole: z.string().nullable(),
          }),
        },
        async (ctx) => {
          await primitives.lock(ctx.body.digest, ctx.body.userId);
          const user = await ctx.context.adapter.findOne<{
            id: string;
            role: string | null;
          }>({
            model: 'user',
            where: [{ field: 'id', value: ctx.body.userId }],
          });
          if (
            !user ||
            user.role !== ctx.body.expectedRole ||
            !(await primitives.consume(
              ctx.body.digest,
              ctx.body.userId,
              ctx.body.expectedValue,
            ))
          )
            throw new APIError('CONFLICT', { message: 'Setup state changed' });
          await ctx.context.adapter.update({
            model: 'user',
            where: [{ field: 'id', value: ctx.body.userId }],
            update: { role: 'admin', pendingAdminActivation: false },
          });
          return { activated: true };
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
