import { expect, test } from 'vitest';
import { PaginationSchema } from '../src/pagination.js';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Characterisation: PaginationSchema is the bound every paging service applies
// to controller-supplied input (F4.4 task 6). It pins the contract the new
// PaginationQuerySchema may tighten at the controller boundary without changing
// observable outcomes: every value rejected below already fails end-to-end.
test('limit defaults to 20 and accepts pre-coerced numbers in 1..100', () => {
  expect(PaginationSchema.parse({})).toEqual({ limit: 20 });
  expect(PaginationSchema.parse({ limit: 5 })).toEqual({ limit: 5 });
  expect(PaginationSchema.parse({ limit: 100 })).toEqual({ limit: 100 });
});

test('limit must be an integer between 1 and 100', () => {
  for (const limit of [0, -3, 101, 5.5, Number.NaN, '5', 'abc']) {
    expect(PaginationSchema.safeParse({ limit }).success).toBe(false);
  }
});

test('cursor must be a uuid when present', () => {
  expect(PaginationSchema.parse({ cursor: uuid })).toEqual({
    limit: 20,
    cursor: uuid,
  });
  for (const cursor of ['nope', '', 5]) {
    expect(PaginationSchema.safeParse({ cursor }).success).toBe(false);
  }
});

test('the page object is strict', () => {
  expect(PaginationSchema.safeParse({ limit: 5, extra: 1 }).success).toBe(
    false,
  );
});
