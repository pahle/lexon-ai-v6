import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  DenyAddInputSchema,
  DenySummarySchema,
  MattersListQuerySchema,
  MemberAddInputSchema,
  MemberRoleInputSchema,
  OrgMemberSearchQuerySchema,
  OrgMemberSearchResultSchema,
  OrgMemberSummarySchema,
  OrgProjectSummarySchema,
  OrgProjectsQuerySchema,
  ProjectCreateInputSchema,
  ProjectInstructionsInputSchema,
  ProjectMemberSummarySchema,
  ProjectPageSchema,
  ProjectSettingsInputSchema,
  type DenySummary,
  type OrgMemberSummary,
  type OrgProjectSummary,
  type ProjectMemberSummary,
  type ProjectPage,
  type ProjectSummary,
} from '@lexon/contracts';
import {
  ChatRepository,
  chatCleanupJobId,
  OutboxRepository,
  pgFailure,
  ProjectRepository,
  TenantDatabase,
  type ProjectMemberRow,
  type ProjectView,
  type TenantSession,
} from '../../infrastructure/db/index.js';
import { AuditService } from '../audit/index.js';
import type { DeletionSignalPublisher } from '../chat/index.js';
import {
  IdentityError,
  OrganizationAuthPort,
  type TenantRequestContext,
  type VerifiedIdentity,
} from '../identity-access/index.js';

interface MemberDirectoryEntry {
  memberId: string;
  name: string;
  email: string;
  role: 'member' | 'admin' | 'owner';
}

const notFound = () => new IdentityError('NOT_FOUND', 404);
const forbidden = () => new IdentityError('ORG_FORBIDDEN', 403);
const invalid = () => new IdentityError('VALIDATION_ERROR', 422);

function summary(view: ProjectView, ownerName: string): ProjectSummary {
  return {
    version: 1,
    id: view.id,
    name: view.name,
    matterNumber: view.matterNumber,
    practiceArea: view.practiceArea,
    owner: { userId: view.ownerUserId, name: ownerName },
    myRole: view.access === 'none' ? 'viewer' : view.access,
    memberCount: view.memberCount,
    chatCount: view.chatCount,
    lastActivityAt: view.lastActivityAt.toISOString(),
    createdAt: view.createdAt.toISOString(),
  };
}

function memberSummary(
  row: ProjectMemberRow,
  entry: MemberDirectoryEntry | undefined,
): ProjectMemberSummary {
  return ProjectMemberSummarySchema.parse({
    version: 1,
    memberId: row.user_id,
    userId: row.user_id,
    name: entry?.name ?? '',
    email: entry?.email ?? '',
    role: row.role,
    createdAt: row.created_at.toISOString(),
  });
}

function rlsRefusal(error: unknown): boolean {
  return pgFailure(error).code === '42501';
}

function encodeCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify([1, key, id]), 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { key: string; id: string } {
  try {
    const parsed = z
      .tuple([z.literal(1), z.string().min(1).max(256), z.uuid()])
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { key: parsed[1], id: parsed[2] };
  } catch {
    throw invalid();
  }
}

/**
 * F6 task 5 — Matters. The 0043 policies do the access math: reads ask the
 * claim-bound `ops.lexon_project_access` arm, so invisible, nonexistent and
 * denied collapse into the same null → the identical-404 contract. Owner-only
 * writes check the level after the visible read; instructions allow
 * owner+editor. Member writes lean on the policy WITH CHECK for the
 * org-member/not-denied gates — a 42501 refusal is the target-invalid signal
 * (422), distinct from the caller's 403/404. Every mutation appends its audit
 * and emits `notifyAccessChanged` inside the same tenant transaction.
 */
@Injectable()
export class ProjectService {
  private readonly projects = new ProjectRepository();
  private readonly chats = new ChatRepository();
  private readonly audit = new AuditService();
  private readonly outbox = new OutboxRepository();

  constructor(
    private readonly database: TenantDatabase,
    private readonly port: OrganizationAuthPort,
    private readonly config: {
      pagination: { defaultLimit: number; maxLimit: number };
      deleteGraceMs?: number;
    },
    private readonly deletionSignals?: DeletionSignalPublisher,
    private readonly deletionEvents?: {
      closeRun(runId: string): Promise<void>;
    },
  ) {}

  /** Display names and emails live behind the Better Auth port — a separate
   * transaction from the tenant one, so resolution is a response-shaping
   * step, never an access gate. */
  private async directory(
    identity: VerifiedIdentity,
    orgId: string,
  ): Promise<Map<string, MemberDirectoryEntry>> {
    const entries = new Map<string, MemberDirectoryEntry>();
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
            memberId: member.id,
            name: member.user.name,
            email: member.user.email,
            role: member.role as MemberDirectoryEntry['role'],
          });
        if (result.members.length < 100) return;
        cursor = result.members.at(-1)!.id;
      }
    });
    return entries;
  }

  private async requireView(
    tx: TenantSession,
    projectId: string,
  ): Promise<ProjectView> {
    const view = await this.projects.find(tx, projectId);
    if (!view || view.access === 'none') throw notFound();
    return view;
  }

  async create(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    input: unknown,
  ): Promise<ProjectSummary> {
    const body = ProjectCreateInputSchema.parse(input);
    const directory = await this.directory(identity, ctx.orgId);
    return this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const view = await this.projects.insert(tx, {
          id: randomUUID(),
          name: body.name,
          ...(body.matterNumber !== undefined
            ? { matterNumber: body.matterNumber }
            : {}),
          ...(body.practiceArea !== undefined
            ? { practiceArea: body.practiceArea }
            : {}),
        });
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'project.created.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          metadata: { projectId: view.id },
        });
        return summary(view, directory.get(ctx.userId)?.name ?? '');
      },
    );
  }

  async list(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    query: unknown,
  ): Promise<ProjectPage> {
    const parsed = MattersListQuerySchema.parse(query);
    const limit = Math.min(
      parsed.limit ?? this.config.pagination.defaultLimit,
      this.config.pagination.maxLimit,
    );
    const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : null;
    const rows = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      (tx) =>
        this.projects.list(tx, {
          filter: parsed.filter,
          sort: parsed.sort,
          cursor,
          limit: limit + 1,
        }),
    );
    const pageRows = rows.slice(0, limit);
    const directory = await this.directory(identity, ctx.orgId);
    const last = pageRows.at(-1);
    return ProjectPageSchema.parse({
      items: pageRows.map((row) =>
        summary(row, directory.get(row.ownerUserId)?.name ?? ''),
      ),
      pageInfo: {
        nextCursor:
          rows.length > limit && last
            ? encodeCursor(
                parsed.sort === 'name'
                  ? last.name
                  : last.lastActivityAt.toISOString(),
                last.id,
              )
            : null,
      },
    });
  }

  async detail(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    projectId: string,
  ): Promise<ProjectSummary & { instructions: string | null }> {
    const directory = await this.directory(identity, ctx.orgId);
    const view = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      (tx) => this.requireView(tx, projectId),
    );
    return {
      ...summary(view, directory.get(view.ownerUserId)?.name ?? ''),
      instructions: view.instructions,
    };
  }

  async updateSettings(
    ctx: TenantRequestContext,
    projectId: string,
    input: unknown,
  ): Promise<ProjectSummary & { instructions: string | null }> {
    return this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        // Visibility precedes validation: a denied member's malformed write
        // still owes the identical 404, not a 400 leak.
        const view = await this.requireView(tx, projectId);
        const body = ProjectSettingsInputSchema.parse(input);
        if (view.access !== 'owner') throw forbidden();
        const fields = (
          ['name', 'matterNumber', 'practiceArea'] as const
        ).filter((field) => body[field] !== undefined);
        const updated = await this.projects.updateSettings(tx, projectId, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.matterNumber !== undefined
            ? { matterNumber: body.matterNumber }
            : {}),
          ...(body.practiceArea !== undefined
            ? { practiceArea: body.practiceArea }
            : {}),
        });
        if (!updated) throw notFound();
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'project.settings_changed.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          metadata: { projectId, fields },
        });
        return { ...summary(updated, ''), instructions: view.instructions };
      },
    );
  }

  async updateInstructions(
    ctx: TenantRequestContext,
    projectId: string,
    input: unknown,
  ): Promise<{ instructions: string | null }> {
    return this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const view = await this.requireView(tx, projectId);
        const body = ProjectInstructionsInputSchema.parse(input);
        if (view.access !== 'owner' && view.access !== 'editor')
          throw forbidden();
        await this.projects.setInstructions(tx, projectId, body.instructions);
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'project.instructions_changed.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          metadata: {
            projectId,
            action: body.instructions === null ? 'cleared' : 'set',
          },
        });
        return { instructions: body.instructions };
      },
    );
  }

  async listChats(
    ctx: TenantRequestContext,
    projectId: string,
  ): Promise<{ items: { id: string; title: string; updatedAt: string }[] }> {
    return this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        await this.requireView(tx, projectId);
        const rows = await this.projects.listChats(tx, projectId);
        return {
          items: rows.map((row) => ({
            id: row.id,
            title: row.title || 'New chat',
            updatedAt: row.updated_at.toISOString(),
          })),
        };
      },
    );
  }

  async listMembers(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    projectId: string,
  ): Promise<{ items: ProjectMemberSummary[] }> {
    const rows = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        await this.requireView(tx, projectId);
        return this.projects.listMembers(tx, projectId);
      },
    );
    const directory = await this.directory(identity, ctx.orgId);
    return {
      items: rows.map((row) => memberSummary(row, directory.get(row.user_id))),
    };
  }

  async addMember(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    projectId: string,
    input: unknown,
  ): Promise<ProjectMemberSummary> {
    const row = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const view = await this.requireView(tx, projectId);
        const body = MemberAddInputSchema.parse(input);
        if (view.access !== 'owner') throw forbidden();
        if (body.userId === view.ownerUserId) throw invalid();
        let added: ProjectMemberRow;
        try {
          added = await this.projects.addMember(tx, projectId, {
            userId: body.userId,
            role: body.role,
          });
        } catch (error) {
          // The member-insert WITH CHECK refuses non-org-members and denied
          // targets — the only client-meaningful refusal left after the
          // owner gate above.
          if (rlsRefusal(error)) throw invalid();
          throw error;
        }
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'project.member_added.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          subjectUserId: body.userId,
          memberId: body.userId,
          metadata: { projectId, role: added.role },
        });
        await this.chats.notifyAccessChanged(tx, {
          chatId: null,
          userIds: [body.userId],
        });
        return added;
      },
    );
    const directory = await this.directory(identity, ctx.orgId);
    return memberSummary(row, directory.get(row.user_id));
  }

  async updateMemberRole(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    projectId: string,
    userId: string,
    input: unknown,
  ): Promise<ProjectMemberSummary> {
    const row = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const view = await this.requireView(tx, projectId);
        const body = MemberRoleInputSchema.parse(input);
        if (view.access !== 'owner') throw forbidden();
        const member = await this.projects.member(tx, projectId, userId);
        if (!member) throw notFound();
        const updated = await this.projects.updateMemberRole(
          tx,
          projectId,
          userId,
          body.role,
        );
        if (!updated) throw notFound();
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'project.member_role_changed.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          subjectUserId: userId,
          memberId: userId,
          metadata: {
            projectId,
            previousRole: member.role,
            role: body.role,
          },
        });
        await this.chats.notifyAccessChanged(tx, {
          chatId: null,
          userIds: [userId],
        });
        return updated;
      },
    );
    const directory = await this.directory(identity, ctx.orgId);
    return memberSummary(row, directory.get(userId));
  }

  async removeMember(
    ctx: TenantRequestContext,
    projectId: string,
    userId: string,
  ): Promise<void> {
    await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const view = await this.requireView(tx, projectId);
        if (view.access !== 'owner') throw forbidden();
        const removed = await this.projects.removeMember(tx, projectId, userId);
        if (!removed) throw notFound();
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'project.member_removed.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          subjectUserId: userId,
          memberId: userId,
          metadata: { projectId },
        });
        await this.chats.notifyAccessChanged(tx, {
          chatId: null,
          userIds: [userId],
        });
      },
    );
  }

  /** Org owner/admin metadata list — deny beats admin, so a denied admin's
   * own row is absent (the projects SELECT policy does the filtering). */
  async listOrgProjects(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    query: unknown,
  ): Promise<{
    items: OrgProjectSummary[];
    pageInfo: { nextCursor: string | null };
  }> {
    const parsed = OrgProjectsQuerySchema.parse(query);
    const limit = Math.min(
      parsed.limit ?? this.config.pagination.defaultLimit,
      this.config.pagination.maxLimit,
    );
    const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : null;
    const rows = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        if (!(await this.projects.isOrgOwnerAdmin(tx))) throw forbidden();
        return this.projects.orgList(tx, {
          ...(parsed.q !== undefined ? { q: parsed.q } : {}),
          cursor,
          limit: limit + 1,
        });
      },
    );
    const pageRows = rows.slice(0, limit);
    const directory = await this.directory(identity, ctx.orgId);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) =>
        OrgProjectSummarySchema.parse({
          version: 1,
          id: row.id,
          name: row.name,
          matterNumber: row.matterNumber,
          practiceArea: row.practiceArea,
          owner: {
            userId: row.ownerUserId,
            name: directory.get(row.ownerUserId)?.name ?? '',
          },
          memberCount: row.memberCount,
          chatCount: row.chatCount,
          restrictedCount: row.restrictedCount,
          lastActivityAt: row.lastActivityAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        }),
      ),
      pageInfo: {
        nextCursor:
          rows.length > limit && last ? encodeCursor(last.name, last.id) : null,
      },
    };
  }

  async listDenies(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    projectId: string,
  ): Promise<{ items: DenySummary[] }> {
    const rows = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        if (!(await this.projects.isOrgOwnerAdmin(tx))) throw forbidden();
        return this.projects.listDenies(tx, projectId);
      },
    );
    const directory = await this.directory(identity, ctx.orgId);
    return {
      items: rows.map((row) =>
        DenySummarySchema.parse({
          version: 1,
          userId: row.user_id,
          name: directory.get(row.user_id)?.name ?? '',
          email: directory.get(row.user_id)?.email ?? '',
          setByUserId: row.set_by_user_id,
          createdAt: row.created_at.toISOString(),
        }),
      ),
    };
  }

  /** Deny-add: the definer is claims-bound (actor = session user) and owns
   * the member-row removal + notify. Its result reports removedMember —
   * admins cannot see project_members under the access-select policy, so a
   * removed member earns a second audit, member_removed with reason 'deny'. */
  async addDeny(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    projectId: string,
    input: unknown,
  ): Promise<DenySummary> {
    const row = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        if (!(await this.projects.isOrgOwnerAdmin(tx))) throw forbidden();
        const body = DenyAddInputSchema.parse(input);
        let added: { denied: boolean; removedMember: boolean };
        try {
          added = await this.projects.denyAdd(tx, projectId, body.userId);
        } catch (error) {
          const failure = pgFailure(error);
          if (failure.constraint === 'project_owner_deny') throw invalid();
          if (rlsRefusal(error)) throw notFound();
          throw error;
        }
        // deny_added (and member_removed reason=deny) describe the row
        // going in — a repeated deny reports denied=false and writes no
        // second audit.
        if (added.denied) {
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            type: 'project.deny_added.v1',
            outcome: 'success',
            orgId: ctx.orgId,
            actorUserId: ctx.userId,
            subjectUserId: body.userId,
            metadata: { projectId, setByUserId: ctx.userId },
          });
          if (added.removedMember)
            await this.audit.append(tx, {
              version: 1,
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),
              type: 'project.member_removed.v1',
              outcome: 'success',
              orgId: ctx.orgId,
              actorUserId: ctx.userId,
              subjectUserId: body.userId,
              memberId: body.userId,
              metadata: { projectId, reason: 'deny' },
            });
        }
        if (added.denied)
          return {
            user_id: body.userId,
            set_by_user_id: ctx.userId,
            created_at: new Date(),
          };
        const existing = (await this.projects.listDenies(tx, projectId)).find(
          (row) => row.user_id === body.userId,
        );
        if (!existing) throw notFound();
        return existing;
      },
    );
    const directory = await this.directory(identity, ctx.orgId);
    return DenySummarySchema.parse({
      version: 1,
      userId: row.user_id,
      name: directory.get(row.user_id)?.name ?? '',
      email: directory.get(row.user_id)?.email ?? '',
      setByUserId: row.set_by_user_id,
      createdAt: row.created_at.toISOString(),
    });
  }

  async liftDeny(
    ctx: TenantRequestContext,
    projectId: string,
    userId: string,
  ): Promise<void> {
    await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        if (!(await this.projects.isOrgOwnerAdmin(tx))) throw forbidden();
        const existing = (await this.projects.listDenies(tx, projectId)).find(
          (row) => row.user_id === userId,
        );
        try {
          const lifted = await this.projects.denyLift(tx, projectId, userId);
          if (!lifted) throw notFound();
        } catch (error) {
          if (pgFailure(error).constraint === 'project_deny_self_lift')
            throw invalid();
          if (rlsRefusal(error)) throw notFound();
          throw error;
        }
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'project.deny_lifted.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          subjectUserId: userId,
          metadata: {
            projectId,
            setByUserId: existing?.set_by_user_id ?? ctx.userId,
          },
        });
      },
    );
  }

  async searchOrgMembers(
    ctx: TenantRequestContext,
    identity: VerifiedIdentity,
    query: unknown,
  ): Promise<{ items: OrgMemberSummary[] }> {
    const q = OrgMemberSearchQuerySchema.parse(query);
    const directory = await this.directory(identity, ctx.orgId);
    const needle = q.q.toLowerCase();
    const items = [...directory.entries()]
      .filter(
        ([, entry]) =>
          entry.name.toLowerCase().includes(needle) ||
          entry.email.toLowerCase().includes(needle),
      )
      .slice(0, q.limit ?? 20)
      .map(([userId, entry]) =>
        OrgMemberSummarySchema.parse({
          version: 1,
          userId,
          name: entry.name,
          email: entry.email,
          role: entry.role,
        }),
      );
    return OrgMemberSearchResultSchema.parse({ items });
  }

  /** Project deletion (F6 §8): the 0049 definer tombstones every project
   * chat with its deletion-work row and per-run notifies, fences live runs
   * and cascades the projects row away — the owner claim is checked inside
   * the function, so a non-owner can never drive it. The confirmation
   * contract is the live `chatCount`; a mismatch is a 422, never a partial
   * delete. Post-commit signals mirror F4 single-chat delete: one
   * chat.cleanup.v1 outbox per chat plus the run fan-out the sweep needs. */
  async remove(
    ctx: TenantRequestContext,
    projectId: string,
    input: unknown,
  ): Promise<void> {
    const graceMs = this.config.deleteGraceMs;
    if (!graceMs || !Number.isSafeInteger(graceMs) || graceMs < 1)
      throw new IdentityError('INTERNAL_ERROR', 500);
    const work = await this.database.withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const view = await this.requireView(tx, projectId);
        if (view.access !== 'owner') throw forbidden();
        const body = z
          .strictObject({ chatCount: z.number().int().nonnegative().safe() })
          .parse(input ?? {});
        if (body.chatCount !== view.chatCount) throw invalid();
        const deleted = await this.projects.projectDelete(
          tx,
          projectId,
          graceMs,
        );
        if (!deleted) throw forbidden();
        for (const chat of deleted.chats)
          await this.outbox.append(
            tx,
            {
              type: 'chat.cleanup.v1',
              ctx: { orgId: ctx.orgId, userId: ctx.userId },
              payload: { chatId: chat.chatId, phase: 'grace' },
            },
            { id: chatCleanupJobId(chat.chatId, 'grace') },
          );
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'project.deleted.v1',
          outcome: 'success',
          orgId: ctx.orgId,
          actorUserId: ctx.userId,
          metadata: { projectId, chatCount: deleted.chatCount },
        });
        return deleted;
      },
    );
    const runIds = work.chats.flatMap((chat) => chat.runIds);
    await Promise.all(
      runIds.map((runId) => this.deletionEvents?.closeRun(runId)),
    );
    await Promise.all(
      runIds.map(async (runId) => {
        await this.deletionSignals
          ?.publishDeletion?.(runId)
          .catch(() => undefined);
        await this.deletionSignals?.publish(runId).catch(() => undefined);
      }),
    );
  }
}
