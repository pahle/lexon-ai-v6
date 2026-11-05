import { AsyncLocalStorage } from 'node:async_hooks';
import { IdentityError } from './identity-error.js';
import {
  assertVerifiedIdentity,
  type VerifiedIdentity,
} from './identity.types.js';

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
  const state = { active: true, actor: undefined as unknown as RunActor };
  const actor = Object.freeze({
    get orgId() {
      requireActive(state);
      return identity.activeOrganizationId;
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
      return mfaTime === null ? null : new Date(mfaTime);
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
