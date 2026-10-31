import { Client } from 'pg';
import type { TenantJobHandler } from '../job-envelope.js';
import { requireSession } from '../tenant-session.js';
interface Services {
  migratorUrl: string;
  appUrl: string;
}
export async function installEffectFixture(services: Services): Promise<void> {
  const client = new Client({ connectionString: services.migratorUrl });
  try {
    await client.connect();
    await client.query(`CREATE TABLE app.job_effect_fixture (outbox_id uuid NOT NULL,org_id uuid NOT NULL,user_id uuid,probe_id uuid NOT NULL);
 ALTER TABLE app.job_effect_fixture ENABLE ROW LEVEL SECURITY;
 ALTER TABLE app.job_effect_fixture FORCE ROW LEVEL SECURITY;
 CREATE POLICY tenant_boundary ON app.job_effect_fixture FOR ALL TO lexon_app
 USING (org_id = NULLIF(current_setting('app.org_id',true),'')::uuid)
 WITH CHECK (org_id = NULLIF(current_setting('app.org_id',true),'')::uuid);
 CREATE POLICY fixture_inspection ON app.job_effect_fixture FOR SELECT TO lexon_migrator USING (true);`);
  } finally {
    await client.end();
  }
}
export function createEffectHandler(): TenantJobHandler {
  return async (tx, job) => {
    await requireSession(tx).client.query(
      `INSERT INTO app.job_effect_fixture VALUES ($1,NULLIF(current_setting('app.org_id',true),'')::uuid,NULLIF(current_setting('app.user_id',true),'')::uuid,$2)`,
      [job.outboxId, job.payload.probeId],
    );
  };
}
export async function inspectJob(services: Services, id: string) {
  const client = new Client({ connectionString: services.migratorUrl });
  try {
    await client.connect();
    // The fixture exposes only counts via a role-specific owner policy; no runtime privilege changes.
    const result = await client.query<{
      effects: number;
      receipts: number;
      outbox: number;
    }>(
      'SELECT (SELECT count(*)::int FROM app.job_effect_fixture WHERE outbox_id=$1) AS effects,(SELECT count(*)::int FROM ops.processed_jobs WHERE outbox_id=$1) AS receipts,(SELECT count(*)::int FROM ops.outbox WHERE id=$1) AS outbox',
      [id],
    );
    return result.rows[0]!;
  } finally {
    await client.end();
  }
}
export async function receiptWaiters(services: Services): Promise<number> {
  const client = new Client({ connectionString: services.appUrl });
  try {
    await client.connect();
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND wait_event='transactionid' AND query LIKE 'INSERT INTO ops.processed_jobs%'`,
    );
    return result.rows[0]!.count;
  } finally {
    await client.end();
  }
}
