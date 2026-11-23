import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiOperationRepository,
  hashOperationArgs,
} from '../../src/infrastructure/db/index.js';
import { createRlsInspector } from '../../src/infrastructure/db/testing/rls-fixture.js';

// A-17: every table in the `app` schema is tenant-fenced.
test('every app table has row-level security enabled and forced', async ({
  services,
}) => {
  const inspect = createRlsInspector(services);
  try {
    expect(await inspect.tableCount()).toBeGreaterThan(0);
    expect(await inspect.unfencedTables()).toEqual([]);
  } finally {
    await inspect.close();
  }
});

// B-07: nothing but tables may live in `app` — a view bypasses RLS checks.
test('the app schema holds no views or materialized views', async ({
  services,
}) => {
  const inspect = createRlsInspector(services);
  try {
    expect(await inspect.appViews()).toEqual([]);
  } finally {
    await inspect.close();
  }
});

// B-07: the catalog checks must not be vacuous — a partitioned table is a
// table (it can carry relrowsecurity) and must be fenced like the rest, and a
// view must trip the view guard. Both probes are rolled back.
test('the catalog catches a probe partitioned table and a probe view', async ({
  services,
}) => {
  const inspect = createRlsInspector(services);
  const pools = createPlatformPools(services);
  const client = await pools.migrator.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'CREATE TABLE app.f44_probe_p (id int NOT NULL, org_id uuid NOT NULL) PARTITION BY LIST (org_id)',
    );
    await client.query('CREATE VIEW app.f44_probe_v AS SELECT 1');
    // Same client: the probes are only visible inside this transaction.
    expect(await inspect.unfencedTables(client)).toContain('f44_probe_p');
    expect(await inspect.appViews(client)).toContainEqual({
      relname: 'f44_probe_v',
      relkind: 'v',
    });
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await Promise.all([inspect.close(), pools.close()]);
  }
});

test('an app connection without the tenant GUC sees no rows in any app table', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const inspect = createRlsInspector(services);
  try {
    // Seed through the fixture (owner-side setup) so the zero counts are not vacuous.
    for (let org = 0; org < 2; org++) await ai.start(org);
    // The owner role has no INSERT policy on ai_steps, so its first row goes
    // through the AI fixture (the application role with a tenant context).
    const runs = await inspect.runIds();
    const claim = await ai.seedClaimableStep(0, runs[0]!, {
      activeAttempt: false,
    });
    await ai.checkpointRetry(0, claim);
    const args = { value: 'seed' };
    await ai.withTenant(0, (tx) =>
      new AiOperationRepository().persist(tx, claim, {
        callOccurrence: 0,
        toolName: 'fixture-write',
        toolVersion: 1,
        mode: 'transactional',
        args,
        argsHash: hashOperationArgs(args),
        snapshotHash: 'a'.repeat(64),
        approvalRequired: false,
      }),
    );
    const unseeded = await inspect.seedEmptyTables({
      chat_deleted_ids: { entity_kind: "'chat'" },
      chat_deletion_work: { phase: "'grace'" },
      chat_mutation_requests: {
        mutation_kind: "'send'",
        chat_id: '(SELECT id FROM app.chats LIMIT 1)',
      },
      chat_messages: {
        role: "'user'",
        user_text: "'seed'",
        effort: "'high'",
        run_id: 'NULL',
      },
      chat_runs: { kind: "'answer'" },
      message_feedback: { rating: "'good'" },
      usage_events: { outcome: "'reserved'" },
    });
    // ai_test_tool_effects is created by the AI fixture itself, not by a
    // migration, so it is not part of the shipped schema.
    delete unseeded['ai_test_tool_effects'];
    expect(unseeded).toEqual({});
    const visibility = await inspect.visibility();
    expect(
      Object.entries(visibility).filter(
        ([table, rows]) =>
          table !== 'ai_test_tool_effects' && rows.withContext === 0,
      ),
    ).toEqual([]);
    expect(
      Object.entries(visibility).filter(([, rows]) => rows.noContext > 0),
    ).toEqual([]);
  } finally {
    await Promise.all([ai.close(), inspect.close()]);
  }
});
