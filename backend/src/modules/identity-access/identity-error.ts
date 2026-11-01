import type { IdentityErrorCode } from '@lexon/contracts';

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    readonly status: number,
  ) {
    super(
      code === 'AUTH_REQUIRED'
        ? 'Authentication required.'
        : code === 'AUTH_UNAVAILABLE'
          ? 'Authentication is temporarily unavailable.'
          : 'Unable to complete the request.',
    );
  }
}
