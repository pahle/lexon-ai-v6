import { expect, test } from 'vitest';
import {
  roleForFirstAcceptance,
  classifyInvitationAcceptance,
} from '../../src/modules/organizations/invitation-policy.js';

test('first acceptance applies the higher role without demoting an existing member', () => {
  const ranks = ['member', 'admin', 'owner'] as const;
  for (const current of [null, ...ranks])
    for (const invited of ranks)
      expect(roleForFirstAcceptance(current, invited)).toBe(
        ranks[
          Math.max(
            current ? ranks.indexOf(current) : -1,
            ranks.indexOf(invited),
          )
        ],
      );
});
test('consumed acceptance binds to the same user and requires extant membership', () => {
  const facts = {
    status: 'accepted',
    expired: true,
    acceptedByUserId: 'original',
    actorUserId: 'original',
    hasMembership: true,
  };
  expect(classifyInvitationAcceptance(facts)).toBe('retry');
  expect(classifyInvitationAcceptance({ ...facts, hasMembership: false })).toBe(
    'deny',
  );
  expect(classifyInvitationAcceptance({ ...facts, actorUserId: 'other' })).toBe(
    'deny',
  );
  for (const status of ['rejected', 'canceled'])
    expect(classifyInvitationAcceptance({ ...facts, status })).toBe('deny');
  expect(
    classifyInvitationAcceptance({
      ...facts,
      status: 'pending',
      acceptedByUserId: null,
      expired: false,
      hasMembership: false,
    }),
  ).toBe('first');
  expect(
    classifyInvitationAcceptance({
      ...facts,
      status: 'pending',
      expired: true,
    }),
  ).toBe('deny');
});
import { invitationStatus } from '../../src/modules/organizations/invitation-policy.js';
test('status mapping expires exactly at deadline and rejects unknown native states', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  expect(invitationStatus('pending', new Date(now.getTime() + 1), now)).toBe(
    'pending',
  );
  for (const age of [0, 1])
    expect(
      invitationStatus('pending', new Date(now.getTime() - age), now),
    ).toBe('expired');
  for (const [native, publicStatus] of [
    ['accepted', 'accepted'],
    ['rejected', 'declined'],
    ['canceled', 'cancelled'],
  ] as const)
    expect(invitationStatus(native, now, now)).toBe(publicStatus);
  expect(() => invitationStatus('unknown', now, now)).toThrow(
    'Invalid invitation status',
  );
});
test('nonpending native states stay denied even before their recorded expiry', () => {
  for (const status of ['rejected', 'canceled', 'expired', 'unknown'])
    expect(
      classifyInvitationAcceptance({
        status,
        expired: false,
        acceptedByUserId: null,
        actorUserId: 'recipient',
        hasMembership: false,
      }),
    ).toBe('deny');
});
