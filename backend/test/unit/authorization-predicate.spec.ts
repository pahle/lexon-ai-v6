import { validateTenantContext } from '../../src/infrastructure/db/testing/tenant-context.js';
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

it('returns only a frozen tenant filter and rejects missing context/user IDs', () => {
  const ctx = {
    orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  };
  const result = buildAuthorizationPredicate(ctx);
  expect(Object.keys(result)).toEqual(['orgId']);
  expect(Object.isFrozen(result)).toBe(true);
  expect(() => Object.assign(result, { orgId: 'changed' })).toThrow(TypeError);
  for (const value of [
    undefined,
    null,
    {},
    { orgId: ctx.orgId, userId: 'secret' },
  ])
    expect(() => buildAuthorizationPredicate(value as typeof ctx)).toThrow(
      'Invalid tenant context',
    );
});

it('retains validated user context, omits absent user keys, and reports only invalid field names', () => {
  const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const context = validateTenantContext({ orgId, userId });
  expect(context).toStrictEqual({ orgId, userId });
  expect(Object.isFrozen(context)).toBe(true);
  expect(validateTenantContext({ orgId })).toStrictEqual({ orgId });
  expect(Object.hasOwn(validateTenantContext({ orgId }), 'userId')).toBe(false);
  expect(() =>
    validateTenantContext({ orgId: 'secret-org', userId: 'secret-user' }),
  ).toThrow(/^Invalid tenant context: orgId, userId$/);
});
