import { expect, test } from 'vitest';
import { escapeLike } from '../../src/modules/platform-console/search-escape.js';

test('escapeLike escapes percent, underscore and backslash', () => {
  expect(escapeLike('50%_\\')).toBe('50\\%\\_\\\\');
});
