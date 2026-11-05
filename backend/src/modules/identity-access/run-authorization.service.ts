import { Injectable } from '@nestjs/common';
import {
  assertRunActorFactsSession,
  type RunActorFacts,
  type TenantSession,
} from '../../infrastructure/db/index.js';
import type { VerifiedIdentity } from './identity.types.js';
import { assertVerifiedIdentity } from './identity.types.js';
import { currentRunActor, withRunActor, type RunActor } from './run-actor.js';
import {
  decideRunCapabilities,
  type CapabilityDecision,
  type RunAuthorizationPhase,
} from './run-capability-policy.js';

@Injectable()
export class RunAuthorizationService {
  withActor<T>(
    identity: VerifiedIdentity,
    work: (actor: RunActor) => Promise<T>,
  ): Promise<T> {
    assertVerifiedIdentity(identity);
    return withRunActor(identity, work);
  }

  async authorize(
    tx: TenantSession,
    actorFacts: RunActorFacts,
    policy: {
      readonly profileId: string;
      readonly capabilities: readonly string[];
    },
    phase: RunAuthorizationPhase,
  ): Promise<CapabilityDecision> {
    assertRunActorFactsSession(tx, actorFacts);
    let mfaVerifiedAt = parseMfaEvidence(
      actorFacts.trustedRunAuthEvidence?.mfaVerifiedAt ?? null,
    );
    let actorUserId = actorFacts.actorUserId;

    if (phase === 'start' || phase === 'decision') {
      const actor = currentRunActor();
      if (
        !actor ||
        actor.orgId !== actorFacts.orgId ||
        actor.userId !== actorFacts.actorUserId
      )
        return deniedDecision();
      actorUserId = actor.userId;
      mfaVerifiedAt = actor.mfaVerifiedAt;
    }

    return decideRunCapabilities({
      phase,
      actorUserId,
      initiatingUserId: actorFacts.initiatingUserId,
      emailVerified: actorFacts.emailVerified,
      banned: actorFacts.banned,
      twoFactorEnabled: actorFacts.twoFactorEnabled,
      mfaVerifiedAt,
      membershipRole: actorFacts.membershipRole,
      organizationKind: actorFacts.organizationKind,
      organizationState: actorFacts.organizationState,
      require2fa: actorFacts.require2fa,
      profileId: policy.profileId,
      capabilities: policy.capabilities,
    });
  }
}

function deniedDecision(): CapabilityDecision {
  return Object.freeze({
    allowed: false,
    mayDecide: false,
    capabilities: Object.freeze([]),
  });
}

function parseMfaEvidence(value: string | null): Date | null {
  if (value === null) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp : null;
}
