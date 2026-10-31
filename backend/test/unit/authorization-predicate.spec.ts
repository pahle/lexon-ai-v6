import { expect, it } from 'vitest';
import { buildAuthorizationPredicate } from '../../src/infrastructure/db/index.js';

it('always requires a valid organization for its filter', () => {
  expect(() => buildAuthorizationPredicate({ orgId: '' })).toThrow('orgId');
  expect(() => buildAuthorizationPredicate({ orgId: 'not-a-uuid' })).toThrow(
    'orgId',
  );
  expect(
    buildAuthorizationPredicate({
      orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
  ).toEqual({ orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
});
