import { Pool } from 'pg';

// Migrator-owned fixtures only; never included in a production build.
export function createAccountInspector(options: { migratorUrl: string }) {
  const pool = new Pool({ connectionString: options.migratorUrl });
  return {
    async lastAccountChange() {
      return (
        await pool.query<{
          subject_user_id: string;
          actor_user_id: string | null;
        }>(
          "SELECT subject_user_id,actor_user_id FROM ops.audit_events WHERE type='identity.account_changed.v1' ORDER BY occurred_at DESC LIMIT 1",
        )
      ).rows[0]!;
    },
    async seedPendingInvitation(input: {
      id: string;
      organizationId: string;
      email: string;
      inviterId: string;
    }) {
      await pool.query(
        `INSERT INTO auth.invitation(id,organization_id,email,role,status,expires_at,inviter_id) VALUES($1,$2,$3,'member','pending',now()+interval '1 day',$4)`,
        [input.id, input.organizationId, input.email, input.inviterId],
      );
    },
    async seedSetupGrant(identifier: string, value: string) {
      await pool.query(
        `INSERT INTO auth.verification(identifier,value,expires_at) VALUES($1,$2,now()+interval '1 day')`,
        [identifier, value],
      );
    },
    async membershipCount(userId: string) {
      return (
        await pool.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM auth.member WHERE user_id=$1',
          [userId],
        )
      ).rows[0]!.count;
    },
    async banByEmail(email: string) {
      await pool.query('UPDATE auth."user" SET banned=true WHERE email=$1', [
        email,
      ]);
    },
    async lastFailedSignIn() {
      return (
        await pool.query<{
          subject_user_id: string | null;
          metadata: Record<string, unknown>;
        }>(
          "SELECT subject_user_id,metadata FROM ops.audit_events WHERE type='identity.sign_in_failed.v1' ORDER BY occurred_at DESC LIMIT 1",
        )
      ).rows[0]!;
    },
    async seedConsumedInvitation(input: {
      id: string;
      organizationId: string;
      email: string;
      userId: string;
    }) {
      await pool.query(
        `INSERT INTO auth.invitation(id,organization_id,email,role,status,expires_at,inviter_id,accepted_by_user_id,accepted_at) VALUES($1,$2,$3,'member','accepted',now()+interval '1 day',$4::uuid,$4::text,now())`,
        [input.id, input.organizationId, input.email, input.userId],
      );
    },
    async invitationBinding(id: string) {
      return (
        await pool.query<{ accepted_by_user_id: string; email: string }>(
          'SELECT accepted_by_user_id,email FROM auth.invitation WHERE id=$1',
          [id],
        )
      ).rows[0]!;
    },
    async resetLifetime(token: string) {
      const result = await pool.query<{ seconds: string }>(
        'SELECT extract(epoch FROM (expires_at-created_at)) AS seconds FROM auth.verification WHERE identifier=$1',
        [`reset-password:${token}`],
      );
      return Number(result.rows[0]!.seconds);
    },
    close: () => pool.end(),
  };
}
