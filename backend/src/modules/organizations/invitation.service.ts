import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  InvitationInputSchema,
  InvitationSummarySchema,
  OrganizationSummarySchema,
  OrgKindSchema,
  OrgRoleSchema,
  PaginationSchema,
  UuidSchema,
  type InvitationInput,
  type InvitationSummary,
  type Page,
  type Pagination,
  type SwitchResult,
} from '@lexon/contracts';
import type { AuthCommandSession } from '../../infrastructure/db/index.js';
import { appendAuthAudit } from '../audit/index.js';
import {
  IdentityError,
  IdentityPolicy,
  OrganizationAuthPort,
  type VerifiedIdentity,
  type OrganizationSelectionPort,
} from '../identity-access/index.js';
import {
  classifyInvitationAcceptance,
  roleForFirstAcceptance,
  invitationStatus,
} from './invitation-policy.js';
interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  purpose: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
}
interface Organization {
  id: string;
  name: string;
}
function summary(
  invitation: Invitation,
  organization: Organization,
): InvitationSummary {
  return InvitationSummarySchema.parse({
    version: 1,
    id: invitation.id,
    organizationId: invitation.organizationId,
    organizationName: organization.name,
    email: invitation.email,
    role: invitation.role,
    purpose: invitation.purpose,
    status: invitationStatus(invitation.status, invitation.expiresAt),
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  });
}
type InvitationAction =
  | 'created'
  | 'resent'
  | 'cancelled'
  | 'declined'
  | 'accepted'
  | 'expired_replaced';
@Injectable()
export class InvitationService {
  private readonly policy = new IdentityPolicy();
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly switching: OrganizationSelectionPort,
    private readonly config: {
      invitationSeconds: number;
      pagination: { defaultLimit: number; maxLimit: number };
    },
  ) {}
  private async audit(
    tx: AuthCommandSession,
    identity: VerifiedIdentity,
    invitation: Invitation,
    action: InvitationAction,
  ) {
    await appendAuthAudit(tx, {
      version: 1,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: 'organization.invitation_changed.v1',
      outcome: 'success',
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
      orgId: invitation.organizationId,
      invitationId: invitation.id,
      metadata: { action },
    });
  }
  private async facts(
    tx: AuthCommandSession,
    identity: VerifiedIdentity,
    input: { invitationId?: string; organizationId?: string; email?: string },
  ) {
    if (input.invitationId) UuidSchema.parse(input.invitationId);
    if (input.organizationId) UuidSchema.parse(input.organizationId);
    return tx.call('lexonInvitationFacts', {
      body: { actorUserId: identity.userId, ...input },
    });
  }
  private manager(
    identity: VerifiedIdentity,
    facts: Awaited<ReturnType<InvitationService['facts']>>,
    action: 'read_invitations' | 'invite_member' | 'invite_admin',
  ) {
    if (!facts.organization || facts.organization.state !== 'active')
      throw new IdentityError('ORG_FORBIDDEN', 403);
    this.policy.require({
      action,
      kind: OrgKindSchema.parse(facts.organization.kind),
      actorRole: facts.member ? OrgRoleSchema.parse(facts.member.role) : null,
    });
    this.policy.requireOrganizationMfa(
      facts.organization.require2fa,
      identity.mfaVerifiedAt,
    );
    return facts.organization;
  }
  private pagination(input: Partial<Pagination>) {
    const page = PaginationSchema.parse({
      ...input,
      limit: input.limit ?? this.config.pagination.defaultLimit,
    });
    if (page.limit > this.config.pagination.maxLimit)
      throw new IdentityError('VALIDATION_ERROR', 400);
    return page;
  }
  private async createInTransaction(
    tx: AuthCommandSession,
    headers: Headers,
    identity: VerifiedIdentity,
    organizationId: string,
    input: InvitationInput,
  ) {
    const facts = await this.facts(tx, identity, {
      organizationId,
      email: input.email,
    });
    const organization = this.manager(
      identity,
      facts,
      input.role === 'admin' ? 'invite_admin' : 'invite_member',
    );
    if (facts.pending && facts.pending.expiresAt > new Date())
      return summary(facts.pending, organization);
    if (facts.pending) {
      await tx.call('cancelInvitation', {
        headers,
        body: { invitationId: facts.pending.id },
      });
      await this.audit(tx, identity, facts.pending, 'expired_replaced');
    }
    let invitation: Invitation;
    if (facts.recipientMember) {
      invitation = await tx.call('lexonCreateExistingMemberInvitation', {
        body: {
          organizationId,
          email: input.email,
          role: input.role,
          inviterId: identity.userId,
          expectedMemberId: facts.recipientMember.id,
          expiresAt: new Date(
            Date.now() + this.config.invitationSeconds * 1000,
          ).toISOString(),
        },
      });
      await tx.call('lexonDeliverInvitation', {
        body: { invitationId: invitation.id },
      });
    } else
      invitation = await tx.call('createInvitation', {
        headers,
        body: {
          organizationId,
          email: input.email,
          role: input.role,
          purpose: 'team',
        },
      });
    if (facts.pending)
      await tx.call('lexonInvitationMetadata', {
        body: {
          invitationId: facts.pending.id,
          expectedStatus: 'canceled',
          replacedByInvitationId: invitation.id,
        },
      });
    await tx.call('lexonInvitationMetadata', {
      body: {
        invitationId: invitation.id,
        expectedStatus: 'pending',
        lastSentAt: new Date().toISOString(),
      },
    });
    await this.audit(tx, identity, invitation, 'created');
    return summary(invitation, organization);
  }
  create(
    identity: VerifiedIdentity,
    organizationId: string,
    input: InvitationInput,
  ): Promise<InvitationSummary> {
    const body = InvitationInputSchema.parse(input);
    UuidSchema.parse(organizationId);
    return this.port.transaction(identity, (tx, headers) =>
      this.createInTransaction(tx, headers, identity, organizationId, body),
    );
  }
  listForOrganization(
    identity: VerifiedIdentity,
    organizationId: string,
    input: Partial<Pagination> = {},
  ): Promise<Page<InvitationSummary>> {
    const page = this.pagination(input);
    return this.port.transaction(identity, async (tx) => {
      const facts = await this.facts(tx, identity, { organizationId });
      this.manager(identity, facts, 'read_invitations');
      const rows = await tx.call('lexonListInvitationFacts', {
        body: {
          organizationId,
          limit: page.limit + 1,
          ...(page.cursor ? { cursor: page.cursor } : {}),
        },
      });
      return {
        items: rows
          .slice(0, page.limit)
          .map((row) => summary(row.invitation, row.organization!)),
        pageInfo: {
          nextCursor:
            rows.length > page.limit
              ? rows[page.limit - 1]!.invitation.id
              : null,
        },
      };
    });
  }
  listMine(
    identity: VerifiedIdentity,
    input: Partial<Pagination> = {},
  ): Promise<Page<InvitationSummary>> {
    const page = this.pagination(input);
    return this.port.transaction(identity, async (tx) => {
      const facts = await this.facts(tx, identity, {});
      if (!facts.user?.emailVerified)
        throw new IdentityError('AUTH_EMAIL_VERIFICATION_REQUIRED', 403);
      const rows = await tx.call('lexonListInvitationFacts', {
        body: {
          email: facts.user.email,
          limit: page.limit + 1,
          ...(page.cursor ? { cursor: page.cursor } : {}),
        },
      });
      return {
        items: rows
          .slice(0, page.limit)
          .filter(
            (row) => row.organization && row.invitation.expiresAt > new Date(),
          )
          .map((row) => summary(row.invitation, row.organization!)),
        pageInfo: {
          nextCursor:
            rows.length > page.limit
              ? rows[page.limit - 1]!.invitation.id
              : null,
        },
      };
    });
  }
  resend(
    identity: VerifiedIdentity,
    invitationId: string,
  ): Promise<InvitationSummary> {
    return this.port.transaction(identity, async (tx, headers) => {
      const facts = await this.facts(tx, identity, { invitationId });
      const row = facts.invitation;
      if (!row || row.status !== 'pending' || row.purpose !== 'team')
        throw new IdentityError('ORG_FORBIDDEN', 403);
      const organization = this.manager(
        identity,
        facts,
        row.role === 'admin' ? 'invite_admin' : 'invite_member',
      );
      if (row.expiresAt <= new Date())
        return this.createInTransaction(
          tx,
          headers,
          identity,
          row.organizationId,
          InvitationInputSchema.parse({ email: row.email, role: row.role }),
        );
      await tx.call('lexonDeliverInvitation', { body: { invitationId } });
      await tx.call('lexonInvitationMetadata', {
        body: {
          invitationId,
          expectedStatus: 'pending',
          lastSentAt: new Date().toISOString(),
        },
      });
      await this.audit(tx, identity, row, 'resent');
      return summary(row, organization);
    });
  }
  cancel(
    identity: VerifiedIdentity,
    invitationId: string,
  ): Promise<InvitationSummary> {
    return this.port.transaction(identity, async (tx, headers) => {
      const facts = await this.facts(tx, identity, { invitationId });
      const row = facts.invitation;
      if (!row || row.status !== 'pending' || row.purpose !== 'team')
        throw new IdentityError('ORG_FORBIDDEN', 403);
      const organization = this.manager(
        identity,
        facts,
        row.role === 'admin' ? 'invite_admin' : 'invite_member',
      );
      await tx.call('cancelInvitation', { headers, body: { invitationId } });
      await this.audit(tx, identity, row, 'cancelled');
      return summary({ ...row, status: 'canceled' }, organization);
    });
  }
  decline(
    identity: VerifiedIdentity,
    invitationId: string,
  ): Promise<InvitationSummary> {
    return this.port.transaction(identity, async (tx, headers) => {
      const facts = await this.facts(tx, identity, { invitationId });
      const row = facts.invitation;
      if (
        !row ||
        !facts.organization ||
        !facts.user?.emailVerified ||
        row.status !== 'pending' ||
        row.expiresAt <= new Date() ||
        row.email !== facts.user.email
      )
        throw new IdentityError('ORG_FORBIDDEN', 403);
      await tx.call('rejectInvitation', { headers, body: { invitationId } });
      await this.audit(tx, identity, row, 'declined');
      return summary({ ...row, status: 'rejected' }, facts.organization);
    });
  }
  accept(
    identity: VerifiedIdentity,
    invitationId: string,
  ): Promise<{ invitation: InvitationSummary; selection: SwitchResult }> {
    return this.port.transaction(identity, async (tx, headers) => {
      const facts = await this.facts(tx, identity, { invitationId });
      const row = facts.invitation;
      const org = facts.organization;
      const user = facts.user;
      if (
        !row ||
        !org ||
        !user?.emailVerified ||
        user.role === 'admin' ||
        identity.platformAdmin
      )
        throw new IdentityError('ORG_FORBIDDEN', 403);
      const classification = classifyInvitationAcceptance({
        status: row.status,
        expired: row.expiresAt <= new Date(),
        acceptedByUserId: row.acceptedByUserId,
        actorUserId: identity.userId,
        hasMembership: !!facts.member,
      });
      if (
        classification === 'deny' ||
        (classification === 'first' && row.email !== user.email)
      )
        throw new IdentityError('ORG_FORBIDDEN', 403);
      const provisioning =
        org.state === 'provisioning' &&
        row.purpose === 'first_owner' &&
        row.role === 'owner' &&
        !facts.member;
      if (
        !provisioning &&
        (org.state !== 'active' ||
          org.kind !== 'team' ||
          (row.purpose !== 'team' &&
            !(classification === 'retry' && row.purpose === 'first_owner')))
      )
        throw new IdentityError('ORG_FORBIDDEN', 403);
      const current = facts.member
        ? OrgRoleSchema.parse(facts.member.role)
        : null;
      const role =
        classification === 'retry'
          ? current!
          : roleForFirstAcceptance(current, OrgRoleSchema.parse(row.role));
      const accepted = await tx.call('lexonAcceptInvitation', {
        body: {
          invitationId,
          actorUserId: identity.userId,
          expectedEmail: user.email,
          expectedStatus: row.status,
          expectedAcceptedByUserId: row.acceptedByUserId,
          expectedMemberId: facts.member?.id ?? null,
          expectedMemberRole: current,
          resultingRole: role,
          acceptanceAction:
            classification === 'retry'
              ? 'retry'
              : facts.member
                ? 'update'
                : 'join',
          activateOrganization: provisioning,
        },
      });
      if (!accepted.invitation)
        throw new IdentityError('AUTH_UNAVAILABLE', 503);
      if (classification === 'first') {
        await this.audit(tx, identity, row, 'accepted');
        return {
          invitation: summary(accepted.invitation, org),
          selection: await this.switching.select(identity, org.id),
        };
      }
      const session = await tx.call('getSession', {
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!session) throw new IdentityError('AUTH_REQUIRED', 401);
      const selection = await tx.call('lexonSelectionFacts', {
        body: { userId: identity.userId, sessionId: identity.sessionId },
      });
      if (!selection.selected || !selection.selectedMember)
        throw new IdentityError('AUTH_UNAVAILABLE', 503);
      const active = OrganizationSummarySchema.parse({
        version: 1,
        id: selection.selected.id,
        name: selection.selected.name,
        slug: selection.selected.slug,
        kind: selection.selected.kind,
        state: selection.selected.state,
        require2fa: selection.selected.require2fa,
        role: selection.selectedMember.role,
        createdAt: selection.selected.createdAt.toISOString(),
      });
      return {
        invitation: summary(accepted.invitation, org),
        selection: selection.session?.pendingOrganizationId
          ? {
              status: 'enrollment_required',
              organization: active,
              pendingOrganizationId: selection.session.pendingOrganizationId,
            }
          : { status: 'switched', organization: active },
      };
    });
  }
}
