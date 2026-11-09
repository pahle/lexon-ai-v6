import { AsyncLocalStorage } from 'node:async_hooks';
import { IdentityError } from './identity-error.js';
import {
  assertVerifiedIdentity,
  type VerifiedIdentity,
} from './identity.types.js';
import {
  assertRunActorFactsSession,
  type RunActorFacts,
  type TenantSession,
} from '../../infrastructure/db/index.js';

declare const runActorBrand: unique symbol;

export type RunActor = Readonly<{
  orgId: string;
  userId: string;
  sessionId: string;
  mfaVerifiedAt: Date | null;
  [runActorBrand]: true;
}>;

interface RunActorScope {
  actor: RunActor;
  active: boolean;
}

const scope = new AsyncLocalStorage<RunActorScope>();

export function withRunActor<T>(
  identity: VerifiedIdentity,
  work: (actor: RunActor) => Promise<T>,
): Promise<T> {
  assertVerifiedIdentity(identity);
  const mfaTime = identity.mfaVerifiedAt?.getTime() ?? null;
  if (mfaTime !== null && !Number.isFinite(mfaTime))
    throw new IdentityError('AUTH_REQUIRED', 401);
  return runScopedActor(
    {
      orgId: identity.activeOrganizationId,
      userId: identity.userId,
      sessionId: identity.sessionId,
      mfaTime,
    },
    work,
  );
}

/** An Identity-minted worker actor scope backed by current, session-bound DB facts. */
export interface WorkerRunActorScope {
  run<T>(work: (actor: RunActor) => Promise<T>): Promise<T>;
}

export function createWorkerRunActorScope(
  tx: TenantSession,
  facts: RunActorFacts,
): WorkerRunActorScope {
  assertRunActorFactsSession(tx, facts);
  const sessionId = facts.trustedRunAuthEvidence?.sessionId;
  if (!sessionId) throw new Error('Worker run actor provenance unavailable');
  const timestamp = facts.trustedRunAuthEvidence.mfaVerifiedAt;
  const mfaTime = timestamp === null ? null : new Date(timestamp).getTime();
  if (mfaTime !== null && !Number.isFinite(mfaTime))
    throw new Error('Worker run actor provenance unavailable');
  const identity = Object.freeze({
    orgId: facts.orgId,
    userId: facts.actorUserId,
    sessionId,
    mfaTime,
  });
  return Object.freeze({
    run<T>(work: (actor: RunActor) => Promise<T>): Promise<T> {
      return runScopedActor(identity, work);
    },
  });
}

function runScopedActor<T>(
  identity: {
    orgId: string;
    userId: string;
    sessionId: string;
    mfaTime: number | null;
  },
  work: (actor: RunActor) => Promise<T>,
): Promise<T> {
  const state = { active: true, actor: undefined as unknown as RunActor };
  const actor = Object.freeze({
    get orgId() {
      requireActive(state);
      return identity.orgId;
    },
    get userId() {
      requireActive(state);
      return identity.userId;
    },
    get sessionId() {
      requireActive(state);
      return identity.sessionId;
    },
    get mfaVerifiedAt() {
      requireActive(state);
      return identity.mfaTime === null ? null : new Date(identity.mfaTime);
    },
  }) as RunActor;
  state.actor = actor;
  return scope.run(state, async () => {
    try {
      return await work(actor);
    } finally {
      state.active = false;
    }
  });
}

export function currentRunActor(): RunActor | undefined {
  const state = scope.getStore();
  return state?.active ? state.actor : undefined;
}

function requireActive(state: RunActorScope): void {
  if (!state.active || scope.getStore() !== state)
    throw new IdentityError('AUTH_REQUIRED', 401);
}
