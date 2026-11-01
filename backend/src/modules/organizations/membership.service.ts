import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MemberSummarySchema,
  OrgKindSchema,
  OrgRoleSchema,
  PaginationSchema,
  UuidSchema,
  type MemberSummary,
  type OrgRole,
  type Pagination,
  type Page,
} from '@lexon/contracts';
import {
  OrganizationAuthPort,
  IdentityPolicy,
  IdentityError,
  type VerifiedIdentity,
} from '../identity-access/index.js';
import { appendAuthAudit } from '../audit/index.js';
import type { AuthCommandSession } from '../../infrastructure/db/index.js';
@Injectable()
export class MembershipService {
  private readonly policy = new IdentityPolicy();
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly config: {
      pagination: { defaultLimit: number; maxLimit: number };
    },
  ) {}
  private async facts(
    tx: AuthCommandSession,
    identity: VerifiedIdentity,
    organizationId: string,
    targetMemberId?: string,
  ) {
    UuidSchema.parse(organizationId);
    if (targetMemberId) UuidSchema.parse(targetMemberId);
    const facts = await tx.call('lexonOrganizationFacts', {
      body: {
        organizationId,
        actorUserId: identity.userId,
        ...(targetMemberId ? { targetMemberId } : {}),
      },
    });
    if (
      !facts.organization ||
      facts.organization.state !== 'active' ||
      !facts.actor
    )
      throw new IdentityError('ORG_FORBIDDEN', 403);
    this.policy.requireOrganizationMfa(
      facts.organization.require2fa,
      identity.mfaVerifiedAt,
    );
    return facts;
  }
  list(
    identity: VerifiedIdentity,
    organizationId: string,
    input: Partial<Pagination> = {},
  ): Promise<Page<MemberSummary>> {
    const page = PaginationSchema.parse({
      ...input,
      limit: input.limit ?? this.config.pagination.defaultLimit,
    });
    if (page.limit > this.config.pagination.maxLimit)
      throw new IdentityError('VALIDATION_ERROR', 400);
    return this.port.transaction(identity, async (tx, headers) => {
      const facts = await this.facts(tx, identity, organizationId);
      this.policy.require({
        action: 'read_members',
        kind: OrgKindSchema.parse(facts.organization!.kind),
        actorRole: OrgRoleSchema.parse(facts.actor!.role),
      });
      const result = await tx.call('listMembers', {
        headers,
        query: {
          organizationId,
          limit: page.limit + 1,
          sortBy: 'id',
          sortDirection: 'asc',
          ...(page.cursor
            ? {
                filterField: 'id',
                filterOperator: 'gt' as const,
                filterValue: page.cursor,
              }
            : {}),
        },
      });
      return {
        items: result.members.slice(0, page.limit).map((member) =>
          MemberSummarySchema.parse({
            version: 1,
            id: member.id,
            userId: member.userId,
            organizationId: member.organizationId,
            name: member.user.name,
            email: member.user.email,
            role: member.role,
            createdAt: member.createdAt.toISOString(),
          }),
        ),
        pageInfo: {
          nextCursor:
            result.members.length > page.limit
              ? result.members[page.limit - 1]!.id
              : null,
        },
      };
    });
  }
  changeRole(
    identity: VerifiedIdentity,
    organizationId: string,
    memberId: string,
    role: OrgRole,
  ): Promise<MemberSummary> {
    const resultingRole = OrgRoleSchema.parse(role);
    return this.port.transaction(identity, async (tx, headers) => {
      const facts = await this.facts(tx, identity, organizationId, memberId);
      const target = facts.target;
      if (!target) throw new IdentityError('ORG_FORBIDDEN', 403);
      this.policy.require({
        action: resultingRole === 'owner' ? 'promote_owner' : 'change_role',
        kind: OrgKindSchema.parse(facts.organization!.kind),
        actorRole: OrgRoleSchema.parse(facts.actor!.role),
        targetRole: OrgRoleSchema.parse(target.role),
      });
      if (
        target.role === 'owner' &&
        resultingRole !== 'owner' &&
        facts.ownerCount <= 1
      )
        throw new IdentityError('ORG_LAST_OWNER', 409);
      const updated = await tx.call('updateMemberRole', {
        headers,
        body: { organizationId, memberId, role: resultingRole },
      });
      if (target.role !== resultingRole)
        await appendAuthAudit(tx, {
          version: 1,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          type: 'organization.member_role_changed.v1',
          outcome: 'success',
          actorUserId: identity.userId,
          subjectUserId: target.userId,
          sessionId: identity.sessionId,
          orgId: organizationId,
          memberId,
          metadata: {
            previousRole: OrgRoleSchema.parse(target.role),
            role: resultingRole,
          },
        });
      const result = await tx.call('listMembers', {
        headers,
        query: {
          organizationId,
          limit: 1,
          filterField: 'id',
          filterOperator: 'eq',
          filterValue: memberId,
        },
      });
      const member = result.members[0];
      if (!member) throw new IdentityError('AUTH_UNAVAILABLE', 503);
      return MemberSummarySchema.parse({
        version: 1,
        id: updated.id,
        userId: updated.userId,
        organizationId: updated.organizationId,
        name: member.user.name,
        email: member.user.email,
        role: updated.role,
        createdAt: updated.createdAt.toISOString(),
      });
    });
  }
  remove(
    identity: VerifiedIdentity,
    organizationId: string,
    memberId: string,
  ): Promise<void> {
    return this.depart(identity, organizationId, 'remove', memberId);
  }
  leave(identity: VerifiedIdentity, organizationId: string): Promise<void> {
    return this.depart(identity, organizationId, 'leave');
  }
  private depart(
    identity: VerifiedIdentity,
    organizationId: string,
    reason: 'leave' | 'remove',
    memberId?: string,
  ): Promise<void> {
    return this.port.transaction(identity, async (tx, headers) => {
      const facts = await this.facts(tx, identity, organizationId, memberId);
      const target = reason === 'leave' ? facts.actor : facts.target;
      if (!target) throw new IdentityError('ORG_FORBIDDEN', 403);
      this.policy.require({
        action: reason === 'leave' ? 'leave' : 'remove_member',
        kind: OrgKindSchema.parse(facts.organization!.kind),
        actorRole: OrgRoleSchema.parse(facts.actor!.role),
        targetRole: OrgRoleSchema.parse(target.role),
      });
      if (target.role === 'owner' && facts.ownerCount <= 1)
        throw new IdentityError('ORG_LAST_OWNER', 409);
      if (reason === 'leave')
        await tx.call('leaveOrganization', {
          headers,
          body: { organizationId },
        });
      else
        await tx.call('removeMember', {
          headers,
          body: { organizationId, memberIdOrEmail: target.id },
        });
      await appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        type: 'organization.member_departed.v1',
        outcome: 'success',
        actorUserId: identity.userId,
        subjectUserId: target.userId,
        sessionId: identity.sessionId,
        orgId: organizationId,
        memberId: target.id,
        metadata: { reason },
      });
    });
  }
}
