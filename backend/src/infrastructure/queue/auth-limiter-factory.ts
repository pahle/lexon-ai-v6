import type { AuthLimiter, AuthLimiterOptions } from './auth-limiter.js';

// Workers use this barrel too; only the API composition invokes this factory.
export async function createAuthLimiter(
  options: AuthLimiterOptions,
): Promise<AuthLimiter> {
  const { AuthLimiter } = await import('./auth-limiter.js');
  return AuthLimiter.create(options);
}
