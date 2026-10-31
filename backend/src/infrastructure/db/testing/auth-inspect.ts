import { Pool } from 'pg';

export function createAuthInspector(options: {
  authUrl: string;
  migratorUrl: string;
  appUrl?: string;
}) {
  const migrator = new Pool({ connectionString: options.migratorUrl });
  const auth = new Pool({ connectionString: options.authUrl });
  let commitFault = false;
  const app = options.appUrl
    ? new Pool({ connectionString: options.appUrl })
    : undefined;
  const insertFaults = new Set<string>();
  async function count(query: string, value: string) {
    const result = await migrator.query<{ count: string }>(query, [value]);
    return Number(result.rows[0]!.count);
  }
  return {
    async personalFor(userId: string) {
      const result = await migrator.query<{
        orgId: string;
        userId: string;
        role: string;
        memberCount: number;
      }>(
        `SELECT o.id AS "orgId", m.user_id AS "userId", m.role,
        (SELECT count(*)::int FROM auth.member all_members WHERE all_members.organization_id = o.id) AS "memberCount"
        FROM auth.organization o JOIN auth.member m ON m.organization_id = o.id
        WHERE o.kind = 'personal' AND o.personal_owner_id = $1`,
        [userId],
      );
      return result.rows[0] ?? null;
    },
    async totals() {
      const result = await migrator.query<{
        users: number;
        organizations: number;
        members: number;
      }>(
        `SELECT (SELECT count(*)::int FROM auth."user") AS users,
        (SELECT count(*)::int FROM auth.organization) AS organizations,
        (SELECT count(*)::int FROM auth.member) AS members`,
      );
      return result.rows[0]!;
    },
    async rejectInsert(table: 'account' | 'organization' | 'member') {
      await migrator.query(`CREATE FUNCTION auth.test_reject_${table}() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'injected-insert-failure'; END $$;
        CREATE TRIGGER test_reject_${table} BEFORE INSERT ON auth.${table}
        FOR EACH ROW EXECUTE FUNCTION auth.test_reject_${table}();`);
      insertFaults.add(table);
    },
    async changePersonal(userId: string, otherUserId: string, action: string) {
      const result = await migrator.query<{ id: string }>(
        "SELECT id FROM auth.organization WHERE kind = 'personal' AND personal_owner_id = $1",
        [userId],
      );
      const id = result.rows[0]!.id;
      const commands: Record<string, { sql: string; values: string[] }> = {
        rename: {
          sql: 'UPDATE auth.organization SET name = $2 WHERE id = $1',
          values: [id, 'Changed'],
        },
        convert: {
          sql: "UPDATE auth.organization SET kind = 'team', personal_owner_id = NULL WHERE id = $1",
          values: [id],
        },
        owner: {
          sql: 'UPDATE auth.organization SET personal_owner_id = $2 WHERE id = $1',
          values: [id, otherUserId],
        },
        delete: {
          sql: 'DELETE FROM auth.organization WHERE id = $1',
          values: [id],
        },
        leave: {
          sql: 'DELETE FROM auth.member WHERE organization_id = $1',
          values: [id],
        },
        demote: {
          sql: "UPDATE auth.member SET role = 'member' WHERE organization_id = $1",
          values: [id],
        },
        add: {
          sql: "INSERT INTO auth.member (organization_id, user_id, role, created_at) VALUES ($1,$2,'member',now())",
          values: [id, otherUserId],
        },
        duplicateMember: {
          sql: "INSERT INTO auth.member (organization_id, user_id, role, created_at) VALUES ($1,$2,'owner',now())",
          values: [id, userId],
        },
        invite: {
          sql: "INSERT INTO auth.invitation (organization_id,email,role,expires_at,inviter_id) VALUES ($1,'invite@example.test','member',now()+interval '1 day',$2)",
          values: [id, userId],
        },
        duplicate: {
          sql: "INSERT INTO auth.organization (name,slug,kind,state,personal_owner_id,created_at) VALUES ('Personal',gen_random_uuid()::text,'personal','active',$1,now())",
          values: [userId],
        },
      };
      const command = commands[action];
      if (!command) throw new Error('Unknown test action');
      await auth.query(command.sql, command.values);
    },
    async permittedProjection(table: 'user' | 'organization' | 'member') {
      if (!app) throw new Error('Application test URL required');
      const projection = {
        user: 'id,email_verified,two_factor_enabled,role,banned',
        organization: 'id,name,slug,kind,state,require2fa,personal_owner_id',
        member: 'id,user_id,organization_id,role',
      }[table];
      return (
        await app.query(`SELECT ${projection} FROM auth."${table}" LIMIT 1`)
      ).fields.map((field) => field.name);
    },
    async forbiddenAppRead(target: string) {
      if (!app) throw new Error('Application test URL required');
      const queries: Record<string, string> = {
        email: 'SELECT email FROM auth."user"',
        session: 'SELECT token FROM auth.session',
        password: 'SELECT password FROM auth.account',
        totp: 'SELECT secret FROM auth.two_factor',
        recovery: 'SELECT backup_codes FROM auth.two_factor',
        account: 'SELECT * FROM auth.account',
        invitation: 'SELECT email FROM auth.invitation',
        write: 'UPDATE auth."user" SET banned = true',
      };
      const query = queries[target];
      if (!query) throw new Error('Unknown test target');
      await app.query(query);
    },
    async personalFunctionPrivileges() {
      const result = await auth.query<{
        owner: string;
        path: string;
        appExecute: boolean;
        authExecute: boolean;
      }>(`SELECT r.rolname AS owner,
        p.proconfig[1] AS path,
        has_function_privilege('lexon_app', p.oid, 'EXECUTE') AS "appExecute",
        has_function_privilege('lexon_auth', p.oid, 'EXECUTE') AS "authExecute"
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname = 'auth' AND p.proname IN ('lexon_create_personal','lexon_protect_personal','lexon_check_personal','lexon_validate_personal')`);
      return result.rows;
    },
    async forbiddenAuthAction(
      action: 'app' | 'ops' | 'owner' | 'create' | 'disable',
    ) {
      const commands = {
        app: 'SELECT * FROM app.test_probe',
        ops: 'SELECT * FROM ops.outbox',
        owner: 'SET ROLE lexon_migrator',
        create: 'CREATE TABLE auth.test_unowned (id integer)',
        disable:
          'ALTER TABLE auth."user" DISABLE TRIGGER lexon_create_personal',
      };
      await auth.query(commands[action]);
    },
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
        for (const table of insertFaults) {
          await migrator.query(
            `DROP TRIGGER test_reject_${table} ON auth.${table}; DROP FUNCTION auth.test_reject_${table}();`,
          );
        }
        if (commitFault)
          await migrator.query(`DROP TRIGGER test_reject_session_commit ON auth.session;
          DROP FUNCTION auth.test_reject_session_commit();`);
      } finally {
        await Promise.all([migrator.end(), auth.end(), app?.end()]);
      }
    },
  };
}
