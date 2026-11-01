import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { createAdminSetupOperator } from '../auth/admin-setup-operator.js';
export async function createAdminSetupFixture(options: {
  migratorUrl: string;
}) {
  const pool = new Pool({ connectionString: options.migratorUrl });
  const password = createHash('sha256')
    .update(new URL(options.migratorUrl).password)
    .update('lexon.setup.test')
    .digest('hex');
  try {
    const statement = await pool.query<{ sql: string }>(
      "SELECT format('ALTER ROLE lexon_setup PASSWORD %L',$1::text) AS sql",
      [password],
    );
    await pool.query(statement.rows[0]!.sql);
    const url = new URL(options.migratorUrl);
    url.username = 'lexon_setup';
    url.password = password;
    const operator = await createAdminSetupOperator(url.toString());
    return {
      operator,
      url: url.toString(),
      async expire(email: string) {
        await pool.query(
          "UPDATE auth.verification SET expires_at=now()-interval '1 second' WHERE identifier LIKE 'lexon.admin-setup.v1:%' AND value::jsonb->>'email'=$1",
          [email],
        );
      },
      async privileges() {
        return (
          await pool.query(
            "SELECT has_table_privilege('lexon_setup','auth.verification','SELECT') AS read_grants,has_table_privilege('lexon_setup','auth.verification','INSERT') AS write_grants,has_table_privilege('lexon_setup','ops.audit_events','INSERT') AS write_audit,has_function_privilege('lexon_auth','auth.lexon_begin_admin_setup(jsonb)','EXECUTE') AS auth_can_begin",
          )
        ).rows[0];
      },
      async pendingCount(email: string) {
        return (
          await pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM auth.verification WHERE identifier LIKE 'lexon.admin-setup.v1:%' AND value::jsonb->>'email'=$1 AND value::jsonb->>'status'='pending'",
            [email],
          )
        ).rows[0]!.count;
      },
      async rawGrant(email: string) {
        return JSON.stringify(
          (
            await pool.query(
              "SELECT * FROM auth.verification WHERE identifier LIKE 'lexon.admin-setup.v1:%' AND value::jsonb->>'email'=$1",
              [email],
            )
          ).rows,
        );
      },
      async auditCount() {
        return (
          await pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM ops.audit_events WHERE type='platform.admin_setup_invoked.v1'",
          )
        ).rows[0]!.count;
      },
      async close() {
        await operator.close();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
