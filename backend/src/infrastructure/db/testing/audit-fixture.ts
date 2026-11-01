import { Pool } from 'pg';

export function createAuditInspector(options: {
  appUrl: string;
  authUrl: string;
  migratorUrl: string;
}) {
  const app = new Pool({ connectionString: options.appUrl });
  const auth = new Pool({ connectionString: options.authUrl });
  const migrator = new Pool({ connectionString: options.migratorUrl });
  let fault = false;
  return {
    async serializedEvents() {
      return JSON.stringify(
        (
          await migrator.query(
            'SELECT * FROM ops.audit_events ORDER BY occurred_at,event_id',
          )
        ).rows,
      );
    },
    async count(type: string) {
      return Number(
        (
          await migrator.query<{ count: string }>(
            'SELECT count(*) FROM ops.audit_events WHERE type=$1',
            [type],
          )
        ).rows[0]!.count,
      );
    },
    async appendRaw(role: 'app' | 'auth', event: unknown) {
      await (role === 'app' ? app : auth).query(
        'SELECT auth.lexon_append_audit($1::jsonb)',
        [JSON.stringify(event)],
      );
    },
    async appendDirect(event: {
      eventId: string;
      version: number;
      type: string;
      occurredAt: string;
      outcome: string;
      metadata: unknown;
    }) {
      await app.query(
        `INSERT INTO ops.audit_events (event_id,version,type,occurred_at,outcome,metadata) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          event.eventId,
          event.version,
          event.type,
          event.occurredAt,
          event.outcome,
          JSON.stringify(event.metadata),
        ],
      );
    },
    async forbidden(
      role: 'app' | 'auth',
      operation: 'SELECT' | 'UPDATE' | 'DELETE' | 'TRUNCATE' | 'INSERT',
    ) {
      const queries = {
        SELECT: 'SELECT * FROM ops.audit_events',
        UPDATE: "UPDATE ops.audit_events SET outcome='failure'",
        DELETE: 'DELETE FROM ops.audit_events',
        TRUNCATE: 'TRUNCATE ops.audit_events',
        INSERT: 'INSERT INTO ops.audit_events DEFAULT VALUES',
      };
      await (role === 'app' ? app : auth).query(queries[operation]);
    },
    async security() {
      return (
        await migrator.query<{
          owner: string;
          path: string;
          publicExecute: boolean;
          appExecute: boolean;
          authExecute: boolean;
        }>(`SELECT r.rolname AS owner,p.proconfig[1] AS path,
        EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute",
        has_function_privilege('lexon_app',p.oid,'EXECUTE') AS "appExecute",
        has_function_privilege('lexon_auth',p.oid,'EXECUTE') AS "authExecute"
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
        WHERE n.nspname='auth' AND p.proname='lexon_append_audit'`)
      ).rows[0];
    },
    async rejectInserts() {
      await migrator.query(`CREATE FUNCTION ops.test_reject_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'injected-audit-failure'; END $$;
        CREATE TRIGGER test_reject_audit BEFORE INSERT ON ops.audit_events FOR EACH ROW EXECUTE FUNCTION ops.test_reject_audit();`);
      fault = true;
    },
    async close() {
      try {
        if (fault)
          await migrator.query(
            'DROP TRIGGER test_reject_audit ON ops.audit_events; DROP FUNCTION ops.test_reject_audit();',
          );
      } finally {
        await Promise.all([app.end(), auth.end(), migrator.end()]);
      }
    },
  };
}
