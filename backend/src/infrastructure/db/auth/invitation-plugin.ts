import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';
import type {
  OrganizationPrimitives,
  OrgRow,
  MemberRow,
} from './organization-plugin.js';
export interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterId: string;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  lastSentAt: Date | null;
  replacedByInvitationId: string | null;
  purpose: string;
}
export interface InvitationUserRow {
  role: string | null;
  id: string;
  email: string;
  emailVerified: boolean;
}
const scope = { scope: 'server' } as const;
const expected = z
  .object({
    invitationId: z.uuid(),
    actorUserId: z.uuid(),
    expectedEmail: z.string(),
    expectedStatus: z.string(),
    expectedAcceptedByUserId: z.string().nullable(),
    expectedMemberId: z.uuid().nullable(),
    expectedMemberRole: z.string().nullable(),
    resultingRole: z.enum(['member', 'admin', 'owner']),
    acceptanceAction: z.enum(['join', 'update', 'retry']),
    activateOrganization: z.boolean(),
  })
  .strict();
export function invitationPlugin(
  organizations: OrganizationPrimitives,
  deliver: (invitation: InvitationRow, organization: OrgRow) => Promise<void>,
) {
  return {
    id: 'lexon-invitation',
    endpoints: {
      lexonInvitationFacts: createAuthEndpoint(
        '/lexon/invitation/facts',
        {
          method: 'POST',
          metadata: scope,
          body: z
            .object({
              actorUserId: z.uuid(),
              invitationId: z.uuid().optional(),
              organizationId: z.uuid().optional(),
              email: z.string().optional(),
            })
            .strict(),
        },
        async (ctx) => {
          const find = () =>
            ctx.context.adapter.findOne<InvitationRow>({
              model: 'invitation',
              where: [{ field: 'id', value: ctx.body.invitationId! }],
            });
          const initial = ctx.body.invitationId ? await find() : null;
          const orgId = initial?.organizationId ?? ctx.body.organizationId;
          if (orgId) await organizations.lock(orgId);
          const invitation = ctx.body.invitationId ? await find() : null;
          const organization = orgId
            ? await ctx.context.adapter.findOne<OrgRow>({
                model: 'organization',
                where: [{ field: 'id', value: orgId }],
              })
            : null;
          const user = await ctx.context.adapter.findOne<InvitationUserRow>({
            model: 'user',
            where: [{ field: 'id', value: ctx.body.actorUserId }],
          });
          const member = orgId
            ? await ctx.context.adapter.findOne<MemberRow>({
                model: 'member',
                where: [
                  { field: 'organizationId', value: orgId },
                  { field: 'userId', value: ctx.body.actorUserId },
                ],
              })
            : null;
          const pending =
            orgId && ctx.body.email
              ? await ctx.context.adapter.findOne<InvitationRow>({
                  model: 'invitation',
                  where: [
                    { field: 'organizationId', value: orgId },
                    { field: 'email', value: ctx.body.email },
                    { field: 'status', value: 'pending' },
                  ],
                })
              : null;
          const recipient = ctx.body.email
            ? await ctx.context.adapter.findOne<InvitationUserRow>({
                model: 'user',
                where: [{ field: 'email', value: ctx.body.email }],
              })
            : null;
          const recipientMember =
            orgId && recipient
              ? await ctx.context.adapter.findOne<MemberRow>({
                  model: 'member',
                  where: [
                    { field: 'organizationId', value: orgId },
                    { field: 'userId', value: recipient.id },
                  ],
                })
              : null;
          return {
            invitation,
            organization,
            user,
            member,
            pending,
            recipientMember,
          };
        },
      ),
      lexonAcceptInvitation: createAuthEndpoint(
        '/lexon/invitation/accept',
        { method: 'POST', metadata: scope, body: expected },
        async (ctx) => {
          const input = ctx.body;
          const initial = await ctx.context.adapter.findOne<InvitationRow>({
            model: 'invitation',
            where: [{ field: 'id', value: input.invitationId }],
          });
          if (!initial)
            throw new APIError('CONFLICT', { message: 'State changed' });
          await organizations.lock(initial.organizationId);
          const invitation = await ctx.context.adapter.findOne<InvitationRow>({
            model: 'invitation',
            where: [{ field: 'id', value: input.invitationId }],
          });
          const user = await ctx.context.adapter.findOne<InvitationUserRow>({
            model: 'user',
            where: [{ field: 'id', value: input.actorUserId }],
          });
          let member = await ctx.context.adapter.findOne<MemberRow>({
            model: 'member',
            where: [
              { field: 'organizationId', value: initial.organizationId },
              { field: 'userId', value: input.actorUserId },
            ],
          });
          if (
            !invitation ||
            !user ||
            user.email !== input.expectedEmail ||
            invitation.status !== input.expectedStatus ||
            invitation.acceptedByUserId !== input.expectedAcceptedByUserId ||
            (member?.id ?? null) !== input.expectedMemberId ||
            (member?.role ?? null) !== input.expectedMemberRole
          )
            throw new APIError('CONFLICT', { message: 'State changed' });
          if (input.acceptanceAction === 'retry') return { invitation, member };
          if (input.acceptanceAction === 'join')
            member = await ctx.context.adapter.create<MemberRow>({
              model: 'member',
              data: {
                organizationId: invitation.organizationId,
                userId: input.actorUserId,
                role: input.resultingRole,
                createdAt: new Date(),
              },
            });
          else if (member)
            member = await ctx.context.adapter.update<MemberRow>({
              model: 'member',
              where: [{ field: 'id', value: member.id }],
              update: { role: input.resultingRole },
            });
          const accepted = await ctx.context.adapter.update<InvitationRow>({
            model: 'invitation',
            where: [{ field: 'id', value: invitation.id }],
            update: {
              status: 'accepted',
              acceptedByUserId: input.actorUserId,
              acceptedAt: new Date(),
            },
          });
          if (input.activateOrganization)
            await ctx.context.adapter.update({
              model: 'organization',
              where: [{ field: 'id', value: invitation.organizationId }],
              update: { state: 'active' },
            });
          return { invitation: accepted, member };
        },
      ),
      lexonCreateExistingMemberInvitation: createAuthEndpoint(
        '/lexon/invitation/create-existing',
        {
          method: 'POST',
          metadata: scope,
          body: z
            .object({
              organizationId: z.uuid(),
              email: z.string(),
              role: z.enum(['member', 'admin']),
              inviterId: z.uuid(),
              expectedMemberId: z.uuid(),
              expiresAt: z.iso.datetime(),
            })
            .strict(),
        },
        async (ctx) => {
          const data = ctx.body;
          await organizations.lock(data.organizationId);
          const member = await ctx.context.adapter.findOne<MemberRow>({
            model: 'member',
            where: [
              { field: 'id', value: data.expectedMemberId },
              { field: 'organizationId', value: data.organizationId },
            ],
          });
          if (!member)
            throw new APIError('CONFLICT', { message: 'State changed' });
          return ctx.context.adapter.create<InvitationRow>({
            model: 'invitation',
            data: {
              organizationId: data.organizationId,
              email: data.email,
              role: data.role,
              inviterId: data.inviterId,
              status: 'pending',
              purpose: 'team',
              acceptedByUserId: null,
              acceptedAt: null,
              lastSentAt: null,
              replacedByInvitationId: null,
              expiresAt: new Date(data.expiresAt),
              createdAt: new Date(),
            },
          });
        },
      ),
      lexonReplaceInvitation: createAuthEndpoint(
        '/lexon/invitation/replace',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({
            invitationId: z.uuid(),
            expectedEmail: z.string(),
            expectedRole: z.enum(['member', 'admin']),
            expectedExpiresAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
          }),
        },
        async (ctx) => {
          const input = ctx.body;
          const initial = await ctx.context.adapter.findOne<InvitationRow>({
            model: 'invitation',
            where: [{ field: 'id', value: input.invitationId }],
          });
          if (!initial)
            throw new APIError('CONFLICT', { message: 'State changed' });
          await organizations.lock(initial.organizationId);
          const row = await ctx.context.adapter.findOne<InvitationRow>({
            model: 'invitation',
            where: [{ field: 'id', value: input.invitationId }],
          });
          if (
            !row ||
            row.status !== 'pending' ||
            row.email !== input.expectedEmail ||
            row.role !== input.expectedRole ||
            row.expiresAt.toISOString() !== input.expectedExpiresAt
          )
            throw new APIError('CONFLICT', { message: 'State changed' });
          await ctx.context.adapter.update({
            model: 'invitation',
            where: [{ field: 'id', value: row.id }],
            update: { status: 'canceled' },
          });
          const replacement = await ctx.context.adapter.create<InvitationRow>({
            model: 'invitation',
            data: {
              organizationId: row.organizationId,
              email: row.email,
              role: row.role,
              purpose: row.purpose,
              inviterId: row.inviterId,
              status: 'pending',
              expiresAt: new Date(input.expiresAt),
              createdAt: new Date(),
              acceptedByUserId: null,
              acceptedAt: null,
              lastSentAt: null,
              replacedByInvitationId: null,
            },
          });
          await ctx.context.adapter.update({
            model: 'invitation',
            where: [{ field: 'id', value: row.id }],
            update: { replacedByInvitationId: replacement.id },
          });
          return replacement;
        },
      ),
      lexonDeliverInvitation: createAuthEndpoint(
        '/lexon/invitation/deliver',
        {
          method: 'POST',
          metadata: scope,
          body: z.object({ invitationId: z.uuid() }).strict(),
        },
        async (ctx) => {
          const row = await ctx.context.adapter.findOne<InvitationRow>({
            model: 'invitation',
            where: [{ field: 'id', value: ctx.body.invitationId }],
          });
          const org = row
            ? await ctx.context.adapter.findOne<OrgRow>({
                model: 'organization',
                where: [{ field: 'id', value: row.organizationId }],
              })
            : null;
          if (!row || !org)
            throw new APIError('CONFLICT', { message: 'State changed' });
          await deliver(row, org);
          return { dispatched: true };
        },
      ),
      lexonInvitationMetadata: createAuthEndpoint(
        '/lexon/invitation/metadata',
        {
          method: 'POST',
          metadata: scope,
          body: z
            .object({
              invitationId: z.uuid(),
              expectedStatus: z.string(),
              lastSentAt: z.iso.datetime().optional(),
              replacedByInvitationId: z.uuid().optional(),
            })
            .strict(),
        },
        async (ctx) => {
          const row = await ctx.context.adapter.findOne<InvitationRow>({
            model: 'invitation',
            where: [{ field: 'id', value: ctx.body.invitationId }],
          });
          if (!row || row.status !== ctx.body.expectedStatus)
            throw new APIError('CONFLICT', { message: 'State changed' });
          return ctx.context.adapter.update<InvitationRow>({
            model: 'invitation',
            where: [{ field: 'id', value: row.id }],
            update: {
              ...(ctx.body.lastSentAt
                ? { lastSentAt: new Date(ctx.body.lastSentAt) }
                : {}),
              ...(ctx.body.replacedByInvitationId
                ? { replacedByInvitationId: ctx.body.replacedByInvitationId }
                : {}),
            },
          });
        },
      ),
      lexonListInvitationFacts: createAuthEndpoint(
        '/lexon/invitation/list',
        {
          method: 'POST',
          metadata: scope,
          body: z
            .object({
              organizationId: z.uuid().optional(),
              email: z.string().optional(),
              limit: z.number().int().min(1).max(101),
              cursor: z.uuid().optional(),
            })
            .strict(),
        },
        async (ctx) => {
          const input = ctx.body;
          if (!input.organizationId && !input.email)
            throw new APIError('BAD_REQUEST', { message: 'Missing scope' });
          const rows = await ctx.context.adapter.findMany<InvitationRow>({
            model: 'invitation',
            where: [
              ...(input.organizationId
                ? [{ field: 'organizationId', value: input.organizationId }]
                : []),
              ...(input.email
                ? [
                    { field: 'email', value: input.email },
                    { field: 'status', value: 'pending' },
                  ]
                : []),
              ...(input.cursor
                ? [
                    {
                      field: 'id',
                      value: input.cursor,
                      operator: 'gt' as const,
                    },
                  ]
                : []),
            ],
            sortBy: { field: 'id', direction: 'asc' },
            limit: input.limit,
          });
          const orgs = rows.length
            ? await ctx.context.adapter.findMany<OrgRow>({
                model: 'organization',
                limit: rows.length,
                where: [
                  {
                    field: 'id',
                    operator: 'in',
                    value: rows.map((row) => row.organizationId),
                  },
                ],
              })
            : [];
          return rows.map((invitation) => ({
            invitation,
            organization:
              orgs.find((org) => org.id === invitation.organizationId) ?? null,
          }));
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
