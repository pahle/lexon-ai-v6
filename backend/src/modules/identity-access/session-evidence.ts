import {
  assertVerifiedIdentity,
  type VerifiedIdentity,
} from './identity.types.js';
import { IdentityError } from './identity-error.js';

export class SessionEvidence {
  requireMfa(identity: VerifiedIdentity): void {
    assertVerifiedIdentity(identity);
    if (
      !identity.mfaVerifiedAt ||
      !Number.isFinite(identity.mfaVerifiedAt.getTime())
    )
      throw new IdentityError('AUTH_2FA_REQUIRED', 403);
  }
  requireRecent(identity: VerifiedIdentity, now: Date, seconds: number): void {
    assertVerifiedIdentity(identity);
    const age = identity.reauthenticatedAt
      ? now.getTime() - identity.reauthenticatedAt.getTime()
      : Number.NaN;
    if (!Number.isFinite(age) || age < 0 || age >= seconds * 1000)
      throw new IdentityError('AUTH_REAUTH_REQUIRED', 403);
  }
}
