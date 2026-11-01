import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, APIError } from 'better-auth/api';
import { z } from 'zod';

export interface OrganizationPrimitives {
  lock(id: string): Promise<void>;
}
export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  state: string;
  require2fa: boolean;
  createdAt: Date;
}
export interface MemberRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}
export function organizationPrimitivesPlugin(
  primitives: OrganizationPrimitives,
) {
  return {
    id: 'lexon-organization',
    endpoints: {
      lexonOrganizationFacts: createAuthEndpoint(
        '/lexon/organization/facts',
        {
          method: 'POST',
          metadata: { scope: 'server' },
          body: z
            .object({
              organizationId: z.uuid(),
              actorUserId: z.uuid(),
              targetMemberId: z.uuid().optional(),
            })
            .strict(),
        },
        async (ctx) => {
          await primitives.lock(ctx.body.organizationId);
          const organization = await ctx.context.adapter.findOne<OrgRow>({
            model: 'organization',
            where: [{ field: 'id', value: ctx.body.organizationId }],
          });
          const actor = await ctx.context.adapter.findOne<MemberRow>({
            model: 'member',
            where: [
              { field: 'organizationId', value: ctx.body.organizationId },
              { field: 'userId', value: ctx.body.actorUserId },
            ],
          });
          const target = ctx.body.targetMemberId
            ? await ctx.context.adapter.findOne<MemberRow>({
                model: 'member',
                where: [
                  { field: 'organizationId', value: ctx.body.organizationId },
                  { field: 'id', value: ctx.body.targetMemberId },
                ],
              })
            : null;
          const ownerCount = await ctx.context.adapter.count({
            model: 'member',
            where: [
              { field: 'organizationId', value: ctx.body.organizationId },
              { field: 'role', value: 'owner' },
            ],
          });
          return { organization, actor, target, ownerCount };
        },
      ),
      lexonListOrganizationFacts: createAuthEndpoint(
        '/lexon/organization/list-facts',
        {
          method: 'POST',
          metadata: { scope: 'server' },
          body: z
            .object({
              userId: z.uuid(),
              limit: z.number().int().min(1).max(101),
              cursor: z.uuid().optional(),
            })
            .strict(),
        },
        async (ctx) => {
          const members = await ctx.context.adapter.findMany<MemberRow>({
            model: 'member',
            where: [
              { field: 'userId', value: ctx.body.userId },
              ...(ctx.body.cursor
                ? [
                    {
                      field: 'organizationId',
                      operator: 'gt' as const,
                      value: ctx.body.cursor,
                    },
                  ]
                : []),
            ],
            sortBy: { field: 'organizationId', direction: 'asc' },
            limit: ctx.body.limit,
          });
          const organizations = members.length
            ? await ctx.context.adapter.findMany<OrgRow>({
                model: 'organization',
                where: [
                  {
                    field: 'id',
                    operator: 'in',
                    value: members.map((member) => member.organizationId),
                  },
                ],
                limit: ctx.body.limit,
              })
            : [];
          return members.map((member) => ({
            member,
            organization:
              organizations.find(
                (organization) => organization.id === member.organizationId,
              ) ?? null,
          }));
        },
      ),
      lexonSetOrganizationRequirement: createAuthEndpoint(
        '/lexon/organization/requirement',
        {
          method: 'POST',
          metadata: { scope: 'server' },
          body: z
            .object({
              organizationId: z.uuid(),
              actorUserId: z.uuid(),
              expectedActorRole: z.enum(['owner', 'admin', 'member']),
              expectedRequire2fa: z.boolean(),
              require2fa: z.boolean(),
            })
            .strict(),
        },
        async (ctx) => {
          await primitives.lock(ctx.body.organizationId);
          const actor = await ctx.context.adapter.findOne<MemberRow>({
            model: 'member',
            where: [
              { field: 'organizationId', value: ctx.body.organizationId },
              { field: 'userId', value: ctx.body.actorUserId },
            ],
          });
          const organization = await ctx.context.adapter.findOne<OrgRow>({
            model: 'organization',
            where: [{ field: 'id', value: ctx.body.organizationId }],
          });
          if (
            actor?.role !== ctx.body.expectedActorRole ||
            organization?.require2fa !== ctx.body.expectedRequire2fa
          )
            throw new APIError('CONFLICT', {
              message: 'Organization changed.',
            });
          await ctx.context.adapter.update({
            model: 'organization',
            where: [{ field: 'id', value: ctx.body.organizationId }],
            update: { require2fa: ctx.body.require2fa },
          });
          return { status: true };
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
