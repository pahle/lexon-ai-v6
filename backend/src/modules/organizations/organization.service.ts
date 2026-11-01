import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CreateOrganizationInputSchema,
  OrganizationSettingsInputSchema,
  OrganizationSummarySchema,
  PaginationSchema,
  OrgRoleSchema,
  OrgKindSchema,
  type OrganizationSummary,
  type CreateOrganizationInput,
  type OrganizationSettingsInput,
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

interface OrganizationData {
  id: string;
  name: string;
  slug: string;
  kind: string;
  state: string;
  require2fa: boolean;
  createdAt: Date;
}
function summary(
  organization: OrganizationData,
  role: string,
): OrganizationSummary {
  return OrganizationSummarySchema.parse({
    version: 1,
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    kind: organization.kind,
    state: organization.state,
    require2fa: organization.require2fa,
    createdAt: organization.createdAt.toISOString(),
    role,
  });
}
@Injectable()
export class OrganizationService {
  private readonly policy = new IdentityPolicy();
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly config: {
      pagination: { defaultLimit: number; maxLimit: number };
    },
  ) {}
  async list(
    identity: VerifiedIdentity,
    input: Partial<Pagination> = {},
  ): Promise<Page<OrganizationSummary>> {
    const page = PaginationSchema.parse({
      ...input,
      limit: input.limit ?? this.config.pagination.defaultLimit,
    });
    if (page.limit > this.config.pagination.maxLimit)
      throw new IdentityError('VALIDATION_ERROR', 400);
    return this.port.transaction(identity, async (tx) => {
      const rows = await tx.call('lexonListOrganizationFacts', {
        body: {
          userId: identity.userId,
          limit: page.limit + 1,
          ...(page.cursor ? { cursor: page.cursor } : {}),
        },
      });
      const eligible = rows.filter(
        (row) => row.organization?.state === 'active',
      );
      const pageItems = eligible.slice(0, page.limit);
      return {
        items: pageItems.map((row) =>
          summary(row.organization!, row.member.role),
        ),
        pageInfo: {
          nextCursor:
            eligible.length > page.limit
              ? pageItems[pageItems.length - 1]!.member.organizationId
              : null,
        },
      };
    });
  }
  async create(
    identity: VerifiedIdentity,
    input: CreateOrganizationInput,
  ): Promise<OrganizationSummary> {
    const body = CreateOrganizationInputSchema.parse(input);
    return this.port.transaction(identity, async (tx, headers) => {
      const actor = await tx.call('lexonSecurityFacts', { headers });
      if (actor.user?.role === 'admin')
        throw new IdentityError('ORG_FORBIDDEN', 403);
      this.policy.require({
        action: 'create_team',
        actorRole: null,
        kind: 'team',
      });
      const organization = await tx.call('createOrganization', {
        headers,
        body: { ...body, keepCurrentActiveOrganization: true },
      });
      if (!organization) throw new IdentityError('AUTH_UNAVAILABLE', 503);
      await appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        type: 'organization.created.v1',
        outcome: 'success',
        orgId: organization.id,
        actorUserId: identity.userId,
        sessionId: identity.sessionId,
        metadata: { kind: 'team', source: 'user' },
      });
      return summary(organization, 'owner');
    });
  }
  async settings(
    identity: VerifiedIdentity,
    organizationId: string,
    input: OrganizationSettingsInput,
  ): Promise<OrganizationSummary> {
    const body = OrganizationSettingsInputSchema.parse(input);
    return this.port.transaction(identity, async (tx, headers) => {
      const facts = await tx.call('lexonOrganizationFacts', {
        body: { organizationId, actorUserId: identity.userId },
      });
      const organization = facts.organization;
      if (!organization || organization.state !== 'active')
        throw new IdentityError('ORG_FORBIDDEN', 403);
      const role = facts.actor ? OrgRoleSchema.parse(facts.actor.role) : null;
      this.policy.require({
        action: 'settings',
        actorRole: role,
        kind: OrgKindSchema.parse(organization.kind),
      });
      this.policy.requireOrganizationMfa(
        organization.require2fa,
        identity.mfaVerifiedAt,
      );
      const fields: Array<'name' | 'slug' | 'require2fa'> = [];
      if (body.name !== undefined && body.name !== organization.name)
        fields.push('name');
      if (body.slug !== undefined && body.slug !== organization.slug)
        fields.push('slug');
      if (
        body.require2fa !== undefined &&
        body.require2fa !== organization.require2fa
      )
        fields.push('require2fa');
      if (!fields.length) return summary(organization, role!);
      if (fields.includes('name') || fields.includes('slug'))
        await tx.call('updateOrganization', {
          headers,
          body: {
            organizationId,
            data: {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.slug !== undefined ? { slug: body.slug } : {}),
            },
          },
        });
      if (fields.includes('require2fa'))
        await tx.call('lexonSetOrganizationRequirement', {
          body: {
            organizationId,
            actorUserId: identity.userId,
            expectedActorRole: role!,
            expectedRequire2fa: organization.require2fa,
            require2fa: body.require2fa!,
          },
        });
      await appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        type: 'organization.settings_changed.v1',
        outcome: 'success',
        orgId: organizationId,
        actorUserId: identity.userId,
        sessionId: identity.sessionId,
        metadata: { fields },
      });
      return summary(
        {
          ...organization,
          name: body.name ?? organization.name,
          slug: body.slug ?? organization.slug,
          require2fa: body.require2fa ?? organization.require2fa,
        },
        role!,
      );
    });
  }
}
