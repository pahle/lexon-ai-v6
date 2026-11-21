import type { IdentityErrorCode } from '@lexon/contracts';

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    readonly status: number,
    readonly issues?: { path: string; message: string }[],
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

const SLUG_TAKEN_CODES = new Set([
  'ORGANIZATION_ALREADY_EXISTS',
  'ORGANIZATION_SLUG_ALREADY_TAKEN',
]);

/**
 * Maps a slug conflict to ORG_SLUG_TAKEN (409): the Better Auth pre-checks
 * (research R1a, R1b) and the raw unique violation of a lost race (R1c).
 */
export function mapSlugConflict(error: unknown): IdentityError | null {
  const seen = new Set<unknown>();
  let current = error;
  for (
    let depth = 0;
    depth < 6 && current && typeof current === 'object' && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      body?: { code?: unknown };
      cause?: unknown;
    };
    if (
      (typeof candidate.body?.code === 'string' &&
        SLUG_TAKEN_CODES.has(candidate.body.code)) ||
      (candidate.code === '23505' &&
        candidate.constraint === 'organization_slug_unique')
    )
      return new IdentityError('ORG_SLUG_TAKEN', 409);
    current = candidate.cause;
  }
  return null;
}
