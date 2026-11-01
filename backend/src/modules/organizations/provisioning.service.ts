import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ProvisioningInputSchema,
  ProvisioningSummarySchema,
  EmailAddressSchema,
  PaginationSchema,
  UuidSchema,
  type ProvisioningInput,
  type ProvisioningSummary,
  type Page,
  type Pagination,
} from '@lexon/contracts';
import {
  OrganizationAuthPort,
  IdentityError,
  type VerifiedIdentity,
} from '../identity-access/index.js';
import type { AuthCommandSession } from '../../infrastructure/db/index.js';
import { appendAuthAudit } from '../audit/index.js';
import { invitationStatus } from './invitation-policy.js';
type Facts = Awaited<ReturnType<ProvisioningService['facts']>>;
function summary(facts: Facts): ProvisioningSummary {
  const { organization, invitation } = facts;
  if (!organization || !invitation || organization.state !== 'provisioning')
    throw new IdentityError('ORG_FORBIDDEN', 403);
  return ProvisioningSummarySchema.parse({
    version: 1,
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    kind: organization.kind,
    state: organization.state,
    createdAt: organization.createdAt.toISOString(),
    invitation: {
      id: invitation.id,
      status: invitationStatus(invitation.status, invitation.expiresAt),
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });
}
@Injectable()
export class ProvisioningService {
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly config: {
      invitationSeconds: number;
      reauthSeconds: number;
      pagination: { defaultLimit: number; maxLimit: number };
    },
  ) {}
  async facts(tx: AuthCommandSession, organizationId: string) {
    return tx.call('lexonProvisioningFacts', {
      body: { organizationId: UuidSchema.parse(organizationId) },
    });
  }
  private audit(
    tx: AuthCommandSession,
    identity: VerifiedIdentity,
    organizationId: string,
    invitationId: string,
    action: 'created' | 'resent' | 'owner_replaced' | 'cancelled',
  ) {
    return appendAuthAudit(tx, {
      version: 1,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: 'platform.provisioning_changed.v1',
      outcome: 'success',
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
      orgId: organizationId,
      invitationId,
      metadata: { action },
    });
  }
  create(
    identity: VerifiedIdentity,
    input: ProvisioningInput,
  ): Promise<ProvisioningSummary> {
    const body = ProvisioningInputSchema.parse(input);
    return this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => {
        const facts = await tx.call('lexonProvisionTeam', {
          body: {
            name: body.name,
            slug: body.slug,
            email: body.ownerEmail,
            inviterId: identity.userId,
            expiresAt: new Date(
              Date.now() + this.config.invitationSeconds * 1000,
            ).toISOString(),
          },
        });
        await this.audit(
          tx,
          identity,
          facts.organization.id,
          facts.invitation.id,
          'created',
        );
        await tx.call('lexonDeliverInvitation', {
          body: { invitationId: facts.invitation.id },
        });
        return summary(facts);
      },
    );
  }
  get(
    identity: VerifiedIdentity,
    organizationId: string,
  ): Promise<ProvisioningSummary> {
    return this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => summary(await this.facts(tx, organizationId)),
    );
  }
  list(
    identity: VerifiedIdentity,
    input: Partial<Pagination> = {},
  ): Promise<Page<ProvisioningSummary>> {
    const page = PaginationSchema.parse({
      ...input,
      limit: input.limit ?? this.config.pagination.defaultLimit,
    });
    if (page.limit > this.config.pagination.maxLimit)
      throw new IdentityError('VALIDATION_ERROR', 400);
    return this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => {
        const rows = await tx.call('lexonListProvisioning', {
          body: {
            limit: page.limit + 1,
            ...(page.cursor ? { cursor: page.cursor } : {}),
          },
        });
        return {
          items: rows.slice(0, page.limit).map(summary),
          pageInfo: {
            nextCursor:
              rows.length > page.limit
                ? rows[page.limit - 1]!.organization.id
                : null,
          },
        };
      },
    );
  }
  resend(
    identity: VerifiedIdentity,
    organizationId: string,
  ): Promise<ProvisioningSummary> {
    return this.replace(identity, organizationId, undefined);
  }
  replaceOwnerEmail(
    identity: VerifiedIdentity,
    organizationId: string,
    email: string,
  ): Promise<ProvisioningSummary> {
    return this.replace(
      identity,
      organizationId,
      EmailAddressSchema.parse(email),
    );
  }
  private replace(
    identity: VerifiedIdentity,
    organizationId: string,
    email: string | undefined,
  ): Promise<ProvisioningSummary> {
    return this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => {
        const facts = await this.facts(tx, organizationId);
        summary(facts);
        const changed = await tx.call('lexonReplaceOwnerInvitation', {
          body: {
            organizationId,
            expectedInvitationId: facts.invitation!.id,
            email: email ?? facts.invitation!.email,
            inviterId: identity.userId,
            expiresAt: new Date(
              Date.now() + this.config.invitationSeconds * 1000,
            ).toISOString(),
          },
        });
        await this.audit(
          tx,
          identity,
          organizationId,
          changed.invitation.id,
          email ? 'owner_replaced' : 'resent',
        );
        await tx.call('lexonDeliverInvitation', {
          body: { invitationId: changed.invitation.id },
        });
        return summary(changed);
      },
    );
  }
  cancel(identity: VerifiedIdentity, organizationId: string): Promise<void> {
    return this.port.platformTransaction(
      identity,
      this.config.reauthSeconds,
      async (tx) => {
        const facts = await this.facts(tx, organizationId);
        summary(facts);
        const result = await tx.call('lexonCancelProvisioning', {
          body: { organizationId, expectedInvitationId: facts.invitation!.id },
        });
        if (!result.cancelled) throw new IdentityError('ORG_FORBIDDEN', 403);
        await this.audit(
          tx,
          identity,
          organizationId,
          facts.invitation!.id,
          'cancelled',
        );
      },
    );
  }
}
