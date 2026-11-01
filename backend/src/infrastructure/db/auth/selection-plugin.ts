import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';

const selectionWrite = z
  .object({
    userId: z.uuid(),
    sessionId: z.uuid(),
    expectedOrganizationId: z.string().max(256).nullable(),
    expectedVersion: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    organizationId: z.uuid(),
    pendingOrganizationId: z.uuid().nullable(),
    expectedMemberId: z.uuid(),
  })
  .strict();
export type SelectionWrite = z.infer<typeof selectionWrite>;
export interface SelectionPrimitives {
  lock(
    userId: string,
    sessionId: string,
    targetId: string | undefined,
  ): Promise<void>;
  write(input: SelectionWrite): Promise<boolean>;
}
export interface SelectionSessionRow {
  id: string;
  userId: string;
  activeOrganizationId: string;
  activeOrganizationName: string | null;
  pendingOrganizationId: string | null;
  selectionVersion: number;
}
export interface SelectionOrgRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  state: string;
  require2fa: boolean;
  personalOwnerId: string | null;
  createdAt: Date;
}
export interface SelectionMemberRow {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
}

export function selectionPlugin(primitives: SelectionPrimitives) {
  return {
    id: 'lexon-selection',
    endpoints: {
      lexonSelectionFacts: createAuthEndpoint(
        '/lexon/selection/facts',
        {
          method: 'POST',
          metadata: { scope: 'server' },
          body: z
            .object({
              userId: z.uuid(),
              sessionId: z.uuid(),
              targetOrganizationId: z.uuid().optional(),
            })
            .strict(),
        },
        async (ctx) => {
          await primitives.lock(
            ctx.body.userId,
            ctx.body.sessionId,
            ctx.body.targetOrganizationId,
          );
          const session =
            await ctx.context.adapter.findOne<SelectionSessionRow>({
              model: 'session',
              where: [
                { field: 'id', value: ctx.body.sessionId },
                { field: 'userId', value: ctx.body.userId },
              ],
            });
          const personal = await ctx.context.adapter.findOne<SelectionOrgRow>({
            model: 'organization',
            where: [
              { field: 'personalOwnerId', value: ctx.body.userId },
              { field: 'kind', value: 'personal' },
            ],
          });
          const member = (id: string) =>
            ctx.context.adapter.findOne<SelectionMemberRow>({
              model: 'member',
              where: [
                { field: 'organizationId', value: id },
                { field: 'userId', value: ctx.body.userId },
              ],
            });
          const organization = (id: string) =>
            ctx.context.adapter.findOne<SelectionOrgRow>({
              model: 'organization',
              where: [{ field: 'id', value: id }],
            });
          const selectedValid =
            !!session &&
            z.uuid().safeParse(session.activeOrganizationId).success;
          const selected = selectedValid
            ? await organization(session!.activeOrganizationId)
            : null;
          const selectedMember = selectedValid
            ? await member(session!.activeOrganizationId)
            : null;
          const target = ctx.body.targetOrganizationId
            ? await organization(ctx.body.targetOrganizationId)
            : null;
          const targetMember = ctx.body.targetOrganizationId
            ? await member(ctx.body.targetOrganizationId)
            : null;
          return {
            session,
            personal,
            personalMember: personal ? await member(personal.id) : null,
            selected,
            selectedMember,
            target,
            targetMember,
          };
        },
      ),
      lexonSelectOrganization: createAuthEndpoint(
        '/lexon/selection/select',
        { method: 'POST', metadata: { scope: 'server' }, body: selectionWrite },
        async (ctx) => ({ applied: await primitives.write(ctx.body) }),
      ),
      lexonRepairSelection: createAuthEndpoint(
        '/lexon/selection/repair',
        { method: 'POST', metadata: { scope: 'server' }, body: selectionWrite },
        async (ctx) => ({ applied: await primitives.write(ctx.body) }),
      ),
    },
  } satisfies BetterAuthPlugin;
}
