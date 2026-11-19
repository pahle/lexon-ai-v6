import { Pool } from 'pg';

/** A-17 catalog and no-context checks over every table in the app schema. */
export function createRlsInspector(options: {
  appUrl: string;
  migratorUrl: string;
}) {
  const app = new Pool({ connectionString: options.appUrl });
  const migrator = new Pool({ connectionString: options.migratorUrl });
  const count = async (pool: Pool, table: string) =>
    Number(
      (
        await pool.query<{ count: string }>(
          `SELECT count(*) FROM app."${table}"`,
        )
      ).rows[0]!.count,
    );
  return {
    async unfencedTables() {
      return (
        await migrator.query<{ relname: string }>(
          `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='app' AND c.relkind='r'
             AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
           ORDER BY c.relname`,
        )
      ).rows.map((row) => row.relname);
    },
    async tableCount() {
      return (
        await migrator.query(
          `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='app' AND c.relkind='r'`,
        )
      ).rowCount;
    },
    /** Per table: rows the owner sees, and rows an app session without the tenant GUC sees. */
    async visibility() {
      const tables = (
        await migrator.query<{ relname: string }>(
          `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='app' AND c.relkind='r' ORDER BY c.relname`,
        )
      ).rows.map((row) => row.relname);
      const result: Record<string, { owner: number; noContext: number }> = {};
      for (const table of tables)
        result[table] = {
          owner: await count(migrator, table),
          noContext: await count(app, table),
        };
      return result;
    },
    async close() {
      await Promise.all([app.end(), migrator.end()]);
    },
  };
}
