import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
export function createInvitationInspector(options: { migratorUrl: string }) {
  const pool = new Pool({ connectionString: options.migratorUrl });
  return {
    async holdEmailChange(userId: string, email: string) {
      const client = await pool.connect();
      await client.query('BEGIN');
      await client.query('UPDATE auth."user" SET email=$2 WHERE id=$1', [
        userId,
        email,
      ]);
      return {
        async waitForAuthWaiter() {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const result = await pool.query<{ blocked: number }>(
              "SELECT count(*) FILTER(WHERE cardinality(pg_blocking_pids(pid))>0)::int AS blocked FROM pg_stat_activity WHERE datname=current_database() AND usename='lexon_auth'",
            );
            if (result.rows[0]!.blocked > 0) return;
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          throw new Error('Email race synchronization timed out');
        },
        async release() {
          try {
            await client.query('COMMIT');
          } finally {
            client.release();
          }
        },
      };
    },
    async email(id: string): Promise<string> {
      return (
        await pool.query<{ email: string }>(
          'SELECT email FROM auth."user" WHERE id=$1',
          [id],
        )
      ).rows[0]!.email;
    },
    async changeEmail(id: string, email: string) {
      await pool.query('UPDATE auth."user" SET email=$2 WHERE id=$1', [
        id,
        email,
      ]);
    },
    async member(userId: string, orgId: string) {
      return (
        (
          await pool.query<{ id: string; role: string }>(
            'SELECT id,role FROM auth.member WHERE user_id=$1 AND organization_id=$2',
            [userId, orgId],
          )
        ).rows[0] ?? null
      );
    },
    async addMember(orgId: string, userId: string, role: string) {
      await pool.query(
        'INSERT INTO auth.member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,$4,now())',
        [randomUUID(), orgId, userId, role],
      );
    },
    async setRole(id: string, role: string) {
      await pool.query('UPDATE auth.member SET role=$2 WHERE id=$1', [
        id,
        role,
      ]);
    },
    async removeMember(id: string) {
      await pool.query('DELETE FROM auth.member WHERE id=$1', [id]);
    },
    async requireMfa(id: string) {
      await pool.query(
        'UPDATE auth.organization SET require2fa=true WHERE id=$1',
        [id],
      );
    },
    async expire(id: string) {
      await pool.query(
        "UPDATE auth.invitation SET expires_at=now()-interval '1 second' WHERE id=$1",
        [id],
      );
    },
    async pendingCount(orgId: string, email: string) {
      return (
        await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM auth.invitation WHERE organization_id=$1 AND lower(email)=lower($2) AND status='pending'",
          [orgId, email],
        )
      ).rows[0]!.count;
    },
    async acceptAuditCount(invitationId: string) {
      return (
        await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM ops.audit_events WHERE invitation_id=$1 AND type='organization.invitation_changed.v1' AND metadata->>'action'='accepted'",
          [invitationId],
        )
      ).rows[0]!.count;
    },
    async close() {
      await pool.end();
    },
  };
}
