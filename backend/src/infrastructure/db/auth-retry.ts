import { pgFailure } from './pg-failure.js';

/** Postgres serialization failure and deadlock SQLSTATEs worth one retry. */
export function isRetryableAuthError(error: unknown): boolean {
  const { code } = pgFailure(error);
  return code === '40001' || code === '40P01';
}

export interface AuthRetryOptions {
  /** Total attempts including the first; defaults to 3. */
  attempts?: number;
  /** Whether a failure may be retried while attempts remain. */
  retryable: (error: unknown) => boolean;
  /**
   * Maps a terminal failure — a non-retryable error, or a retryable one after
   * the last attempt — to the value thrown. Callers map to
   * `IdentityError('AUTH_UNAVAILABLE', 503)` on retry exhaustion; a missing
   * or `undefined` result rethrows the original error.
   */
  map?: (error: unknown) => unknown;
}

/** Runs `work` inside the bounded retry loop shared by the auth ports. */
export async function withAuthRetry<T>(
  work: () => Promise<T>,
  options: AuthRetryOptions,
): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt + 1 >= attempts || !options.retryable(error))
        throw options.map?.(error) ?? error;
    }
  }
}
