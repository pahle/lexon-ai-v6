const pick = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    keys
      .filter(
        (key) =>
          source[key] !== undefined &&
          (source[key] === null ||
            ['string', 'boolean', 'number'].includes(typeof source[key])),
      )
      .map((key) => [key, source[key]]),
  );
};
export function normalizeAuthDestination(
  value: string,
  origin?: string,
): string | null {
  if (/[\r\n\\]/.test(value)) return null;
  if (!origin)
    return value.startsWith('/') && !value.startsWith('//') ? value : null;
  try {
    const target = new URL(value, origin);
    return target.origin === origin && !target.username && !target.password
      ? target.pathname + target.search + target.hash
      : null;
  } catch {
    return null;
  }
}
export async function sanitizeAuthResponse(
  response: Response,
  channel: 'cookie' | 'bearer',
  origin?: string,
): Promise<Response> {
  const headers = new Headers({
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  if (channel === 'cookie')
    for (const cookie of response.headers.getSetCookie()) {
      if (
        /(?:^|;)\s*HttpOnly(?:;|$)/i.test(cookie) &&
        (response.status < 400 || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cookie))
      )
        headers.append('set-cookie', cookie);
    }
  const location = response.headers.get('location');
  if (location) {
    const destination = normalizeAuthDestination(location, origin);
    if (!destination)
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Unable to complete the request.',
          },
        },
        {
          status: 400,
          headers: {
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
          },
        },
      );
    headers.set('location', destination);
  }
  const challenge = response.headers.get('www-authenticate');
  if (challenge && /^Bearer(?: realm="Lexon")?$/.test(challenge))
    headers.set('www-authenticate', challenge);
  if (response.status >= 400)
    return Response.json(
      {
        error: {
          code:
            response.status >= 500
              ? 'AUTH_UNAVAILABLE'
              : response.status === 401 || response.status === 403
                ? 'AUTH_REQUIRED'
                : 'VALIDATION_ERROR',
          message: 'Unable to complete the request.',
        },
      },
      { status: response.status >= 500 ? 503 : response.status, headers },
    );
  if (
    response.status === 204 ||
    (response.status >= 300 && response.status < 400)
  )
    return new Response(null, { status: response.status, headers });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return Response.json(
      {
        error: {
          code: 'AUTH_UNAVAILABLE',
          message: 'Unable to complete the request.',
        },
      },
      { status: 503, headers },
    );
  }
  if (data === null)
    return Response.json(null, { status: response.status, headers });
  const source = (
    data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  ) as Record<string, unknown>;
  const body =
    pick(source, [
      'status',
      'success',
      'redirect',
      'twoFactorRedirect',
      'method',
      'totpURI',
    ]) ?? {};
  if (source.user)
    body.user = pick(source.user, [
      'id',
      'name',
      'email',
      'emailVerified',
      'twoFactorEnabled',
      'onboardingComplete',
      'createdAt',
      'updatedAt',
    ]);
  if (source.session)
    body.session = pick(source.session, [
      'id',
      'channel',
      'createdAt',
      'expiresAt',
      'activeOrganizationId',
    ]);
  if (
    Array.isArray(source.backupCodes) &&
    source.backupCodes.every((code) => typeof code === 'string')
  )
    body.backupCodes = source.backupCodes;
  if (typeof source.url === 'string') {
    const destination = normalizeAuthDestination(source.url, origin);
    if (destination) body.url = destination;
  }
  return Response.json(body, { status: response.status, headers });
}
