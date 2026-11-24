import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  planIndexes,
  type PlanNode,
  type PoolClient,
} from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  migrateDatabase,
  revertAiOperationKinds0042ForUpgradeTest,
} from '../../src/infrastructure/db/testing/provision.js';
import {
  AiOperationRepository,
  hashOperationArgs,
} from '../../src/infrastructure/db/index.js';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';

const BASE_COLUMNS = `id,org_id,run_id,step_id,call_occurrence,tool_name,
  tool_version,idempotency_mode,args,args_hash,snapshot_hash,
  approval_required,status`;

function opInsert(
  operationId: string,
  orgId: string,
  runId: string,
  stepId: string,
  extraColumns: string[] = [],
  extraValues: string[] = [],
) {
  const columns = `${BASE_COLUMNS}${extraColumns.length ? `,${extraColumns.join(',')}` : ''}`;
  const placeholders = [
    '$1',
    '$2',
    '$3',
    '$4',
    '0',
    "'fixture-write'",
    '1',
    "'transactional'",
    "'{}'",
    '$5',
    '$6',
    'true',
    "'awaiting_approval'",
  ];
  return {
    text: `INSERT INTO app.ai_operations(${columns}) VALUES(${placeholders.concat(extraValues).join(',')})`,
    values: [operationId, orgId, runId, stepId, 'a'.repeat(64), 'b'.repeat(64)],
  };
}

test('rejects a pause op without expires_at and an unknown kind', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const step = await ai.withTenantSession(0, async (tx, client) => {
      const row = (
        await client.query<{ id: string }>(
          'SELECT id FROM app.ai_steps WHERE run_id=$1',
          [run.id],
        )
      ).rows[0]!;
      return row.id;
    });
    const missingExpiry = opInsert(randomUUID(), tenant.orgId, run.id, step, [
      'expires_at',
    ]);
    missingExpiry.text = missingExpiry.text.replace(
      "'awaiting_approval')",
      "'awaiting_approval',NULL)",
    );
    await expect(
      ai.withTenantSession(0, (tx, client: PoolClient) =>
        client.query(missingExpiry),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const unknownKind = opInsert(randomUUID(), tenant.orgId, run.id, step, [
      'kind',
      'expires_at',
    ]);
    unknownKind.text = unknownKind.text.replace(
      "'awaiting_approval')",
      "'awaiting_approval','bogus',clock_timestamp())",
    );
    await expect(
      ai.withTenantSession(0, (tx, client: PoolClient) =>
        client.query(unknownKind),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await ai.close();
  }
});

test('requires result+completed_at for answered/dismissed/expired', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const step = await ai.withTenantSession(0, async (tx, client) => {
      const row = (
        await client.query<{ id: string }>(
          'SELECT id FROM app.ai_steps WHERE run_id=$1',
          [run.id],
        )
      ).rows[0]!;
      return row.id;
    });
    for (const [status, decision, occurrence] of [
      ['answered', 'answer', 1],
      ['dismissed', 'dismiss', 2],
      ['expired', null, 3],
    ] as const) {
      const base = [
        randomUUID(),
        tenant.orgId,
        run.id,
        step,
        'a'.repeat(64),
        'b'.repeat(64),
      ];
      // The decision columns satisfy ai_operations_decision_lifecycle, so
      // the only constraint left to fire is the lifecycle rule that binds
      // result and completed_at to the terminal statuses.
      const decisionBy = decision === null ? null : tenant.userId;
      await expect(
        ai.withTenantSession(0, (tx, client: PoolClient) =>
          client.query(
            `INSERT INTO app.ai_operations(${BASE_COLUMNS},decision,decision_by_user_id,decided_at)
             VALUES($1,$2,$3,$4,${occurrence},'fixture-write',1,'transactional','{}',$5,$6,true,'${status}',
               $7::text,$8::uuid,clock_timestamp())`,
            [...base, decision, decisionBy],
          ),
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'ai_operations_lifecycle',
      });
      // The widened CHECKs accept the same decision row once the stored
      // result and completion timestamp are present.
      await ai.withTenantSession(0, (tx, client: PoolClient) =>
        client.query(
          `INSERT INTO app.ai_operations(${BASE_COLUMNS},decision,decision_by_user_id,decided_at,result,completed_at)
           VALUES($1,$2,$3,$4,${occurrence + 10},'fixture-write',1,'transactional','{}',$5,$6,true,'${status}',
             $7::text,$8::uuid,clock_timestamp(),'{}'::jsonb,clock_timestamp())`,
          [...base, decision, decisionBy],
        ),
      );
    }
  } finally {
    await ai.close();
  }
});

test('backfilled rows carry created_at + 24h and are indexed', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const stepId = await ai.withTenantSession(0, async (tx, client) => {
      const row = (
        await client.query<{ id: string }>(
          'SELECT id FROM app.ai_steps WHERE run_id=$1',
          [run.id],
        )
      ).rows[0]!;
      return row.id;
    });
    // Rewind the database to the pre-0042 shape so the migration's own
    // backfill is what fills expires_at on the legacy row.
    await revertAiOperationKinds0042ForUpgradeTest(services.migratorUrl);
    const operationId = randomUUID();
    await ai.withTenantSession(0, (tx, client: PoolClient) =>
      client.query(opInsert(operationId, tenant.orgId, run.id, stepId)),
    );
    await migrateDatabase(services.migratorUrl);
    const row = await ai.withTenantSession(0, async (tx, client) => {
      const result = await client.query<{
        kind: string;
        backfilled: boolean;
      }>(
        `SELECT kind, expires_at = created_at + interval '24 hours' AS backfilled
         FROM app.ai_operations WHERE id=$1`,
        [operationId],
      );
      return result.rows[0]!;
    });
    expect(row).toEqual({ kind: 'approval', backfilled: true });
    await ai.withTenantSession(0, async (tx, client) => {
      // Pin the plan space to index-only paths: on a near-empty table the
      // planner is free to satisfy ORDER BY via another index + sort (and
      // clock_timestamp() is volatile, so it is a filter, not a scan key) —
      // disabling seq/bitmap/sort makes ai_operations_expiry_idx the only
      // ordering provider, which is what this assertion is about.
      await client.query(
        `SET LOCAL enable_seqscan=off;
         SET LOCAL enable_bitmapscan=off;
         SET LOCAL enable_sort=off;
         SET LOCAL enable_incremental_sort=off`,
      );
      const explained = await client.query<{
        'QUERY PLAN': [{ Plan: PlanNode }];
      }>(
        `EXPLAIN (FORMAT JSON)
         SELECT id FROM app.ai_operations
         WHERE status='awaiting_approval' AND expires_at <= clock_timestamp()
         ORDER BY expires_at LIMIT 64`,
      );
      const plan = explained.rows[0]!['QUERY PLAN'][0]!.Plan;
      expect(planIndexes(plan)).toContain('ai_operations_expiry_idx');
    });
  } finally {
    await ai.close();
  }
});

test("a tenant cannot read or write kind/expires_at on another org's op", async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 5_000);
    expect(claim).not.toBeNull();
    const repository = new AiOperationRepository();
    const args = { value: 'cross-tenant' };
    const operation = await ai.withTenant(0, (tx) =>
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
    expect(operation.expiresAt).not.toBeNull();
    const probe = await ai.withTenantSession(1, async (tx, client) => {
      const selected = await client.query(
        'SELECT kind,expires_at FROM app.ai_operations WHERE id=$1',
        [operation.id],
      );
      const kindUpdate = await client.query(
        "UPDATE app.ai_operations SET kind='question' WHERE id=$1",
        [operation.id],
      );
      const expiryUpdate = await client.query(
        'UPDATE app.ai_operations SET expires_at=clock_timestamp() WHERE id=$1',
        [operation.id],
      );
      return {
        selected: selected.rowCount,
        kindUpdate: kindUpdate.rowCount,
        expiryUpdate: expiryUpdate.rowCount,
      };
    });
    expect(probe).toEqual({ selected: 0, kindUpdate: 0, expiryUpdate: 0 });
    const after = await ai.withTenantSession(0, async (tx, client) => {
      const row = (
        await client.query<{ kind: string; expires_at: Date | null }>(
          'SELECT kind,expires_at FROM app.ai_operations WHERE id=$1',
          [operation.id],
        )
      ).rows[0]!;
      return row;
    });
    expect(after.kind).toBe('approval');
    expect(after.expires_at).not.toBeNull();
  } finally {
    await ai.close();
  }
});
