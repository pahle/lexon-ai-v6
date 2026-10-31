import { Client } from 'pg';

interface DatabaseOptions {
  appUrl: string;
  migratorUrl: string;
}
export async function databaseProbe(
  options: DatabaseOptions,
  value: string,
): Promise<string> {
  const migrator = new Client({ connectionString: options.migratorUrl });
  const app = new Client({ connectionString: options.appUrl });
  try {
    await migrator.connect();
    await app.connect();
    await migrator.query(
      'CREATE TABLE ops.isolation_probe (id integer PRIMARY KEY, value text NOT NULL)',
    );
    await app.query('INSERT INTO ops.isolation_probe VALUES (1, $1)', [value]);
    return (
      await app.query<{ value: string }>(
        'SELECT value FROM ops.isolation_probe WHERE id = 1',
      )
    ).rows[0]!.value;
  } finally {
    await migrator.end();
    await app.end();
  }
}
export async function inspectFoundation(options: DatabaseOptions) {
  const client = new Client({ connectionString: options.migratorUrl });
  try {
    await client.connect();
    const schemas = await client.query<{ name: string; owner: string }>(
      "SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN ('app','auth','ops') ORDER BY nspname",
    );
    const roles = await client.query<{
      name: string;
      superuser: boolean;
      bypassRls: boolean;
      createRole: boolean;
    }>(
      `SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls", rolcreaterole AS "createRole" FROM pg_roles WHERE rolname LIKE 'lexon_%' ORDER BY rolname`,
    );
    const flags = await client.query<{
      extension: boolean;
      appCanAssumeMigrator: boolean;
      appCanAssumeAuth: boolean;
      appAuthUsage: boolean;
    }>(
      `SELECT EXISTS(SELECT FROM pg_extension WHERE extname='pg_trgm') AS extension, pg_has_role('lexon_app','lexon_migrator','SET') AS "appCanAssumeMigrator", pg_has_role('lexon_app','lexon_auth','SET') AS "appCanAssumeAuth", has_schema_privilege('lexon_app','auth','USAGE') AS "appAuthUsage"`,
    );
    const count = await client.query<{ count: string }>(
      'SELECT count(*) FROM drizzle.__drizzle_migrations',
    );
    return {
      schemas: schemas.rows,
      roles: roles.rows,
      ...flags.rows[0]!,
      migrationCount: Number(count.rows[0]!.count),
    };
  } finally {
    await client.end();
  }
}
