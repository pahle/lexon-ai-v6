import { expect, test } from 'vitest';
import { invitationStatus } from '../../src/modules/organizations/invitation-policy.js';
test('expiry is derived only for pending invitations with terminal states preserved', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  expect(invitationStatus('pending', now, now)).toBe('expired');
  expect(invitationStatus('pending', new Date(now.getTime() + 1), now)).toBe(
    'pending',
  );
  for (const [native, publicStatus] of [
    ['accepted', 'accepted'],
    ['rejected', 'declined'],
    ['canceled', 'cancelled'],
  ] as const)
    expect(invitationStatus(native, now, now)).toBe(publicStatus);
});
