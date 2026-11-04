import { expect, test } from 'vitest';
import { NextRequest } from 'next/server';
import { config, proxy } from '../src/proxy';
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

test.each([
  ['/workspace', '/workspace?from=home'],
  ['/workspace/files', '/workspace/files?from=home'],
  ['/platform', '/platform?from=home'],
  ['/platform/users', '/platform/users?from=home'],
  ['/onboarding', '/onboarding?from=home'],
  ['/onboarding/profile', '/onboarding/profile?from=home'],
])(
  'redirects signed-out shell route %s and retains the query',
  (path, expectedReturnTo) => {
    const response = proxy(
      new NextRequest(`http://localhost${path}?from=home`),
    );
    const location = new URL(
      response?.headers.get('location') ?? 'http://localhost',
    );

    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('returnTo')).toBe(expectedReturnTo);
  },
);

test.each(['/workspace', '/platform/users', '/onboarding/profile'])(
  'passes shell route %s when a session cookie is present',
  (path) => {
    expect(
      proxy(
        new NextRequest(`http://localhost${path}`, {
          headers: { cookie: 'better-auth.session_token=opaque-unverified' },
        }),
      )?.headers.get('location'),
    ).toBeNull();
  },
);

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
    proxy(
      new NextRequest('http://localhost/sign-up', { headers }),
    )?.headers.get('location'),
  ).toBe('http://localhost/workspace');
  expect(
    proxy(new NextRequest('http://localhost/health'))?.headers.get('location'),
  ).toBeNull();
  expect(
    proxy(new NextRequest('http://localhost/settings'))?.headers.get(
      'location',
    ),
  ).toBeNull();
});

test.each([
  '/workspaceish',
  '/organizations-archive',
  '/platform-admin',
  '/onboarding-next',
])('does not protect prefix lookalike %s', (path) => {
  expect(
    proxy(new NextRequest(`http://localhost${path}`))?.headers.get('location'),
  ).toBeNull();
});

test('matcher covers each shell root and its descendants', () => {
  expect(config.matcher).toEqual([
    '/workspace/:path*',
    '/platform/:path*',
    '/onboarding/:path*',
    '/sign-in',
    '/sign-up',
  ]);
});

test('retired organization URLs pass through without proxy auth redirection', () => {
  const response = proxy(
    new NextRequest('http://localhost/organizations/acme/settings/members'),
  );
  expect(response?.headers.get('location')).toBeNull();
  expect(response?.headers.get('x-middleware-next')).toBe('1');
});
