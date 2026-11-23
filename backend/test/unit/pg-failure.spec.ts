import { expect, it } from 'vitest';
import {
  isPgStatementTimeout,
  isPgUniqueViolation,
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
