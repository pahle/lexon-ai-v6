import { expect, test } from 'vitest';
import { buildAuthorizationPredicate } from '../../src/infrastructure/db/index.js';

test('owned chat authorization keeps owner and deletion scope in its predicate', () => {
  expect(
    buildAuthorizationPredicate({
      scope: 'owned-chat',
      orgId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      excludeDeleted: true,
    }),
  ).toEqual({
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    excludeDeleted: true,
  });
});

test('legacy tenant authorization remains organization-only', () => {
  expect(
    buildAuthorizationPredicate({
      orgId: '11111111-1111-4111-8111-111111111111',
    }),
  ).toEqual({ orgId: '11111111-1111-4111-8111-111111111111' });
});
