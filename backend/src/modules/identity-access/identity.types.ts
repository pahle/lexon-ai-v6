import { AsyncLocalStorage } from 'node:async_hooks';
import { IdentityError } from './identity-error.js';

declare const verified: unique symbol;
export interface VerifiedIdentity {
  readonly [verified]: true;
  readonly userId: string;
  readonly sessionId: string;
  readonly activeOrganizationId: string;
  readonly channel: 'cookie' | 'bearer';
  readonly platformAdmin: boolean;
  readonly mfaVerifiedAt: Date | null;
  readonly reauthenticatedAt: Date | null;
}
const scope = new AsyncLocalStorage<{
  identity: VerifiedIdentity;
  active: boolean;
}>();

// Module-private minting boundary, used only after the guard verifies the
// server-side session and membership. Not part of the public module facade.
export async function withVerifiedIdentity<T>(
  facts: Omit<VerifiedIdentity, typeof verified>,
  work: (identity: VerifiedIdentity) => Promise<T>,
): Promise<T> {
  const identity = Object.freeze({ ...facts }) as VerifiedIdentity;
  const state = { identity, active: true };
  try {
    return await scope.run(state, () => work(identity));
  } finally {
    state.active = false;
  }
}
export function assertVerifiedIdentity(identity: VerifiedIdentity): void {
  const state = scope.getStore();
  if (!state?.active || state.identity !== identity)
    throw new IdentityError('AUTH_REQUIRED', 401);
}
export function currentVerifiedIdentity(): VerifiedIdentity {
  const state = scope.getStore();
  if (!state?.active) throw new IdentityError('AUTH_REQUIRED', 401);
  return state.identity;
}
