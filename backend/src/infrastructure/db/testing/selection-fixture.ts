import { Pool } from 'pg';
export function createSelectionInspector(options: { migratorUrl: string }) {
  const pool = new Pool({ connectionString: options.migratorUrl });
  let denied = false;
  return {
    async invalidate(
      userId: string,
      sessionId: string,
      state: 'expired' | 'disabled' | 'unverified',
    ) {
      if (state === 'expired')
        await pool.query(
          "UPDATE auth.session SET expires_at=now()-interval '1 second' WHERE id=$1",
          [sessionId],
        );
      else if (state === 'disabled')
        await pool.query('UPDATE auth."user" SET banned=true WHERE id=$1', [
          userId,
        ]);
      else
        await pool.query(
          'UPDATE auth."user" SET email_verified=false WHERE id=$1',
          [userId],
        );
    },
    async renameOrganization(id: string, name: string) {
      await pool.query('UPDATE auth.organization SET name=$2 WHERE id=$1', [
        id,
        name,
      ]);
    },
    async ageExpiry(id: string, seconds: number) {
      await pool.query(
        'UPDATE auth.session SET expires_at=now()+make_interval(secs=>$2) WHERE id=$1',
        [id, seconds],
      );
    },
    async denySessionReads() {
      await pool.query('REVOKE SELECT ON auth.session FROM lexon_auth');
      denied = true;
    },
    async close() {
      try {
        if (denied)
          await pool.query('GRANT SELECT ON auth.session TO lexon_auth');
      } finally {
        await pool.end();
      }
    },
  };
}
