import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const idSchema = z.uuid();

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export interface RunActorFacts {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly initiatingUserId: string;
  readonly emailVerified: boolean;
  readonly banned: boolean;
  readonly twoFactorEnabled: boolean;
  readonly membershipRole: string | null;
  readonly organizationKind: string;
  readonly organizationState: string;
  readonly require2fa: boolean;
  readonly trustedRunAuthEvidence: Readonly<{
    sessionId: string;
    mfaVerifiedAt: string | null;
  }> | null;
  /** F6 §9: the bound chat's project id, or null for standalone/zero-resource
   * runs. Read as the definer role so the gate still evaluates standing when
   * the chat (and therefore the run) is RLS-invisible to the caller. */
  readonly projectId: string | null;
  /** The CHAT OWNER's project standing — never the caller's (deny beats it). */
  readonly ownerProjectRole: ProjectRole | null;
  /** True when the chat owner sits on the project's deny list. */
  readonly ownerDenied: boolean;
}

interface AuthFactRow {
  actor_user_id: string;
  email_verified: boolean;
  banned: boolean;
  two_factor_enabled: boolean;
  membership_role: string | null;
  organization_kind: string;
  organization_state: string;
  require2fa: boolean;
}

interface ExtendedFactRow extends AuthFactRow {
  initiating_user_id: string;
  initiating_session_id: string | null;
  initiating_mfa_verified_at: Date | null;
  project_id: string | null;
  owner_project_role: string | null;
  owner_denied: boolean;
}

const factsSessions = new WeakMap<RunActorFacts, TenantSession>();

export class RunActorFactsRepository {
  async read(
    tx: TenantSession,
    input: {
      readonly orgId: string;
      readonly userId: string;
      readonly runId?: string;
      readonly chatId?: string;
    },
  ): Promise<RunActorFacts | null> {
    if (
      !idSchema.safeParse(input.orgId).success ||
      !idSchema.safeParse(input.userId).success ||
      (input.runId !== undefined && !idSchema.safeParse(input.runId).success) ||
      (input.chatId !== undefined && !idSchema.safeParse(input.chatId).success)
    )
      throw new Error('Invalid run authorization context');

    const { client, ctx } = requireSession(tx);
    if (ctx.orgId !== input.orgId || ctx.userId !== input.userId)
      throw new Error('Run authorization context mismatch');
    const scope = buildAuthorizationPredicate(ctx);

    if (input.runId !== undefined || input.chatId !== undefined) {
      // The four-argument definer resolves the run row and the bound chat's
      // project standing as the definer role — under project access loss the
      // run is invisible to lexon_app, so the capability gate's inputs can
      // only come from this side of the fence.
      const result = await client.query<ExtendedFactRow>(
        'SELECT * FROM auth.lexon_ai_actor_facts($1,$2,$3,$4)',
        [input.orgId, input.userId, input.runId ?? null, input.chatId ?? null],
      );
      const row = result.rows[0];
      if (!row) return null;
      return this.#bind(tx, input, {
        initiatingUserId: row.initiating_user_id,
        trustedRunAuthEvidence:
          row.initiating_session_id !== null
            ? Object.freeze({
                sessionId: row.initiating_session_id,
                mfaVerifiedAt:
                  row.initiating_mfa_verified_at?.toISOString() ?? null,
              })
            : null,
        projectId: row.project_id,
        ownerProjectRole: parseProjectRole(row.owner_project_role),
        ownerDenied: row.owner_denied === true,
        base: row,
      });
    }

    const result = await client.query<AuthFactRow>(
      'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
      [scope.orgId, input.userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return this.#bind(tx, input, {
      initiatingUserId: input.userId,
      trustedRunAuthEvidence: null,
      projectId: null,
      ownerProjectRole: null,
      ownerDenied: false,
      base: row,
    });
  }

  #bind(
    tx: TenantSession,
    input: { orgId: string; userId: string },
    resolved: {
      initiatingUserId: string;
      trustedRunAuthEvidence: RunActorFacts['trustedRunAuthEvidence'];
      projectId: string | null;
      ownerProjectRole: ProjectRole | null;
      ownerDenied: boolean;
      base: AuthFactRow;
    },
  ): RunActorFacts {
    const facts: RunActorFacts = Object.freeze({
      orgId: input.orgId,
      actorUserId: resolved.base.actor_user_id,
      initiatingUserId: resolved.initiatingUserId,
      emailVerified: resolved.base.email_verified,
      banned: resolved.base.banned,
      twoFactorEnabled: resolved.base.two_factor_enabled,
      membershipRole: resolved.base.membership_role,
      organizationKind: resolved.base.organization_kind,
      organizationState: resolved.base.organization_state,
      require2fa: resolved.base.require2fa,
      trustedRunAuthEvidence: resolved.trustedRunAuthEvidence,
      projectId: resolved.projectId,
      ownerProjectRole: resolved.ownerProjectRole,
      ownerDenied: resolved.ownerDenied,
    });
    factsSessions.set(facts, tx);
    return facts;
  }
}

function parseProjectRole(value: string | null): ProjectRole | null {
  return value === 'owner' || value === 'editor' || value === 'viewer'
    ? value
    : null;
}

export function assertRunActorFactsSession(
  tx: TenantSession,
  facts: RunActorFacts,
): void {
  requireSession(tx);
  if (factsSessions.get(facts) !== tx)
    throw new Error('Run authorization facts expired');
}
