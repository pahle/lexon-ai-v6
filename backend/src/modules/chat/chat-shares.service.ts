import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ChatShareSummarySchema,
  ShareAddInputSchema,
  type ChatShareSummary,
} from '@lexon/contracts';
import {
  ChatRepository,
  pgFailure,
  TenantDatabase,
  type TenantSession,
} from '../../infrastructure/db/index.js';
import { AuditService } from '../audit/index.js';
import {
  IdentityError,
  OrganizationAuthPort,
  type TenantRequestContext,
  type VerifiedIdentity,
} from '../identity-access/index.js';

const notFound = () => new IdentityError('NOT_FOUND', 404);
const forbidden = () => new IdentityError('ORG_FORBIDDEN', 403);
const invalid = () => new IdentityError('VALIDATION_ERROR', 422);

/**
 * F6 task 7 — standalone-chat sharing. Owner-only grants to org members on
 * chats with `project_id IS NULL`; recipients get read-level access through
 * the 0043 predicate arm, so recipient view, revoke and org-leave need no
 * extra machinery here. The `chat_shares_owner_insert` WITH CHECK is the
 * backstop (org-member target + caller-owned standalone chat) — a 42501 is
 * the target-invalid signal (422), distinct from the caller's 403/404.
 */
@Injectable()
export class ChatSharesService {
  private readonly chats = new ChatRepository();
  private readonly audit = new AuditService();

  constructor(
    private readonly database: TenantDatabase,
    private readonly port: OrganizationAuthPort,
  ) {}

  /** Owner-only gate shared by all three verbs: an invisible/nonexistent
   * chat is a 404; a chat the caller can merely read (share recipient) is a
   * 403, matching the projects owner-write convention. */
  private async requireOwned(
    tx: TenantSession,
    ctx: TenantRequestContext,
    chatId: string,
  ) {
    const chat = await this.chats.readLive(tx, chatId);
    if (!chat) throw notFound();
    if (chat.ownerUserId !== ctx.userId) throw forbidden();
    return chat;
  }

  private async directory(identity: VerifiedIdentity, orgId: string) {
    const entries = new Map<string, { name: string; email: string }>();
    await this.port.transaction(identity, async (tx, headers) => {
      let cursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const result = await tx.call('listMembers', {
          headers,
          query: {
            organizationId: orgId,
            limit: 100,
            sortBy: 'id',
            sortDirection: 'asc',
            ...(cursor
              ? {
                  filterField: 'id',
                  filterOperator: 'gt' as const,
                  filterValue: cursor,
                }
              : {}),
          },
        });
        for (const member of result.members)
          entries.set(member.userId, {
            name: member.user.name,
            email: member.user.email,
          });
        if (result.members.length < 100) return;
        cursor = result.members.at(-1)!.id;
      }
    });
    return entries;
  }

  async list(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    chatId: string,
  ): Promise<ChatShareSummary[]> {
    const rows = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        await this.requireOwned(tx, ctx, chatId);
        return this.chats.listShares(tx, chatId);
      },
    );
    const directory = await this.directory(identity, ctx.orgId);
    return rows.map((row) =>
      ChatShareSummarySchema.parse({
        version: 1,
        userId: row.user_id,
        name: directory.get(row.user_id)?.name ?? '',
        email: directory.get(row.user_id)?.email ?? '',
        grantedByUserId: row.granted_by_user_id,
        createdAt: row.created_at.toISOString(),
      }),
    );
  }

  async add(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    chatId: string,
    input: unknown,
  ): Promise<ChatShareSummary[]> {
    const rows = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const chat = await this.requireOwned(tx, ctx, chatId);
        const body = ShareAddInputSchema.parse(input);
        if (chat.projectId !== null) throw invalid();
        try {
          await this.chats.addShares(tx, chatId, body.userIds);
        } catch (error) {
          if (pgFailure(error).code === '42501') throw invalid();
          throw error;
        }
        for (const userId of body.userIds)
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            type: 'chat.shared.v1',
            outcome: 'success',
            orgId: ctx.orgId,
            actorUserId: ctx.userId,
            subjectUserId: userId,
            metadata: { chatId },
          });
        await this.chats.notifyAccessChanged(tx, {
          chatId,
          userIds: body.userIds,
        });
        return this.chats.listShares(tx, chatId);
      },
    );
    const directory = await this.directory(identity, ctx.orgId);
    return rows.map((row) =>
      ChatShareSummarySchema.parse({
        version: 1,
        userId: row.user_id,
        name: directory.get(row.user_id)?.name ?? '',
        email: directory.get(row.user_id)?.email ?? '',
        grantedByUserId: row.granted_by_user_id,
        createdAt: row.created_at.toISOString(),
      }),
    );
  }

  async revoke(
    ctx: TenantRequestContext,
    chatId: string,
    userId: string,
  ): Promise<void> {
    await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        await this.requireOwned(tx, ctx, chatId);
        const removed = await this.chats.revokeShare(tx, chatId, userId);
        if (!removed) throw notFound();
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'chat.share_revoked.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          subjectUserId: userId,
          metadata: { chatId },
        });
        await this.chats.notifyAccessChanged(tx, {
          chatId: null,
          userIds: [userId],
        });
      },
    );
  }
}
