export class AuthLimitError extends Error {
  constructor(
    readonly status: 429 | 503,
    readonly code: 'AUTH_RATE_LIMITED' | 'AUTH_UNAVAILABLE',
  ) {
    super(
      status === 429
        ? 'Too many authentication attempts'
        : 'Authentication unavailable',
    );
  }
}
