import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();

/**
 * Renders a drizzle SQL fragment as PostgreSQL text plus its bound parameter
 * values, so unit specs can assert the exact literal a driver would send.
 */
export function renderSql(query: SQL) {
  return dialect.sqlToQuery(query);
}
