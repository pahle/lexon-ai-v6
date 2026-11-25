import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import { createRoleClient } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  AiOperationRepository,
  hashOperationArgs,
} from '../../src/infrastructure/db/index.js';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';

const FUNCTION_SQL = 'SELECT * FROM app.ai_expired_operations(64)';

function roleUrl(migratorUrl: string, role: string, password: string) {
  const url = new URL(migratorUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function denied(roleUrl: string) {
  const client = createRoleClient(roleUrl);
  try {
    await client.connect();
    await expect(client.query(FUNCTION_SQL)).rejects.toMatchObject({
      code: '42501',
      message: 'permission denied for function ai_expired_operations',
    });
  } finally {
    await client.end();
  }
}

async function persistExpired(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  tenantIndex: number,
  expired: boolean,
) {
  const run = await ai.start(tenantIndex);
  await ai.seedPendingStep(tenantIndex, run.id);
  const claim = await ai.claim(tenantIndex, run.id, 1, 1, 5_000);
  expect(claim).not.toBeNull();
  const repository = new AiOperationRepository();
  const args = { value: `org-${tenantIndex}-${expired}` };
  const operation = await ai.withTenant(tenantIndex, (tx) =>
    repository.persist(tx, claim!, {
      callOccurrence: 0,
      toolName: 'fixture-write',
      toolVersion: 1,
      mode: 'transactional',
      args,
      argsHash: hashOperationArgs(args),
      snapshotHash: canonicalOperationHash({
        toolId: 'fixture-write',
        toolVersion: 1,
        args,
      }),
      approvalRequired: true,
    }),
  );
  if (expired) {
    await ai.withTenantSession(tenantIndex, (tx, client) =>
      client.query(
        `UPDATE app.ai_operations
         SET expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1`,
        [operation.id],
      ),
    );
  }
  return { run, operation };
}

test('returns exactly the four id columns', async ({ services }) => {
  const ai = await createAiFixture(services);
  const client = createRoleClient(services.appUrl);
  try {
    await persistExpired(ai, 0, true);
    await client.connect();
    const result = await client.query<Record<string, unknown>>(FUNCTION_SQL);
    expect(result.rows).toHaveLength(1);
    expect(Object.keys(result.rows[0]!).sort()).toEqual([
      'id',
      'initiating_user_id',
      'org_id',
      'run_id',
    ]);
    for (const value of Object.values(result.rows[0]!)) {
      expect(value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  } finally {
    await client.end();
    await ai.close();
  }
});

test('returns expired candidates across orgs, ids only', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const client = createRoleClient(services.appUrl);
  try {
    const first = await persistExpired(ai, 0, true);
    const second = await persistExpired(ai, 1, true);
    const fresh = await persistExpired(ai, 0, false);
    await client.connect();
    const result = await client.query<{
      org_id: string;
      id: string;
      run_id: string;
      initiating_user_id: string;
    }>(FUNCTION_SQL);
    const ids = result.rows.map((row) => row.id).sort();
    expect(ids).toEqual([first.operation.id, second.operation.id].sort());
    expect(ids).not.toContain(fresh.operation.id);
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    expect(byId.get(first.operation.id)).toMatchObject({
      org_id: ai.tenants[0]!.orgId,
      run_id: first.run.id,
      initiating_user_id: ai.tenants[0]!.userId,
    });
    expect(byId.get(second.operation.id)).toMatchObject({
      org_id: ai.tenants[1]!.orgId,
      run_id: second.run.id,
      initiating_user_id: ai.tenants[1]!.userId,
    });
  } finally {
    await client.end();
    await ai.close();
  }
});

test('lexon_auth, lexon_setup and an ungranted role are denied', async ({
  services,
}) => {
  const migrator = createRoleClient(services.migratorUrl);
  const setupPassword = createHash('sha256')
    .update(new URL(services.migratorUrl).password)
    .update('lexon.setup.test')
    .digest('hex');
  const guestPassword = createHash('sha256')
    .update(new URL(services.migratorUrl).password)
    .update('spec.guest')
    .digest('hex');
  try {
    await migrator.connect();
    await migrator.query(`ALTER ROLE lexon_setup PASSWORD '${setupPassword}'`);
    await migrator.query(
      `DROP ROLE IF EXISTS spec_guest;
       CREATE ROLE spec_guest LOGIN PASSWORD '${guestPassword}'`,
    );
    // Schema USAGE keeps the probe honest: the denial must come from the
    // function grant, not the schema.
    await migrator.query(
      'GRANT USAGE ON SCHEMA app TO lexon_auth, lexon_setup, spec_guest',
    );
    await denied(services.authUrl);
    await denied(roleUrl(services.migratorUrl, 'lexon_setup', setupPassword));
    await denied(roleUrl(services.migratorUrl, 'spec_guest', guestPassword));
  } finally {
    await migrator
      .query(
        `REVOKE USAGE ON SCHEMA app FROM lexon_auth, lexon_setup;
         DROP ROLE IF EXISTS spec_guest`,
      )
      .catch(() => undefined);
    await migrator.end();
  }
});

test('grants EXECUTE to lexon_app only with a pinned search_path', async ({
  services,
}) => {
  const migrator = createRoleClient(services.migratorUrl);
  try {
    await migrator.connect();
    const info = await migrator.query<{
      proacl: string;
      prosecdef: boolean;
      proconfig: string[];
    }>(
      `SELECT p.proacl::text AS proacl, p.prosecdef, p.proconfig::text[] AS proconfig
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='app' AND p.proname='ai_expired_operations'`,
    );
    expect(info.rows).toHaveLength(1);
    const row = info.rows[0]!;
    expect(row.prosecdef).toBe(true);
    expect(row.proconfig).toEqual(['search_path=app, pg_temp']);
    // ACL entries look like `grantee=X/grantor`; EXECUTE may only appear on
    // the owner and lexon_app, never PUBLIC or another role.
    const executors = row.proacl
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((entry) => entry.slice(entry.indexOf('=') + 1).startsWith('X'))
      .map((entry) => entry.slice(0, entry.indexOf('=')));
    expect(executors.sort()).toEqual(['lexon_app', 'lexon_migrator']);
    const migratorPolicy = await migrator.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies
       WHERE schemaname='app' AND tablename='ai_operations'
         AND policyname='ai_operations_internal'`,
    );
    expect(migratorPolicy.rows).toHaveLength(1);
  } finally {
    await migrator.end();
  }
});
