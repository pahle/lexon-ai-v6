import { createFoundationClient } from './foundation-client';
// Imported only by Server Components; the browser client receives no internal URL.
export function createServerFoundationClient(
  options: { backendUrl?: string; fetch?: typeof fetch } = {},
) {
  const backend =
    options.backendUrl ??
    process.env.BACKEND_INTERNAL_URL ??
    'http://localhost:3001';
  return createFoundationClient({
    baseUrl: backend.replace(/\/$/, '') + '/api',
    fetch: (input, init) =>
      (options.fetch ?? globalThis.fetch)(input, {
        ...init,
        cache: 'no-store',
        signal: AbortSignal.timeout(1000),
      }),
  });
}
