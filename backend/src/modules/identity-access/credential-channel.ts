import { IdentityError } from './identity-error.js';
export function credentialChannel(
  headers: Headers,
  rawHeaders?: readonly string[],
): 'cookie' | 'bearer' {
  if (rawHeaders)
    for (const name of ['authorization', 'cookie']) {
      let count = 0;
      for (let index = 0; index < rawHeaders.length; index += 2)
        if (rawHeaders[index]?.toLowerCase() === name) count++;
      if (count > 1) throw new IdentityError('AUTH_REQUIRED', 401);
    }
  const authorization = headers.get('authorization');
  const cookie = headers.get('cookie');
  if (
    authorization !== null &&
    (!/^Bearer [^\s,]+$/i.test(authorization) || cookie !== null)
  )
    throw new IdentityError('AUTH_REQUIRED', 401);
  const sessions = (cookie ?? '')
    .split(';')
    .map((value) => value.trim().split('=')[0]!)
    .filter((name) =>
      /^(?:__Secure-|__Host-)?better-auth\.session_token$/.test(name),
    );
  if (sessions.length > 1) throw new IdentityError('AUTH_REQUIRED', 401);
  return authorization !== null ? 'bearer' : 'cookie';
}
