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
  /** F6 §9 project gate inputs (null/false for standalone & zero-resource
   * runs — the arms below stay inert there). */
  readonly projectId: string | null;
  readonly ownerProjectRole: 'owner' | 'editor' | 'viewer' | null;
  readonly ownerDenied: boolean;
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
  // F6 §9 project gate: a deny row walls off the whole run, a project-bound
  // chat may only run under 'project-chat' (the 'chat' profile would drop the
  // project context silently), and 'project-chat' itself requires the chat
  // owner to keep owner/editor standing. Every violation reads as
  // AI_ACCESS_REVOKED on the caller's phase.
  const projectBlocked =
    input.ownerDenied ||
    (input.projectId !== null && input.profileId === 'chat') ||
    (input.profileId === 'project-chat' &&
      (input.projectId === null ||
        (input.ownerProjectRole !== 'owner' &&
          input.ownerProjectRole !== 'editor')));
  const allowed = eligible && actorIsInitiator && !projectBlocked;
  const mayDecide = allowed && input.phase === 'decision';

  return Object.freeze({
    allowed,
    mayDecide,
    capabilities: Object.freeze(
      allowed ? [...new Set(input.capabilities)] : [],
    ),
  });
}
