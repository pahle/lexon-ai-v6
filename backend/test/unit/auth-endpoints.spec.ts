import { expect, test } from 'vitest';
import {
  classifyAuthEndpoint,
  AUTH_ENDPOINT_MANIFEST,
} from '../../src/modules/identity-access/index.js';

test('only explicit standard method/path pairs are reachable', () => {
  expect(
    AUTH_ENDPOINT_MANIFEST.map((rule) => `${rule.method} ${rule.path}`),
  ).toEqual([
    'POST /sign-up/email',
    'POST /sign-in/email',
    'POST /send-verification-email',
    'GET /verify-email',
    'POST /request-password-reset',
    'GET /reset-password/:token',
    'POST /reset-password',
    'POST /sign-out',
    'GET /get-session',
    'POST /revoke-sessions',
    'POST /revoke-other-sessions',
    'POST /update-user',
    'POST /change-password',
    'POST /change-email',
    'POST /two-factor/enable',
    'POST /two-factor/get-totp-uri',
    'POST /two-factor/verify-totp',
    'POST /two-factor/verify-backup-code',
    'POST /two-factor/disable',
    'POST /two-factor/generate-backup-codes',
  ]);
  expect(classifyAuthEndpoint('POST', '/api/auth/sign-in/email')?.scope).toBe(
    'public',
  );
  expect(
    classifyAuthEndpoint('GET', '/api/auth/reset-password/opaque-token'),
  ).not.toBeNull();
  for (const path of [
    '/organization/create',
    '/admin/impersonate-user',
    '/list-sessions',
    '/revoke-session',
    '/verify-password',
    '/two-factor/send-otp',
  ])
    expect(classifyAuthEndpoint('POST', `/api/auth${path}`)).toBeNull();
});
test('raw aliases and method overrides never reach an allowed route', () => {
  for (const path of [
    '/api/auth/sign-in%2femail',
    '/api/auth/sign-in%252femail',
    '/api/auth/sign-in\\email',
    '/api/auth/../auth/sign-in/email',
    '/api/auth//sign-in/email',
    '/api/auth/sign-in/email/',
    '/api/auth/%73ign-in/email',
  ])
    expect(classifyAuthEndpoint('POST', path)).toBeNull();
  for (const method of ['GET', 'PUT', 'OPTIONS', 'post'])
    expect(classifyAuthEndpoint(method, '/api/auth/sign-in/email')).toBeNull();
});
