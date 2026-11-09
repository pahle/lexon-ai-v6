import { z } from 'zod';
import { buildAuthorizationPredicate } from './authorization-predicate.js';
import { requireSession, type TenantSession } from './tenant-session.js';

const idSchema = z.uuid();

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

interface RunAuthRow {
  initiating_user_id: string;
  initiating_session_id: string | null;
  initiating_mfa_verified_at: Date | null;
}

const factsSessions = new WeakMap<RunActorFacts, TenantSession>();

export class RunActorFactsRepository {
  async read(
    tx: TenantSession,
    input: {
      readonly orgId: string;
      readonly userId: string;
      readonly runId?: string;
    },
  ): Promise<RunActorFacts | null> {
    if (
      !idSchema.safeParse(input.orgId).success ||
      !idSchema.safeParse(input.userId).success ||
      (input.runId !== undefined && !idSchema.safeParse(input.runId).success)
    )
      throw new Error('Invalid run authorization context');

    const { client, ctx } = requireSession(tx);
    if (ctx.orgId !== input.orgId || ctx.userId !== input.userId)
      throw new Error('Run authorization context mismatch');
    const scope = buildAuthorizationPredicate(ctx);

    let initiatingUserId = input.userId;
    let trustedRunAuthEvidence: RunActorFacts['trustedRunAuthEvidence'] = null;
    if (input.runId !== undefined) {
      const run = await client.query<RunAuthRow>(
        `SELECT initiating_user_id, initiating_session_id,
                initiating_mfa_verified_at
         FROM app.ai_runs WHERE org_id=$1 AND id=$2`,
        [scope.orgId, input.runId],
      );
      const row = run.rows[0];
      if (!row) return null;
      initiatingUserId = row.initiating_user_id;
      if (row.initiating_session_id !== null)
        trustedRunAuthEvidence = Object.freeze({
          sessionId: row.initiating_session_id,
          mfaVerifiedAt: row.initiating_mfa_verified_at?.toISOString() ?? null,
        });
    }

    const result = await client.query<AuthFactRow>(
      'SELECT * FROM auth.lexon_ai_actor_facts($1,$2)',
      [input.orgId, input.userId],
    );
    const row = result.rows[0];
    if (!row) return null;

    const facts: RunActorFacts = Object.freeze({
      orgId: input.orgId,
      actorUserId: row.actor_user_id,
      initiatingUserId,
      emailVerified: row.email_verified,
      banned: row.banned,
      twoFactorEnabled: row.two_factor_enabled,
      membershipRole: row.membership_role,
      organizationKind: row.organization_kind,
      organizationState: row.organization_state,
      require2fa: row.require2fa,
      trustedRunAuthEvidence,
    });
    factsSessions.set(facts, tx);
    return facts;
  }
}

export function assertRunActorFactsSession(
  tx: TenantSession,
  facts: RunActorFacts,
): void {
  requireSession(tx);
  if (factsSessions.get(facts) !== tx)
    throw new Error('Run authorization facts expired');
}
