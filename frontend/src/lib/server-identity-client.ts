import { buildIdentityClient } from './identity-client';
export function createServerIdentityClient(options: {
  cookie: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}) {
  const url = new URL(
    options.baseUrl ??
      process.env.BACKEND_INTERNAL_URL ??
      'http://api:3001/api',
  );
  if (!url.pathname.endsWith('/api'))
    url.pathname = url.pathname.replace(/\/$/, '') + '/api';
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid backend URL');
  return buildIdentityClient(
    {
      baseUrl: url.toString().replace(/\/$/, ''),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
    options.cookie,
  );
}
