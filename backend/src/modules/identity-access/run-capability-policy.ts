export type RunAuthorizationPhase =
  'start' | 'resume' | 'tool' | 'decision' | 'cancel';

export interface RunPolicyFacts {
  readonly phase: RunAuthorizationPhase;
  readonly actorUserId: string;
  readonly initiatingUserId: string;
  readonly emailVerified: boolean;
  readonly banned: boolean;
  readonly twoFactorEnabled: boolean;
  readonly mfaVerifiedAt: Date | null;
  readonly membershipRole: string | null;
  readonly organizationKind: string;
  readonly organizationState: string;
  readonly require2fa: boolean;
  readonly profileId: string;
  readonly capabilities: readonly string[];
}

export interface CapabilityDecision {
  readonly allowed: boolean;
  readonly mayDecide: boolean;
  readonly capabilities: readonly string[];
}

export function decideRunCapabilities(
  input: RunPolicyFacts,
): CapabilityDecision {
  const mfaValid =
    input.mfaVerifiedAt instanceof Date &&
    Number.isFinite(input.mfaVerifiedAt.getTime());
  const eligible =
    input.emailVerified &&
    !input.banned &&
    input.membershipRole !== null &&
    (input.organizationKind === 'team' ||
      input.organizationKind === 'personal') &&
    input.organizationState === 'active' &&
    (!(input.twoFactorEnabled || input.require2fa) || mfaValid);
  const actorIsInitiator = input.actorUserId === input.initiatingUserId;
  const allowed = eligible && actorIsInitiator;
  const mayDecide = allowed && input.phase === 'decision';

  return Object.freeze({
    allowed,
    mayDecide,
    capabilities: Object.freeze(
      allowed ? [...new Set(input.capabilities)] : [],
    ),
  });
}
