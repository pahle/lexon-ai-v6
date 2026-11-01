import { expect, test } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';
import { safeReturnPath } from '../src/lib/return-path';
test('return paths reject external and encoded authority escapes', () => {
  for (const input of [
    null,
    'https://other.test',
    '//other.test',
    '/\\other.test',
    '/%2f%2fother.test',
    '/%5cother.test',
    '/workspace%0d%0aX:test',
  ])
    expect(safeReturnPath(input)).toBe('/workspace');
  expect(safeReturnPath('/workspace/security?tab=sessions')).toBe(
    '/workspace/security?tab=sessions',
  );
});
test('proxy checks cookie presence only and excludes public liveness', () => {
  expect(
    proxy(new NextRequest('http://localhost/workspace'))?.headers.get(
      'location',
    ),
  ).toContain('/sign-in');
  const headers = { cookie: 'better-auth.session_token=opaque-unverified' };
  expect(
    proxy(
      new NextRequest('http://localhost/sign-in', { headers }),
    )?.headers.get('location'),
  ).toBe('http://localhost/workspace');
  expect(
    proxy(new NextRequest('http://localhost/health'))?.headers.get('location'),
  ).toBeNull();
});
