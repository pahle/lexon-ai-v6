import { Client } from 'pg';

export interface BootstrapOptions {
  adminUrl: string;
  databaseName: string;
  migratorPassword: string;
}
export async function bootstrapDatabase(
  options: BootstrapOptions,
): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(options.databaseName))
    throw new Error('Invalid database name');
  const client = new Client({ connectionString: options.adminUrl });
  try {
    await client.connect();
    const existing = await client.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      ['lexon_migrator'],
    );
    if (!existing.rowCount) {
      const query = await client.query<{ sql: string }>(
        "SELECT format('CREATE ROLE lexon_migrator LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE NOINHERIT PASSWORD %L', $1::text) AS sql",
        [options.migratorPassword],
      );
      await client.query(query.rows[0]!.sql);
    }
    const database = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [options.databaseName],
    );
    if (!database.rowCount)
      await client.query(
        `CREATE DATABASE "${options.databaseName}" OWNER lexon_migrator`,
      );
  } catch {
    throw new Error('Database bootstrap failed');
  } finally {
    await client.end();
  }
}

export async function configureRuntimeRolePasswords(
  migratorUrl: string,
  secrets: {
    appPassword: string;
    authPassword: string;
    setupPassword?: string;
  },
): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    for (const [name, password] of [
      ['lexon_app', secrets.appPassword],
      ['lexon_auth', secrets.authPassword],
      ...(secrets.setupPassword
        ? [['lexon_setup', secrets.setupPassword]]
        : []),
    ]) {
      const query = await client.query<{ sql: string }>(
        "SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS sql",
        [name, password],
      );
      await client.query(query.rows[0]!.sql);
    }
  } catch {
    throw new Error('Runtime role credential configuration failed');
  } finally {
    await client.end();
  }
}
