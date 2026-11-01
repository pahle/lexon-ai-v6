import { Pool } from 'pg';
export interface AdminSetupGrant {
  id: string;
  identifier: string;
  value: string;
  expiresAt: string;
}
export interface AdminSetupOperatorFacts {
  adminExists: boolean;
  pendingInitialEmail: string | null;
  userId: string | null;
  grant: AdminSetupGrant | null;
}
export interface AdminSetupOperatorSession {
  facts(email: string): Promise<AdminSetupOperatorFacts>;
  begin(input: {
    email: string;
    expected: AdminSetupOperatorFacts;
    grant: AdminSetupGrant | null;
    event: unknown;
  }): Promise<void>;
}
export interface AdminSetupOperator {
  transaction<T>(
    work: (tx: AdminSetupOperatorSession) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}
export async function createAdminSetupOperator(
  url: string,
): Promise<AdminSetupOperator> {
  const pool = new Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => {});
  try {
    if (
      (await pool.query<{ current_user: string }>('SELECT current_user'))
        .rows[0]?.current_user !== 'lexon_setup'
    )
      throw new Error('Wrong setup database role');
  } catch {
    await pool.end();
    throw new Error('Setup database unavailable');
  }
  return {
    async transaction<T>(
      work: (tx: AdminSetupOperatorSession) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      let active = true;
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout='10s'");
        const result = await work({
          async facts(email) {
            if (!active) throw new Error('Setup transaction expired');
            return (
              await client.query<{ facts: AdminSetupOperatorFacts }>(
                'SELECT auth.lexon_admin_setup_operator_facts($1) AS facts',
                [email],
              )
            ).rows[0]!.facts;
          },
          async begin(input) {
            if (!active) throw new Error('Setup transaction expired');
            await client.query(
              'SELECT auth.lexon_begin_admin_setup($1::jsonb)',
              [JSON.stringify(input)],
            );
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        active = false;
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
