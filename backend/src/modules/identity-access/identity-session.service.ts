import { Injectable } from '@nestjs/common';
import {
  IdentitySummarySchema,
  OrganizationSummarySchema,
  OrgRoleSchema,
  UuidSchema,
  type OrganizationSummary,
  type SwitchResult,
} from '@lexon/contracts';
import type {
  AuthIntegration,
  AuthCommandSession,
} from '../../infrastructure/db/index.js';
import { credentialChannel } from './credential-channel.js';
import { IdentityError } from './identity-error.js';
import { IdentityPolicy } from './identity-policy.js';
import {
  assertVerifiedIdentity,
  verifiedIdentityHeaders,
  type VerifiedIdentity,
} from './identity.types.js';
import { isRetryableAuthError } from './organization-auth.port.js';
import type { RouteAccess } from './route-access.js';
import type { ResolvedRequestIdentity } from './request-identity.js';

class SelectionChanged extends Error {}
type SelectionFacts = Awaited<
  ReturnType<IdentitySessionService['selectionFacts']>
>;
type Organization = NonNullable<SelectionFacts['selected']>;
function summary(
  organization: Organization,
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
    role,
    createdAt: organization.createdAt.toISOString(),
  });
}
export interface OrganizationSelectionPort {
  select(
    identity: VerifiedIdentity,
    organizationId: string,
  ): Promise<SwitchResult>;
}
export const ORGANIZATION_SELECTION = Symbol('OrganizationSelection');
@Injectable()
export class IdentitySessionService implements OrganizationSelectionPort {
  private readonly policy = new IdentityPolicy();
  constructor(private readonly integration: AuthIntegration) {}
  async selectionFacts(
    tx: AuthCommandSession,
    userId: string,
    sessionId: string,
    targetOrganizationId?: string,
  ) {
    return tx.call('lexonSelectionFacts', {
      body: {
        userId,
        sessionId,
        ...(targetOrganizationId ? { targetOrganizationId } : {}),
      },
    });
  }
  private async transaction<T>(
    work: (tx: AuthCommandSession) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.integration.transaction(work);
      } catch (error) {
        if (
          attempt < 2 &&
          (error instanceof SelectionChanged || isRetryableAuthError(error))
        )
          continue;
        if (error instanceof IdentityError) throw error;
        throw new IdentityError('AUTH_UNAVAILABLE', 503);
      }
    }
    throw new IdentityError('AUTH_UNAVAILABLE', 503);
  }
  private async actor(
    tx: AuthCommandSession,
    headers: Headers,
    expected?: VerifiedIdentity,
  ) {
    const channel = credentialChannel(headers);
    const facts = await tx.call('lexonSecurityFacts', { headers });
    const user = facts.user;
    const session = facts.session;
    if (!user || !session) throw new IdentityError('AUTH_REQUIRED', 401);

    if (
      session.channel !== channel ||
      (session.hardExpiresAt && session.hardExpiresAt <= new Date())
    )
      throw new IdentityError('AUTH_REQUIRED', 401);
    if (
      expected &&
      (expected.userId !== user.id ||
        expected.sessionId !== session.id ||
        expected.channel !== channel)
    )
      throw new IdentityError('AUTH_REQUIRED', 401);
    if (expected?.mfaVerifiedAt && !session.mfaVerifiedAt)
      throw new IdentityError('AUTH_2FA_REQUIRED', 403);
    return { user, session, channel };
  }
  private async write(
    tx: AuthCommandSession,
    facts: SelectionFacts,
    organizationId: string,
    pendingOrganizationId: string | null,
    memberId: string,
    repair = false,
  ) {
    if (!facts.session) throw new IdentityError('AUTH_REQUIRED', 401);
    const result = await tx.call(
      repair ? 'lexonRepairSelection' : 'lexonSelectOrganization',
      {
        body: {
          userId: facts.session.userId,
          sessionId: facts.session.id,
          expectedOrganizationId: facts.session.activeOrganizationId,
          expectedVersion: facts.session.selectionVersion,
          organizationId,
          pendingOrganizationId,
          expectedMemberId: memberId,
        },
      },
    );
    if (!result.applied) throw new SelectionChanged();
  }
  private async resolveSelection(
    tx: AuthCommandSession,
    userId: string,
    sessionId: string,
    mfa: Date | null,
  ) {
    let facts = await this.selectionFacts(tx, userId, sessionId);
    let fallbackReason: 'membership_removed' | 'selection_repaired' | undefined;
    let previousOrganizationName: string | undefined;
    if (!facts.session || !facts.personal || !facts.personalMember)
      throw new IdentityError('AUTH_UNAVAILABLE', 503);
    if (
      !facts.selected ||
      facts.selected.state !== 'active' ||
      !facts.selectedMember
    ) {
      const previous = facts.session.activeOrganizationName;
      fallbackReason =
        previous &&
        UuidSchema.safeParse(facts.session.activeOrganizationId).success
          ? 'membership_removed'
          : 'selection_repaired';
      if (fallbackReason === 'membership_removed' && previous)
        previousOrganizationName = previous;
      await this.write(
        tx,
        facts,
        facts.personal.id,
        null,
        facts.personalMember.id,
        true,
      );
      facts = await this.selectionFacts(tx, userId, sessionId);
    }
    const pending = facts.session?.pendingOrganizationId;
    if (pending) {
      const valid = UuidSchema.safeParse(pending).success;
      const target = valid
        ? await this.selectionFacts(tx, userId, sessionId, pending)
        : facts;
      if (
        !valid ||
        !target.target ||
        target.target.state !== 'active' ||
        !target.targetMember
      ) {
        if (!facts.selected || !facts.selectedMember)
          throw new IdentityError('AUTH_UNAVAILABLE', 503);
        await this.write(
          tx,
          target,
          facts.selected.id,
          null,
          facts.selectedMember.id,
        );
        fallbackReason ??= 'membership_removed';
        facts = await this.selectionFacts(tx, userId, sessionId);
      } else if (!target.target.require2fa || mfa) {
        await this.write(
          tx,
          target,
          target.target.id,
          null,
          target.targetMember.id,
        );
        facts = await this.selectionFacts(tx, userId, sessionId);
      }
    }
    if (!facts.session || !facts.selected || !facts.selectedMember)
      throw new IdentityError('AUTH_UNAVAILABLE', 503);
    return {
      facts,
      organization: summary(facts.selected, facts.selectedMember.role),
      fallbackReason,
      previousOrganizationName,
    };
  }
  async resolve(
    headers: Headers,
    access: RouteAccess,
    onCookies?: (cookies: string[]) => void,
  ): Promise<ResolvedRequestIdentity> {
    const result = await this.transaction(async (tx) => {
      const actor = await this.actor(tx, headers);
      this.policy.requireAccount(actor.user, actor.session.mfaVerifiedAt, {
        ...(access.allowIncompleteMfa ? { allowIncompleteMfa: true } : {}),
        ...(access.kind === 'platform' ? { platform: true } : {}),
      });
      const selection = await this.resolveSelection(
        tx,
        actor.user.id,
        actor.session.id,
        actor.session.mfaVerifiedAt,
      );
      if (access.kind === 'workspace')
        this.policy.requireOrganizationMfa(
          selection.organization.require2fa,
          actor.session.mfaVerifiedAt,
        );
      const profile = await tx.call('lexonAccountProfile', {
        body: { userId: actor.user.id },
      });
      const response = await tx.call('getSession', {
        headers,
        returnHeaders: true,
      });
      const platformAdmin =
        actor.user.role === 'admin' &&
        actor.user.twoFactorEnabled &&
        !!actor.session.mfaVerifiedAt;
      return {
        resolved: {
          identity: {
            userId: actor.user.id,
            sessionId: actor.session.id,
            activeOrganizationId: selection.organization.id,
            channel: actor.channel,
            platformAdmin,
            mfaVerifiedAt: actor.session.mfaVerifiedAt,
            reauthenticatedAt: actor.session.reauthenticatedAt,
          },
          tenant: {
            orgId: selection.organization.id,
            userId: actor.user.id,
            role: OrgRoleSchema.parse(selection.organization.role),
          },
          summary: IdentitySummarySchema.parse({
            version: 1,
            platformAdmin,
            user: profile,
            organization: selection.organization,
            ...(selection.fallbackReason
              ? { fallbackReason: selection.fallbackReason }
              : {}),
            ...(selection.previousOrganizationName
              ? { previousOrganizationName: selection.previousOrganizationName }
              : {}),
          }),
        } satisfies ResolvedRequestIdentity,
        cookies:
          actor.channel === 'cookie' ? response.headers.getSetCookie() : [],
      };
    });
    if (result.cookies.length) onCookies?.(result.cookies);
    return result.resolved;
  }
  async select(
    identity: VerifiedIdentity,
    organizationId: string,
  ): Promise<SwitchResult> {
    assertVerifiedIdentity(identity);
    if (!UuidSchema.safeParse(organizationId).success)
      throw new IdentityError('VALIDATION_ERROR', 400);
    const headers = verifiedIdentityHeaders(identity);
    return this.transaction(async (tx) => {
      const actor = await this.actor(tx, headers, identity);
      this.policy.requireAccount(actor.user, actor.session.mfaVerifiedAt);
      const current = await this.resolveSelection(
        tx,
        actor.user.id,
        actor.session.id,
        actor.session.mfaVerifiedAt,
      );
      const facts = await this.selectionFacts(
        tx,
        actor.user.id,
        actor.session.id,
        organizationId,
      );
      if (
        !facts.target ||
        facts.target.state !== 'active' ||
        !facts.targetMember
      )
        throw new IdentityError('ORG_MEMBERSHIP_REQUIRED', 403);
      if (facts.target.require2fa && !actor.session.mfaVerifiedAt) {
        await this.write(
          tx,
          facts,
          current.organization.id,
          organizationId,
          facts.targetMember.id,
        );
        return {
          status: 'enrollment_required',
          organization: current.organization,
          pendingOrganizationId: organizationId,
        };
      }
      await this.write(tx, facts, organizationId, null, facts.targetMember.id);
      return {
        status: 'switched',
        organization: summary(facts.target, facts.targetMember.role),
      };
    });
  }
}
