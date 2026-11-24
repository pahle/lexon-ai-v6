export interface PgFailure {
  readonly code?: string;
  readonly constraint?: string;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * SQLSTATE code and constraint of a node-postgres error, when present. Walks
 * the `.cause` chain (bounded at six levels, cycle-safe) and returns the first
 * level whose `code` is a SQLSTATE or that carries a `constraint`; a wrapper's
 * own driver code never hides the wrapped pg failure. When no level qualifies,
 * the top-level `code` is still surfaced for callers that log it.
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
    const code =
      typeof candidate.code === 'string' ? candidate.code : undefined;
    const constraint =
      typeof candidate.constraint === 'string'
        ? candidate.constraint
        : undefined;
    if ((code !== undefined && SQLSTATE.test(code)) || constraint !== undefined)
      return {
        ...(code === undefined ? {} : { code }),
        ...(constraint === undefined ? {} : { constraint }),
      };
    current = candidate.cause;
  }
  const top = error as { code?: unknown } | null;
  return top && typeof top === 'object' && typeof top.code === 'string'
    ? { code: top.code }
    : {};
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
