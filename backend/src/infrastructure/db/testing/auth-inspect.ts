import { Pool } from 'pg';

export function createAuthInspector(options: {
  authUrl: string;
  migratorUrl: string;
}) {
  const migrator = new Pool({ connectionString: options.migratorUrl });
  const auth = new Pool({ connectionString: options.authUrl });
  let commitFault = false;
  async function count(query: string, value: string) {
    const result = await migrator.query<{ count: string }>(query, [value]);
    return Number(result.rows[0]!.count);
  }
  return {
    countUsers: (email: string) =>
      count('SELECT count(*) FROM auth."user" WHERE email = $1', email),
    countOrganizations: (slug: string) =>
      count('SELECT count(*) FROM auth.organization WHERE slug = $1', slug),
    countTwoFactors: (id: string) =>
      count('SELECT count(*) FROM auth.two_factor WHERE user_id = $1', id),
    countSessions: (email: string) =>
      count(
        'SELECT count(*) FROM auth.session s JOIN auth."user" u ON s.user_id = u.id WHERE u.email = $1',
        email,
      ),
    async storage() {
      const tables = await auth.query<{
        schema: string;
        table: string;
        owner: string;
      }>(
        `SELECT schemaname AS schema, tablename AS table, tableowner AS owner FROM pg_tables
         WHERE tablename IN ('user','session','account','verification','organization','member','invitation','two_factor') ORDER BY tablename`,
      );
      const flags = await auth.query<{
        role: string;
        appUsage: boolean;
        opsUsage: boolean;
        appCanReadSession: boolean;
      }>(
        `SELECT current_user AS role, has_schema_privilege(current_user, 'app', 'USAGE') AS "appUsage",
         has_schema_privilege(current_user, 'ops', 'USAGE') AS "opsUsage",
         has_table_privilege('lexon_app', 'auth.session', 'SELECT') AS "appCanReadSession"`,
      );
      return {
        ...flags.rows[0]!,
        owner: [...new Set(tables.rows.map((row) => row.owner))].join(','),
        schemas: [...new Set(tables.rows.map((row) => row.schema))],
        tables: tables.rows.map((row) => row.table),
      };
    },
    async rejectSessionCommits() {
      await migrator.query(`CREATE FUNCTION auth.test_reject_session_commit() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'injected-auth-commit-failure'; END $$;
        CREATE CONSTRAINT TRIGGER test_reject_session_commit AFTER INSERT ON auth.session
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION auth.test_reject_session_commit();`);
      commitFault = true;
    },
    async close() {
      try {
        if (commitFault)
          await migrator.query(`DROP TRIGGER test_reject_session_commit ON auth.session;
          DROP FUNCTION auth.test_reject_session_commit();`);
      } finally {
        await Promise.all([migrator.end(), auth.end()]);
      }
    },
  };
}
