import { expect, test } from 'vitest';
import {
  assertVerifiedIdentity,
  withVerifiedIdentity,
  type VerifiedIdentity,
} from '../../src/modules/identity-access/identity.types.js';

test('verified identity is request-bound and cannot be forged or reused', async () => {
  const facts = {
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    activeOrganizationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    channel: 'cookie' as const,
    platformAdmin: false,
    mfaVerifiedAt: null,
    reauthenticatedAt: null,
  };
  expect(() => assertVerifiedIdentity(facts as VerifiedIdentity)).toThrow();
  let captured: VerifiedIdentity | undefined;
  await withVerifiedIdentity(facts, async (identity) => {
    captured = identity;
    expect(() => assertVerifiedIdentity(identity)).not.toThrow();
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.keys(identity)).toEqual(Object.keys(facts));
  });
  expect(() => assertVerifiedIdentity(captured!)).toThrow();
});
