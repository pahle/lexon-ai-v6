import { expect, test } from 'vitest';
import {
  sanitizeAuthResponse,
  sanitizeVerifiedSigninFailure,
} from '../../src/modules/identity-access/auth-output.js';

test('cookie output projects safe native data and preserves only HttpOnly cookies', async () => {
  const response = await sanitizeAuthResponse(
    Response.json(
      {
        token: 'body-secret',
        session: {
          id: 'session',
          token: 'body-secret',
          ipAddress: '127.0.0.1',
          userAgent: 'private',
          createdAt: '2026-11-01T00:00:00.000Z',
          expiresAt: '2026-11-08T00:00:00.000Z',
        },
        user: {
          id: 'user',
          name: 'Person',
          email: 'person@example.test',
          emailVerified: true,
          password: 'body-secret',
          role: 'admin',
        },
        extra: { token: 'body-secret' },
      },
      {
        headers: {
          'set-cookie':
            'better-auth.session_token=cookie-secret; Path=/; HttpOnly; SameSite=Lax',
          'set-auth-token': 'header-secret',
          'x-error-detail': 'header-secret',
        },
      },
    ),
    'cookie',
  );
  const body = await response.text();
  const leaked = ['body-secret', '127.0.0.1', 'private'].some((value) =>
    body.includes(value),
  );
  expect(leaked).toBe(false);
  expect(JSON.parse(body).user.id).toBe('user');
  expect(response.headers.has('set-auth-token')).toBe(false);
  expect(response.headers.has('x-error-detail')).toBe(false);
  expect(response.headers.get('set-cookie')?.includes('HttpOnly')).toBe(true);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const bearer = await sanitizeAuthResponse(
    Response.json(
      { token: 'body-secret' },
      {
        headers: {
          'set-cookie': 'session=cookie-secret; HttpOnly',
          'set-auth-token': 'header-secret',
        },
      },
    ),
    'bearer',
  );
  expect(bearer.headers.has('set-cookie')).toBe(false);
  expect(bearer.headers.has('set-auth-token')).toBe(false);
});

test('native absolute redirects stay on the configured origin', async () => {
  const response = await sanitizeAuthResponse(
    Response.redirect('https://lexon.example/verified', 302),
    'cookie',
    'https://lexon.example',
  );
  expect(response.headers.get('location')).toBe('/verified');
  const body = await sanitizeAuthResponse(
    Response.json({ redirect: true, url: 'https://lexon.example/workspace' }),
    'cookie',
    'https://lexon.example',
  );
  expect((await body.json()).url).toBe('/workspace');
});
test('native errors and unsafe cookies never return plugin details', async () => {
  const response = await sanitizeAuthResponse(
    Response.json(
      {
        message: 'error-secret',
        code: 'EMAIL_ALREADY_EXISTS',
        token: 'error-secret',
      },
      { status: 400, headers: { 'set-cookie': 'leak=error-secret; Path=/' } },
    ),
    'cookie',
  );
  const body = await response.text();
  expect(
    ['error-secret', 'EMAIL_ALREADY_EXISTS'].some((value) =>
      body.includes(value),
    ),
  ).toBe(false);
  expect(response.headers.has('set-cookie')).toBe(false);
  const failedCookie = await sanitizeAuthResponse(
    Response.json(
      { message: 'error-secret' },
      {
        status: 400,
        headers: {
          'set-cookie':
            'better-auth.session_token=uncommitted-secret; HttpOnly; Path=/',
        },
      },
    ),
    'cookie',
  );
  expect(failedCookie.headers.has('set-cookie')).toBe(false);
});

test('only the exact password-checked email verification error survives sanitization', async () => {
  const accepted = await sanitizeVerifiedSigninFailure(
    Response.json(
      {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'private native detail',
        email: 'person@example.test',
      },
      {
        status: 403,
        headers: {
          'set-cookie': 'session=uncommitted; HttpOnly; Path=/',
          'x-private': 'private native detail',
        },
      },
    ),
  );
  expect(accepted?.status).toBe(403);
  expect(await accepted?.json()).toEqual({
    error: {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Verify your email address before signing in.',
    },
  });
  expect(accepted?.headers.getSetCookie()).toEqual([]);
  expect(accepted?.headers.get('cache-control')).toBe('no-store');
  for (const response of [
    Response.json({ code: 'EMAIL_NOT_VERIFIED' }, { status: 401 }),
    Response.json({ code: 'AUTH_REQUIRED' }, { status: 403 }),
    Response.json({ error: { code: 'EMAIL_NOT_VERIFIED' } }, { status: 403 }),
  ])
    expect(await sanitizeVerifiedSigninFailure(response)).toBeNull();
});
