import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';
import type { SecurityPrimitives } from './security-plugin.js';
interface SessionRow {
  id: string;
  userId: string;
  token: string;
  channel: 'cookie' | 'bearer';
  activeOrganizationId: string;
  hardExpiresAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  authenticatedAt: Date | null;
  mfaVerifiedAt: Date | null;
  reauthenticatedAt: Date | null;
}
const scope = { scope: 'server' } as const;
export function sessionPlugin(security: SecurityPrimitives) {
  return {
    id: 'lexon-sessions',
    endpoints: {
      lexonIssueBearer: createAuthEndpoint(
        '/lexon/session/issue',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({
            userId: z.uuid(),
            sourceSessionId: z.uuid(),
            expectedOrganizationId: z.uuid(),
            createdAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
            authenticatedAt: z.iso.datetime(),
            mfaVerifiedAt: z.iso.datetime().nullable(),
            reauthenticatedAt: z.iso.datetime().nullable(),
          }),
        },
        async (ctx) => {
          const input = ctx.body;
          await security.lock(input.userId, input.sourceSessionId);
          const source = await ctx.context.adapter.findOne<SessionRow>({
            model: 'session',
            where: [
              { field: 'id', value: input.sourceSessionId },
              { field: 'userId', value: input.userId },
            ],
          });
          if (
            !source ||
            source.channel !== 'cookie' ||
            source.activeOrganizationId !== input.expectedOrganizationId ||
            source.expiresAt <= new Date() ||
            source.authenticatedAt?.toISOString() !== input.authenticatedAt ||
            (source.mfaVerifiedAt?.toISOString() ?? null) !==
              input.mfaVerifiedAt ||
            (source.reauthenticatedAt?.toISOString() ?? null) !==
              input.reauthenticatedAt
          )
            throw new APIError('CONFLICT', { message: 'Session changed' });
          const session = await ctx.context.internalAdapter.createSession(
            input.userId,
            false,
            {
              createdAt: new Date(input.createdAt),
              expiresAt: new Date(input.expiresAt),
              activeOrganizationId: input.expectedOrganizationId,
            },
            true,
          );
          if (!session)
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Session unavailable',
            });
          await security.write({
            userId: input.userId,
            sessionId: session.id,
            expectedChannel: 'cookie',
            channel: 'bearer',
            hardExpiresAt: input.expiresAt,
            authenticatedAt: input.authenticatedAt,
            mfaVerifiedAt: input.mfaVerifiedAt,
            reauthenticatedAt: input.reauthenticatedAt,
            activeOrganizationId: input.expectedOrganizationId,
            pendingOrganizationId: null,
          });
          return {
            version: 1 as const,
            token: session.token,
            sessionId: session.id,
            expiresAt: input.expiresAt,
          };
        },
      ),
      lexonListOwnSessions: createAuthEndpoint(
        '/lexon/session/list',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({
            userId: z.uuid(),
            currentSessionId: z.uuid(),
          }),
        },
        async (ctx) => {
          const rows = await ctx.context.adapter.findMany<SessionRow>({
            model: 'session',
            where: [
              { field: 'userId', value: ctx.body.userId },
              { field: 'expiresAt', operator: 'gt', value: new Date() },
            ],
            sortBy: { field: 'createdAt', direction: 'desc' },
          });
          return rows
            .filter(
              (row) =>
                row.channel !== 'bearer' ||
                (row.hardExpiresAt && row.hardExpiresAt > new Date()),
            )
            .map((row) => ({
              version: 1 as const,
              id: row.id,
              channel: row.channel,
              createdAt: row.createdAt.toISOString(),
              expiresAt: row.expiresAt.toISOString(),
              current: row.id === ctx.body.currentSessionId,
            }));
        },
      ),
      lexonRevokeOwnSession: createAuthEndpoint(
        '/lexon/session/revoke',
        {
          method: 'POST',
          metadata: scope,
          body: z.strictObject({ userId: z.uuid(), sessionId: z.uuid() }),
        },
        async (ctx) => {
          await security.lock(ctx.body.userId, ctx.body.sessionId);
          const row = await ctx.context.adapter.findOne<SessionRow>({
            model: 'session',
            where: [
              { field: 'id', value: ctx.body.sessionId },
              { field: 'userId', value: ctx.body.userId },
            ],
          });
          if (!row) return { revoked: false };
          await ctx.context.internalAdapter.deleteSession(row.token);
          return { revoked: true };
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
