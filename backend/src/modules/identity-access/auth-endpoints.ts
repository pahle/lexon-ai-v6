import type { AuthLimitAction } from '../../infrastructure/queue/index.js';

export interface AuthEndpointRule {
  method: 'GET' | 'POST';
  path: string;
  scope: 'public' | 'challenge' | 'own-security';
  action: AuthLimitAction | null;
}
export const AUTH_ENDPOINT_MANIFEST: readonly AuthEndpointRule[] = [
  { method: 'POST', path: '/sign-up/email', scope: 'public', action: 'signup' },
  { method: 'POST', path: '/sign-in/email', scope: 'public', action: 'signin' },
  {
    method: 'POST',
    path: '/send-verification-email',
    scope: 'public',
    action: 'verification-resend',
  },
  {
    method: 'GET',
    path: '/verify-email',
    scope: 'public',
    action: 'verification-resend',
  },
  {
    method: 'POST',
    path: '/request-password-reset',
    scope: 'public',
    action: 'reset',
  },
  {
    method: 'GET',
    path: '/reset-password/:token',
    scope: 'public',
    action: 'reset',
  },
  { method: 'POST', path: '/reset-password', scope: 'public', action: 'reset' },
  { method: 'POST', path: '/sign-out', scope: 'own-security', action: null },
  { method: 'GET', path: '/get-session', scope: 'own-security', action: null },
  {
    method: 'POST',
    path: '/revoke-sessions',
    scope: 'own-security',
    action: 'signin',
  },
  {
    method: 'POST',
    path: '/revoke-other-sessions',
    scope: 'own-security',
    action: 'signin',
  },
  {
    method: 'POST',
    path: '/update-user',
    scope: 'own-security',
    action: 'signin',
  },
  {
    method: 'POST',
    path: '/change-password',
    scope: 'own-security',
    action: 'reset',
  },
  {
    method: 'POST',
    path: '/change-email',
    scope: 'own-security',
    action: 'verification-resend',
  },
  {
    method: 'POST',
    path: '/two-factor/enable',
    scope: 'own-security',
    action: 'totp',
  },
  {
    method: 'POST',
    path: '/two-factor/get-totp-uri',
    scope: 'own-security',
    action: 'totp',
  },
  {
    method: 'POST',
    path: '/two-factor/verify-totp',
    scope: 'challenge',
    action: 'totp',
  },
  {
    method: 'POST',
    path: '/two-factor/verify-backup-code',
    scope: 'challenge',
    action: 'recovery',
  },
  {
    method: 'POST',
    path: '/two-factor/disable',
    scope: 'own-security',
    action: 'totp',
  },
  {
    method: 'POST',
    path: '/two-factor/generate-backup-codes',
    scope: 'own-security',
    action: 'recovery',
  },
];
export function classifyAuthEndpoint(
  method: string,
  rawPath: string,
): AuthEndpointRule | null {
  const path = rawPath.split('?')[0]!;
  if (
    path.length > 8192 ||
    path.includes('%') ||
    path.includes('\\') ||
    [...path].some((char) => char.charCodeAt(0) <= 32) ||
    path.includes('//') ||
    path.split('/').some((part) => part === '.' || part === '..')
  )
    return null;
  if (!path.startsWith('/api/auth/')) return null;
  const relative = path.slice('/api/auth'.length);
  return (
    AUTH_ENDPOINT_MANIFEST.find(
      (rule) =>
        rule.method === method &&
        (rule.path === relative ||
          (rule.path === '/reset-password/:token' &&
            /^\/reset-password\/[A-Za-z0-9._~-]{1,4096}$/.test(relative))),
    ) ?? null
  );
}
