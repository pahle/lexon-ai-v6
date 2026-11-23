// Ruling P2: an outage on an identity-serving route reports AUTH_UNAVAILABLE;
// the same outage anywhere else is the neutral SERVICE_UNAVAILABLE. The
// prefixes are whole path segments under the global /api prefix: a route is
// identity when it equals a prefix or sits below one.
export const IDENTITY_PREFIXES = [
  '/api/identity',
  '/api/organizations',
  '/api/invitations',
  '/api/platform',
  '/api/auth',
] as const;

export type RouteFamily = 'identity' | 'service';

export function routeFamily(path: string): RouteFamily {
  // Express matches routes case-insensitively, so the classification does too.
  const route = (path.split('?', 1)[0] ?? '').toLowerCase();
  return IDENTITY_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(prefix + '/'),
  )
    ? 'identity'
    : 'service';
}
