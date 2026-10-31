import { Client } from 'pg';
import { buildAuthorizationPredicate } from '../authorization-predicate.js';
import { requireSession, type TenantSession } from '../tenant-session.js';
import { TenantDatabase } from '../tenant-database.js';

interface FixtureOptions {
  migratorUrl: string;
  appUrl: string;
}
export async function installTenantFixture(
  options: FixtureOptions,
): Promise<void> {
  const client = new Client({ connectionString: options.migratorUrl });
  try {
    await client.connect();
    await client.query(`CREATE TABLE app.tenant_fixture (id uuid PRIMARY KEY, org_id uuid NOT NULL, value text NOT NULL);
      ALTER TABLE app.tenant_fixture ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.tenant_fixture FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_boundary ON app.tenant_fixture FOR ALL TO lexon_app
        USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
      CREATE TABLE auth.secret_fixture (id uuid PRIMARY KEY, secret text NOT NULL);
      GRANT USAGE ON SCHEMA auth TO lexon_app;
      GRANT SELECT (id) ON auth.secret_fixture TO lexon_app;`);
  } finally {
    await client.end();
  }
  // A fail-closed probe must run against populated data, never an empty table.
  const database = new TenantDatabase({
    appUrl: options.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  try {
    await database.withTenant(
      { orgId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      async (tx) => {
        await tenantFixture(tx).insert(
          'cccccccc-cccc-4ccc-8ccc-000000000001',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'seed',
        );
      },
    );
  } finally {
    await database.close();
  }
}

export function tenantFixture(tx: TenantSession) {
  return {
    async insert(id: string, orgId: string, value: string): Promise<void> {
      await requireSession(tx).client.query(
        'INSERT INTO app.tenant_fixture VALUES ($1, $2, $3)',
        [id, orgId, value],
      );
    },
    async read(): Promise<{ id: string; value: string }[]> {
      const { client, ctx } = requireSession(tx);
      return (
        await client.query<{ id: string; value: string }>(
          'SELECT id, value FROM app.tenant_fixture WHERE org_id = $1 ORDER BY id',
          [buildAuthorizationPredicate(ctx).orgId],
        )
      ).rows;
    },
    async update(id: string, value: string): Promise<number> {
      return (
        (
          await requireSession(tx).client.query(
            'UPDATE app.tenant_fixture SET value = $2 WHERE id = $1',
            [id, value],
          )
        ).rowCount ?? 0
      );
    },
    async delete(id: string): Promise<number> {
      return (
        (
          await requireSession(tx).client.query(
            'DELETE FROM app.tenant_fixture WHERE id = $1',
            [id],
          )
        ).rowCount ?? 0
      );
    },
  };
}

export async function observeContext(
  tx: TenantSession,
): Promise<{ orgId: string; userId: string }> {
  return (
    await requireSession(tx).client.query<{ orgId: string; userId: string }>(
      `SELECT current_setting('app.org_id') AS "orgId", current_setting('app.user_id') AS "userId"`,
    )
  ).rows[0]!;
}
export async function sleepInTransaction(tx: TenantSession): Promise<void> {
  await requireSession(tx).client.query('SELECT pg_sleep(1)');
}

export async function roleRestrictions(options: FixtureOptions) {
  const client = new Client({ connectionString: options.appUrl });
  try {
    await client.connect();
    const allowed = async (query: string) => {
      try {
        await client.query(query);
        return true;
      } catch {
        return false;
      } finally {
        await client.query('RESET ROLE');
      }
    };
    const flags = await client.query<{ owner: boolean; bypassRls: boolean }>(
      `SELECT pg_get_userbyid(relowner) = current_user AS owner, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS "bypassRls" FROM pg_class WHERE oid = 'app.tenant_fixture'::regclass`,
    );
    return {
      disableRls: await allowed(
        'ALTER TABLE app.tenant_fixture DISABLE ROW LEVEL SECURITY',
      ),
      truncate: await allowed('TRUNCATE app.tenant_fixture'),
      alter: await allowed(
        'ALTER TABLE app.tenant_fixture ADD COLUMN intrusion text',
      ),
      readAuthSecret: await allowed('SELECT secret FROM auth.secret_fixture'),
      assumeMigrator: await allowed('SET ROLE lexon_migrator'),
      assumeAuth: await allowed('SET ROLE lexon_auth'),
      ...flags.rows[0]!,
    };
  } finally {
    await client.end();
  }
}
