export interface PgFailure {
  readonly code?: string;
  readonly constraint?: string;
}

/** SQLSTATE code and constraint of a node-postgres error, when present. */
export function pgFailure(error: unknown): PgFailure {
  if (typeof error !== 'object' || error === null) return {};
  const { code, constraint } = error as {
    code?: unknown;
    constraint?: unknown;
  };
  return {
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof constraint === 'string' ? { constraint } : {}),
  };
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
