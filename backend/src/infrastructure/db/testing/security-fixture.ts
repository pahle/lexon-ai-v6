import { Pool } from 'pg';

export function createSecurityInspector(options: {
  migratorUrl: string;
  authUrl: string;
  appUrl: string;
}) {
  const migrator = new Pool({ connectionString: options.migratorUrl });
  const auth = new Pool({ connectionString: options.authUrl });
  const app = new Pool({ connectionString: options.appUrl });
  return {
    async ageSession(id: string, seconds: number) {
      await migrator.query(
        'UPDATE auth.session SET created_at=now()-make_interval(secs=>$2) WHERE id=$1',
        [id, seconds],
      );
    },
    async ageRecent(id: string, seconds: number) {
      await migrator.query(
        'UPDATE auth.session SET reauthenticated_at=now()-make_interval(secs=>$2) WHERE id=$1',
        [id, seconds],
      );
    },
    async session(id: string) {
      return (
        (
          await migrator.query<{
            id: string;
            createdAt: Date;
            expiresAt: Date;
            channel: 'cookie' | 'bearer';
            hardExpiresAt: Date | null;
            authenticatedAt: Date | null;
            mfaVerifiedAt: Date | null;
            reauthenticatedAt: Date | null;
            activeOrganizationId: string | null;
          }>(
            `SELECT id,created_at AT TIME ZONE 'UTC' AS "createdAt",expires_at AT TIME ZONE 'UTC' AS "expiresAt",channel,hard_expires_at AT TIME ZONE 'UTC' AS "hardExpiresAt",authenticated_at AS "authenticatedAt",mfa_verified_at AS "mfaVerifiedAt",reauthenticated_at AS "reauthenticatedAt",active_organization_id AS "activeOrganizationId" FROM auth.session WHERE id=$1`,
            [id],
          )
        ).rows[0] ?? null
      );
    },
    async attemptProtectedWrite(
      id: string,
      field: 'mfa' | 'recent' | 'channel' | 'cap' | 'creation',
    ) {
      const assignments = {
        mfa: 'mfa_verified_at=now()',
        recent: 'reauthenticated_at=now()',
        channel: "channel='bearer'",
        cap: "hard_expires_at=now()+interval '1 day'",
        creation: 'created_at=now()',
      };
      await auth.query(
        `UPDATE auth.session SET ${assignments[field]} WHERE id=$1`,
        [id],
      );
    },
    async attemptAppEvidence() {
      await app.query("SELECT auth.lexon_write_session_security('{}'::jsonb)");
    },
    async seedBearer(id: string, cap: Date, organizationId: string) {
      await migrator.query(
        `UPDATE auth.session SET channel=$2,hard_expires_at=$3::timestamptz AT TIME ZONE 'UTC',expires_at=$3::timestamptz AT TIME ZONE 'UTC',active_organization_id=$4 WHERE id=$1`,
        [id, 'bearer', cap, organizationId],
      );
    },
    async protectedFunction() {
      return (
        await migrator.query<{
          owner: string;
          safePath: boolean;
          publicExecute: boolean;
          authExecute: boolean;
          appExecute: boolean;
        }>(
          `SELECT r.rolname AS owner,p.proconfig @> ARRAY['search_path=pg_catalog, auth, pg_temp'] AS "safePath",EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute",has_function_privilege('lexon_auth',p.oid,'EXECUTE') AS "authExecute",has_function_privilege('lexon_app',p.oid,'EXECUTE') AS "appExecute" FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth' AND p.proname='lexon_write_session_security'`,
        )
      ).rows[0]!;
    },
    async close() {
      await Promise.all([migrator.end(), auth.end(), app.end()]);
    },
  };
}
