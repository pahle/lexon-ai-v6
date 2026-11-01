import type { InvitationStatus, OrgRole } from '@lexon/contracts';
const ranks: readonly OrgRole[] = ['member', 'admin', 'owner'];
export function roleForFirstAcceptance(
  current: OrgRole | null,
  invited: OrgRole,
): OrgRole {
  return ranks[
    Math.max(current ? ranks.indexOf(current) : -1, ranks.indexOf(invited))
  ]!;
}
export function classifyInvitationAcceptance(input: {
  status: string;
  expired: boolean;
  acceptedByUserId: string | null;
  actorUserId: string;
  hasMembership: boolean;
}): 'first' | 'retry' | 'deny' {
  if (input.status === 'accepted')
    return input.acceptedByUserId === input.actorUserId && input.hasMembership
      ? 'retry'
      : 'deny';
  return input.status === 'pending' && !input.expired ? 'first' : 'deny';
}
export function invitationStatus(
  status: string,
  expiresAt: Date,
  now = new Date(),
): InvitationStatus {
  if (status === 'pending') return expiresAt <= now ? 'expired' : 'pending';
  if (status === 'accepted') return 'accepted';
  if (status === 'rejected') return 'declined';
  if (status === 'canceled') return 'cancelled';
  throw new Error('Invalid invitation status');
}
