import { expect, it } from 'vitest';
import { weakMatch } from '../../src/modules/chat/etag.js';

// RFC 9110 §13.1.2: If-None-Match uses the weak comparison function — a
// comma-separated entity-tag list, W/ ignored on both sides, '*' matching any.
it.each<[string, string | undefined, string, boolean]>([
  ['a matching weak tag against a strong comparator', 'W/"a"', 'W/"a"', true],
  ['a stored weak tag vs a client strong tag', '"a"', 'W/"a"', true],
  ['a stored strong tag vs a client weak tag', 'W/"a"', '"a"', true],
  ['both strong and equal', '"a"', '"a"', true],
  ['a different tag', 'W/"a"', 'W/"b"', false],
  ['a list whose second entry matches', 'W/"x", W/"a"', 'W/"a"', true],
  ['a list whose first entry matches', 'W/"a", W/"b"', 'W/"a"', true],
  ['a list with no match', 'W/"x", W/"b"', 'W/"a"', false],
  ['the any-tag wildcard', '*', 'W/"a"', true],
  ['a wildcard inside a list', 'W/"x", *', 'W/"a"', true],
  ['a list with stray whitespace', '  W/"x" ,  W/"a" ', 'W/"a"', true],
  ['an empty header value', '', 'W/"a"', false],
  ['a missing header value', undefined, 'W/"a"', false],
  [
    'an opaque substring, never a partial match',
    '"v1.ab"',
    'W/"v1.abc"',
    false,
  ],
])('%s', (_name, ifNoneMatch, etag, expected) => {
  expect(weakMatch(ifNoneMatch, etag)).toBe(expected);
});
