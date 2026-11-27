import { expect, it } from 'vitest';
import { validateTenantContext } from '../../src/infrastructure/db/testing/tenant-context.js';
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

it('owned chat authorization keeps owner and deletion scope in its predicate', () => {
  const scope = buildAuthorizationPredicate({
    scope: 'owned-chat',
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    excludeDeleted: true,
  });
  expect(scope).toEqual({
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    excludeDeleted: true,
    where: expect.any(Function),
  });
});

it('owned chat where emits the owner arm with the project-access disjunction', () => {
  const scope = buildAuthorizationPredicate({
    scope: 'owned-chat',
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    excludeDeleted: true,
  });
  // Spec §4.1: owner_user_id = $user AND (project_id IS NULL OR
  // lexon_project_access <> 'none') — a denied or removed member loses their
  // own project chats on every owner-scoped path.
  expect(scope.where('c', '$1', '$2')).toBe(
    'c.org_id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL ' +
      "AND (c.project_id IS NULL OR ops.lexon_project_access(c.org_id,c.project_id,$2)<>'none')",
  );
});

it('chat read where emits the full §4.1 predicate (owner, project access, share, deny-wins)', () => {
  const scope = buildAuthorizationPredicate({
    scope: 'chat-read',
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    excludeDeleted: true,
  });
  expect(scope).toEqual({
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    excludeDeleted: true,
    where: expect.any(Function),
  });
  expect(Object.isFrozen(scope)).toBe(true);
  expect(scope.where('c', '$1', '$2')).toBe(
    'c.org_id=$1 AND c.deleted_at IS NULL AND ops.lexon_org_member(c.org_id,$2) ' +
      'AND ((c.project_id IS NULL AND (c.owner_user_id=$2 OR EXISTS (SELECT 1 FROM app.chat_shares s ' +
      'WHERE s.org_id=c.org_id AND s.chat_id=c.id AND s.user_id=$2))) ' +
      'OR (c.project_id IS NOT NULL ' +
      "AND ops.lexon_project_access(c.org_id,c.project_id,$2)<>'none'))",
  );
  // Alias and placeholders are caller-supplied so the fragment composes into
  // queries whose parameter order differs.
  expect(scope.where('chat', '$3', '$7')).toContain('chat.org_id=$3');
  expect(scope.where('chat', '$3', '$7')).toContain('s.user_id=$7');
});

it('shared chat where emits the standalone share arm only (never project chats, never own)', () => {
  const scope = buildAuthorizationPredicate({
    scope: 'shared-chat',
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    excludeDeleted: true,
  });
  expect(scope.where('chat', '$1', '$2')).toBe(
    'chat.org_id=$1 AND chat.deleted_at IS NULL AND chat.project_id IS NULL ' +
      'AND chat.owner_user_id<>$2 ' +
      'AND EXISTS (SELECT 1 FROM app.chat_shares s ' +
      'WHERE s.org_id=chat.org_id AND s.chat_id=chat.id AND s.user_id=$2)',
  );
});

it('chat scope builders reject malformed bags and unknown scope kinds', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  for (const scope of ['chat-read', 'shared-chat'] as const) {
    expect(() =>
      buildAuthorizationPredicate({
        scope,
        orgId,
        userId,
        excludeDeleted: true,
      }),
    ).not.toThrow();
    expect(() =>
      buildAuthorizationPredicate({
        scope,
        orgId,
        excludeDeleted: true,
      } as never),
    ).toThrow('userId');
    expect(() =>
      buildAuthorizationPredicate({
        scope,
        orgId,
        userId,
        excludeDeleted: false,
      } as never),
    ).toThrow();
    expect(() =>
      buildAuthorizationPredicate({
        scope,
        orgId,
        userId,
        excludeDeleted: true,
        extra: 'nope',
      } as never),
    ).toThrow();
  }
  expect(() =>
    buildAuthorizationPredicate({
      scope: 'any-chat',
      orgId,
      userId,
      excludeDeleted: true,
    } as never),
  ).toThrow();
});

it('legacy tenant authorization remains organization-only', () => {
  expect(
    buildAuthorizationPredicate({
      orgId: '11111111-1111-4111-8111-111111111111',
    }),
  ).toEqual({ orgId: '11111111-1111-4111-8111-111111111111' });
});
