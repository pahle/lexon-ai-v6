import { sql, type SQL } from 'drizzle-orm';

// A facet value outside its enum is a client error: the error filter's
// clientStatus path maps the 400 to VALIDATION_ERROR. `statusCode` is the
// channel precisely because this file cannot import the domain's
// IdentityError (lexon/boundaries: infrastructure never depends on modules),
// and better-auth's APIError cannot be used either — importing it here would
// drag the auth vendor graph into every barrel consumer (the
// run-authorization boot trace forbids it). The message never echoes the
// rejected value.
export class PlatformReadFilterError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('Invalid platform filter');
  }
}

/**
 * Renders a `(string | boolean)[]` facet as a PostgreSQL array literal bound
 * parameter with the given cast, or a typed NULL. Defence in depth: values
 * are bound parameters, but the membership check still rejects any value
 * outside the facet enum before the literal is built, and `"`/`\` are escaped
 * so the rendered text is exactly what PostgreSQL parses as the given
 * elements.
 */
export function pgArray(
  values: (string | boolean)[] | null,
  cast: string,
  allowed: readonly (string | boolean)[],
): SQL {
  if (values === null) return sql`${null}::${sql.raw(cast)}`;
  for (const value of values)
    if (!allowed.includes(value)) throw new PlatformReadFilterError();
  const literal = `{${values
    .map(
      (v) => `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
    )
    .join(',')}}`;
  return sql`${literal}::${sql.raw(cast)}`;
}
