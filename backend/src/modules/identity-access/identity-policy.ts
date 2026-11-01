import type { OrgAction, OrgKind, OrgRole } from '@lexon/contracts';
import { IdentityError } from './identity-error.js';

interface PolicyInput {
  action: OrgAction;
  actorRole: OrgRole | null;
  targetRole?: OrgRole;
  kind: OrgKind;
}
export class IdentityPolicy {
  requireAccount(
    user: {
      banned: boolean | null;
      emailVerified: boolean;
      twoFactorEnabled: boolean;
      role: string | null;
    },
    mfaVerifiedAt: Date | null,
    options: { allowIncompleteMfa?: boolean; platform?: boolean } = {},
  ): void {
    if (user.banned) throw new IdentityError('AUTH_REQUIRED', 401);
    if (!user.emailVerified)
      throw new IdentityError('AUTH_EMAIL_VERIFICATION_REQUIRED', 403);
    if (options.platform && user.role !== 'admin')
      throw new IdentityError('ORG_FORBIDDEN', 403);
    if (
      !options.allowIncompleteMfa &&
      (user.twoFactorEnabled || user.role === 'admin' || options.platform) &&
      (!user.twoFactorEnabled || !mfaVerifiedAt)
    )
      throw new IdentityError('AUTH_2FA_REQUIRED', 403);
  }
  requireOrganizationMfa(required: boolean, mfaVerifiedAt: Date | null): void {
    if (
      required &&
      (!mfaVerifiedAt || !Number.isFinite(mfaVerifiedAt.getTime()))
    )
      throw new IdentityError('AUTH_2FA_REQUIRED', 403);
  }
  can(input: PolicyInput): boolean {
    if (input.kind !== 'team') return false;
    if (input.action === 'create_team') return true;
    if (!input.actorRole) return false;
    switch (input.action) {
      case 'read_members':
      case 'leave':
        return true;
      case 'invite_member':
      case 'read_invitations':
        return input.actorRole === 'owner' || input.actorRole === 'admin';
      case 'invite_admin':
      case 'settings':
        return input.actorRole === 'owner';
      case 'promote_owner':
        return input.actorRole === 'owner' && input.targetRole !== undefined;
      case 'change_role':
        return (
          input.targetRole !== undefined &&
          (input.actorRole === 'owner' ||
            (input.actorRole === 'admin' && input.targetRole !== 'owner'))
        );
      case 'remove_member':
        return (
          input.targetRole !== undefined &&
          (input.actorRole === 'owner' ||
            (input.actorRole === 'admin' && input.targetRole === 'member'))
        );
    }
  }
  require(input: PolicyInput): void {
    if (!this.can(input)) throw new IdentityError('ORG_FORBIDDEN', 403);
  }
}
