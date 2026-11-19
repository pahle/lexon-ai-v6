import { test, expect } from 'vitest';
import { initials } from '../src/lib/initials';

test('initials takes the first letters of the first two words', () => {
  expect(initials('Hukum Nusantara')).toBe('HN');
  expect(initials('Lexon')).toBe('L');
  expect(initials('  a   b  c ')).toBe('AB');
  expect(initials('')).toBe('?');
  expect(initials('   ')).toBe('?');
  expect(initials('Çağrı Öz')).toBe('ÇÖ');
  expect(initials('😀 smile')).toBe('😀S');
});
