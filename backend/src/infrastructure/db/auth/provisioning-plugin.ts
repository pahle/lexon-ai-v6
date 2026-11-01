import { randomUUID } from 'node:crypto';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';
import type { OrganizationPrimitives, OrgRow } from './organization-plugin.js';
import type { InvitationRow } from './invitation-plugin.js';
export interface ProvisioningPrimitives {
  cancel(organizationId: string, invitationId: string): Promise<boolean>;
}
const scope = { scope: 'server' } as const;
export function provisioningPlugin(
  organizations: OrganizationPrimitives,
  primitives: ProvisioningPrimitives,
) {
  return {
    id: 'lexon-provisioning',
    endpoints: {
      lexonProvisioningFacts: createAuthEndpoint(
        '/lexon/provisioning/facts',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({ organizationId: z.uuid() }),
        },
        async (ctx) => {
          await organizations.lock(ctx.body.organizationId);
          const organization = await ctx.context.adapter.findOne<OrgRow>({
            model: 'organization',
            where: [{ field: 'id', value: ctx.body.organizationId }],
          });
          const invitation = await ctx.context.adapter.findOne<InvitationRow>({
            model: 'invitation',
            where: [
              { field: 'organizationId', value: ctx.body.organizationId },
              { field: 'purpose', value: 'first_owner' },
              { field: 'replacedByInvitationId', value: null },
            ],
          });
          return { organization, invitation };
        },
      ),
      lexonProvisionTeam: createAuthEndpoint(
        '/lexon/provisioning/create',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({
            name: z.string(),
            slug: z.string(),
            email: z.string(),
            inviterId: z.uuid(),
            expiresAt: z.iso.datetime(),
          }),
        },
        async (ctx) => {
          const input = ctx.body;
          const organization = await ctx.context.adapter.create<OrgRow>({
            model: 'organization',
            data: {
              name: input.name,
              slug: input.slug,
              kind: 'team',
              state: 'provisioning',
              require2fa: false,
              createdAt: new Date(),
            },
          });
          const invitation = await ctx.context.adapter.create<InvitationRow>({
            model: 'invitation',
            data: {
              organizationId: organization.id,
              email: input.email,
              role: 'owner',
              purpose: 'first_owner',
              status: 'pending',
              inviterId: input.inviterId,
              createdAt: new Date(),
              expiresAt: new Date(input.expiresAt),
              acceptedByUserId: null,
              acceptedAt: null,
              lastSentAt: null,
              replacedByInvitationId: null,
            },
          });
          return { organization, invitation };
        },
      ),
      lexonReplaceOwnerInvitation: createAuthEndpoint(
        '/lexon/provisioning/replace',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({
            organizationId: z.uuid(),
            expectedInvitationId: z.uuid(),
            email: z.string(),
            inviterId: z.uuid(),
            expiresAt: z.iso.datetime(),
          }),
        },
        async (ctx) => {
          const input = ctx.body;
          await organizations.lock(input.organizationId);
          const organization = await ctx.context.adapter.findOne<OrgRow>({
            model: 'organization',
            where: [{ field: 'id', value: input.organizationId }],
          });
          const current = await ctx.context.adapter.findOne<InvitationRow>({
            model: 'invitation',
            where: [
              { field: 'id', value: input.expectedInvitationId },
              { field: 'organizationId', value: input.organizationId },
            ],
          });
          if (
            organization?.state !== 'provisioning' ||
            !current ||
            current.replacedByInvitationId !== null
          )
            throw new APIError('CONFLICT', { message: 'State changed' });
          const id = randomUUID();
          await ctx.context.adapter.update({
            model: 'invitation',
            where: [{ field: 'id', value: current.id }],
            update: { status: 'canceled', replacedByInvitationId: id },
          });
          const data = {
            id,
            organizationId: input.organizationId,
            email: input.email,
            role: 'owner',
            purpose: 'first_owner',
            status: 'pending',
            inviterId: input.inviterId,
            createdAt: new Date(),
            expiresAt: new Date(input.expiresAt),
            acceptedByUserId: null,
            acceptedAt: null,
            lastSentAt: null,
            replacedByInvitationId: null,
          };
          const invitation = await ctx.context.adapter.create<InvitationRow>({
            model: 'invitation',
            data,
            forceAllowId: true,
          });
          return { organization, invitation };
        },
      ),
      lexonListProvisioning: createAuthEndpoint(
        '/lexon/provisioning/list',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({
            limit: z.number().int().min(1).max(101),
            cursor: z.uuid().optional(),
          }),
        },
        async (ctx) => {
          const rows = await ctx.context.adapter.findMany<OrgRow>({
            model: 'organization',
            where: [
              { field: 'state', value: 'provisioning' },
              ...(ctx.body.cursor
                ? [
                    {
                      field: 'id',
                      value: ctx.body.cursor,
                      operator: 'gt' as const,
                    },
                  ]
                : []),
            ],
            sortBy: { field: 'id', direction: 'asc' },
            limit: ctx.body.limit,
          });
          const invitations = rows.length
            ? await ctx.context.adapter.findMany<InvitationRow>({
                model: 'invitation',
                limit: rows.length,
                where: [
                  {
                    field: 'organizationId',
                    operator: 'in',
                    value: rows.map((row) => row.id),
                  },
                  { field: 'purpose', value: 'first_owner' },
                  { field: 'replacedByInvitationId', value: null },
                ],
              })
            : [];
          return rows.map((organization) => ({
            organization,
            invitation:
              invitations.find(
                (row) => row.organizationId === organization.id,
              ) ?? null,
          }));
        },
      ),
      lexonCancelProvisioning: createAuthEndpoint(
        '/lexon/provisioning/cancel',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({
            organizationId: z.uuid(),
            expectedInvitationId: z.uuid(),
          }),
        },
        async (ctx) => ({
          cancelled: await primitives.cancel(
            ctx.body.organizationId,
            ctx.body.expectedInvitationId,
          ),
        }),
      ),
    },
  } satisfies BetterAuthPlugin;
}
