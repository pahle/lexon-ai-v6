import type { OrgAction, OrgKind, OrgRole } from '@lexon/contracts';
import { IdentityError } from './identity-error.js';

interface PolicyInput {
  action: OrgAction;
  actorRole: OrgRole | null;
  targetRole?: OrgRole;
  kind: OrgKind;
}
export class IdentityPolicy {
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
