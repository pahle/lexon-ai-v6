import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { Pool } from 'pg';
import { test } from '../setup/file-services.js';

// A-22: only lexon_auth may execute auth.lexon_append_audit.
function event() {
  return {
    eventId: randomUUID(),
    version: 1,
    type: 'identity.sign_in_failed.v1',
    occurredAt: new Date().toISOString(),
    outcome: 'failure',
    metadata: {
      subjectHmac: 'a'.repeat(64),
      keyId: 'test-v1',
      reason: 'invalid_credentials',
    },
  };
}

test('lexon_app cannot execute auth.lexon_append_audit', async ({
  services,
}) => {
  const app = new Pool({ connectionString: services.appUrl });
  try {
    await expect(
      app.query('SELECT auth.lexon_append_audit($1::jsonb)', [
        JSON.stringify(event()),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await app.end();
  }
});

test('lexon_auth append writes one row', async ({ services }) => {
  const auth = new Pool({ connectionString: services.authUrl });
  const migrator = new Pool({ connectionString: services.migratorUrl });
  try {
    const value = event();
    await auth.query('SELECT auth.lexon_append_audit($1::jsonb)', [
      JSON.stringify(value),
    ]);
    const rows = await migrator.query(
      'SELECT event_id FROM ops.audit_events WHERE event_id=$1',
      [value.eventId],
    );
    expect(rows.rows).toEqual([{ event_id: value.eventId }]);
  } finally {
    await Promise.all([auth.end(), migrator.end()]);
  }
});

test('routine_privileges for lexon_append_audit lists only lexon_auth', async ({
  services,
}) => {
  const migrator = new Pool({ connectionString: services.migratorUrl });
  try {
    const rows = await migrator.query<{ grantee: string }>(
      `SELECT DISTINCT grantee FROM information_schema.routine_privileges
       WHERE routine_schema='auth' AND routine_name='lexon_append_audit'
         AND privilege_type='EXECUTE' AND grantee <> 'lexon_migrator'
       ORDER BY grantee`,
    );
    expect(rows.rows.map((row) => row.grantee)).toEqual(['lexon_auth']);
  } finally {
    await migrator.end();
  }
});
