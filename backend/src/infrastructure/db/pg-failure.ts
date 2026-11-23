export interface PgFailure {
  readonly code?: string;
  readonly constraint?: string;
}

/**
 * SQLSTATE code and constraint of a node-postgres error, when present. Walks
 * the `.cause` chain (bounded at six levels, cycle-safe) and returns the first
 * level where a `code` or `constraint` is found; the top level still counts.
 */
export function pgFailure(error: unknown): PgFailure {
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
      cause?: unknown;
    };
    const failure = {
      ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
      ...(typeof candidate.constraint === 'string'
        ? { constraint: candidate.constraint }
        : {}),
    };
    if (failure.code !== undefined || failure.constraint !== undefined)
      return failure;
    current = candidate.cause;
  }
  return {};
}

export function isPgUniqueViolation(
  error: unknown,
  constraints: readonly string[],
): boolean {
  const { code, constraint } = pgFailure(error);
  return (
    code === '23505' &&
    constraint !== undefined &&
    constraints.includes(constraint)
  );
}

export function isPgStatementTimeout(error: unknown): boolean {
  return pgFailure(error).code === '57014';
}
