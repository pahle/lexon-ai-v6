import { expect, it } from 'vitest';
import {
  isPgStatementTimeout,
  isPgUniqueViolation,
  isRetryableAuthError,
  pgFailure,
} from '../../src/infrastructure/db/index.js';

it('reads the SQLSTATE code and constraint of a pg error', () => {
  expect(pgFailure({ code: '23505', constraint: 'chats_pkey' })).toEqual({
    code: '23505',
    constraint: 'chats_pkey',
  });
  expect(pgFailure({ code: 57014, constraint: null })).toEqual({});
  for (const error of [undefined, null, 'boom', 23505, new Error('x')])
    expect(pgFailure(error)).toEqual({});
});

it('walks the cause chain and returns the first code or constraint found', () => {
  expect(pgFailure({ cause: { code: '40001' } })).toEqual({ code: '40001' });
  expect(
    pgFailure(new Error('wrap', { cause: { code: '40P01', constraint: 'c' } })),
  ).toEqual({ code: '40P01', constraint: 'c' });
  expect(pgFailure({ cause: { cause: { cause: { code: '40001' } } } })).toEqual(
    { code: '40001' },
  );
  // The top level still counts and wins over a deeper code.
  expect(pgFailure({ code: '23505', cause: { code: '40001' } })).toEqual({
    code: '23505',
  });
  // A non-string code does not count; the walk continues to the cause.
  expect(pgFailure({ code: 40001, cause: { code: '40P01' } })).toEqual({
    code: '40P01',
  });
});

it('prefers the first level carrying a SQLSTATE or a constraint over a wrapper code', () => {
  // A non-SQLSTATE wrapper code must not hide the wrapped driver failure.
  expect(pgFailure({ code: 'ERR_WRAPPED', cause: { code: '40001' } })).toEqual({
    code: '40001',
  });
  expect(
    isRetryableAuthError({ code: 'ERR_WRAPPED', cause: { code: '40001' } }),
  ).toBe(true);
  expect(
    pgFailure({
      code: 'ERR_WRAPPED',
      cause: { constraint: 'lexon_team_owner' },
    }),
  ).toEqual({ constraint: 'lexon_team_owner' });
  // A qualifying level wins even when a deeper level also carries a code.
  expect(
    pgFailure({ cause: { constraint: 'c', cause: { code: '40001' } } }),
  ).toEqual({ constraint: 'c' });
  expect(
    pgFailure({
      code: 'ERR_WRAPPED',
      cause: { code: '40P01', constraint: 'c' },
    }),
  ).toEqual({ code: '40P01', constraint: 'c' });
});

it('falls back to the top-level driver code when no level qualifies', () => {
  expect(pgFailure({ code: 'ECONNREFUSED' })).toEqual({ code: 'ECONNREFUSED' });
  expect(
    pgFailure({ code: 'ERR_WRAPPED', cause: { code: 'ERR_INNER' } }),
  ).toEqual({ code: 'ERR_WRAPPED' });
  // The fallback reads the top level only: a nested non-SQLSTATE code is not
  // surfaced as a pg failure.
  expect(pgFailure({ cause: { code: 'ECONNREFUSED' } })).toEqual({});
});

it('is bounded at six chain levels and safe on cycles', () => {
  // A code at depth 6 is out of reach; at depth 5 it is still read.
  let outOfReach: object = { code: '40001' };
  for (let i = 0; i < 6; i++) outOfReach = { cause: outOfReach };
  expect(pgFailure(outOfReach)).toEqual({});
  let inReach: object = { code: '40P01' };
  for (let i = 0; i < 5; i++) inReach = { cause: inReach };
  expect(pgFailure(inReach)).toEqual({ code: '40P01' });
  const self: { cause?: unknown } = {};
  self.cause = self;
  expect(pgFailure(self)).toEqual({});
  const first: { cause?: unknown } = {};
  const second: { cause?: unknown; code?: string } = { cause: first };
  first.cause = second;
  second.code = '40001';
  expect(pgFailure(first)).toEqual({ code: '40001' });
});

it('matches a unique violation on an expected constraint only', () => {
  const error = { code: '23505', constraint: 'chats_pkey' };
  expect(isPgUniqueViolation(error, ['chats_pkey'])).toBe(true);
  expect(isPgUniqueViolation(error, ['chat_messages_pkey'])).toBe(false);
  expect(isPgUniqueViolation({ code: '23505' }, ['chats_pkey'])).toBe(false);
  expect(
    isPgUniqueViolation({ code: '23503', constraint: 'chats_pkey' }, [
      'chats_pkey',
    ]),
  ).toBe(false);
});

it('recognises a statement timeout', () => {
  expect(isPgStatementTimeout({ code: '57014' })).toBe(true);
  expect(isPgStatementTimeout({ code: '57P01' })).toBe(false);
  expect(isPgStatementTimeout(new Error('canceling statement'))).toBe(false);
});
