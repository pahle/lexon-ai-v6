import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { AiAttemptRepository } from '../ai-attempt.repository.js';
import { AiCapacityRepository } from '../ai-capacity.repository.js';
import { AiRunRepository } from '../ai-run.repository.js';
import { AiStepRepository } from '../ai-step.repository.js';
import { TenantDatabase } from '../tenant-database.js';
import {
  inspectPool,
  requireSession,
  type TenantSession,
} from '../tenant-session.js';
import { readAiConfig } from '../../../config/ai-config.js';
import type { AttemptRecord, StepClaim } from '../ai-records.js';

interface Services {
  readonly appUrl: string;
  readonly migratorUrl: string;
}
interface TenantFixture {
  readonly orgId: string;
  readonly userId: string;
}

export async function recordAiTestToolEffect(
  tx: TenantSession,
  operationId: string,
  value: string,
): Promise<void> {
  const { client, ctx } = requireSession(tx);
  await client.query(
    'INSERT INTO app.ai_test_tool_effects(org_id,operation_id,value) VALUES($1,$2,$3)',
    [ctx.orgId, operationId, value],
  );
}

export async function queryAiTestSession(tx: TenantSession): Promise<void> {
  await requireSession(tx).client.query('SELECT 1');
}

export async function sleepInAiTestSession(
  tx: TenantSession,
  seconds: number,
): Promise<void> {
  await requireSession(tx).client.query('SELECT pg_sleep($1)', [seconds]);
}

const knownTenants: TenantFixture[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeAttempt(claim: StepClaim, ordinal: number): AttemptRecord {
  const now = new Date();
  return {
    attemptId: randomUUID(),
    orgId: claim.orgId,
    runId: claim.runId,
    stepId: claim.stepId,
    ordinal,
    modelId: 'synthetic/test',
    estimatorVersion: 'test-v1',
    estimatedInputTokens: 1,
    reservedInputTokens: 1,
    reservedOutputTokens: 4,
    generationId: null,
    provider: null,
    reportedInputTokens: null,
    reportedOutputTokens: null,
    cachedInputTokens: null,
    reasoningOutputTokens: null,
    costUsd: null,
    active: true,
    outcome: null,
    createdAt: now,
    settledAt: null,
  };
}

export async function createAiFixture(services: Services) {
  const migrator = new Pool({ connectionString: services.migratorUrl, max: 2 });
  const tenants: TenantFixture[] = [];
  try {
    for (let index = 0; index < 6; index++) {
      const userId = randomUUID();
      const email = `${userId}@example.test`;
      await migrator.query(
        `INSERT INTO auth."user"(id,name,email,email_verified,created_at,updated_at,onboarding_complete,pending_admin_activation)
         VALUES($1,$2,$3,true,clock_timestamp(),clock_timestamp(),true,false)`,
        [userId, `AI fixture ${index}`, email],
      );
      const organization = await migrator.query<{ id: string }>(
        'SELECT id FROM auth.organization WHERE personal_owner_id=$1',
        [userId],
      );
      if (!organization.rows[0])
        throw new Error('AI tenant fixture unavailable');
      tenants.push({ userId, orgId: organization.rows[0].id });
      knownTenants.push({ userId, orgId: organization.rows[0].id });
    }
  } catch (error) {
    await migrator.end();
    throw error;
  }

  // Test-only transactional effect target. It is deliberately absent from
  // production migrations and can only be written under the tenant RLS scope.
  await migrator.query(`
    CREATE TABLE IF NOT EXISTS app.ai_test_tool_effects (
      org_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      value text NOT NULL,
      PRIMARY KEY (org_id,operation_id)
    );
    ALTER TABLE app.ai_test_tool_effects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.ai_test_tool_effects FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_boundary ON app.ai_test_tool_effects;
    CREATE POLICY tenant_boundary ON app.ai_test_tool_effects FOR ALL TO lexon_app
      USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
      WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
    GRANT SELECT,INSERT,UPDATE,DELETE ON app.ai_test_tool_effects TO lexon_app;
  `);

  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 8,
    statementTimeoutMs: 10000,
  });
  const probeDatabase = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const attempts = new AiAttemptRepository();
  const capacity = new AiCapacityRepository(database);
  const independentCapacity = new AiCapacityRepository(probeDatabase);
  const config = readAiConfig({});
  for (const tenant of knownTenants)
    await database.withTenant(tenant, async (tx) => {
      const { client } = requireSession(tx);
      await client.query('DELETE FROM app.ai_runs WHERE org_id=$1', [
        tenant.orgId,
      ]);
      await client.query(
        "DELETE FROM ops.outbox WHERE org_id=$1 AND type='run.start.v1'",
        [tenant.orgId],
      );
    });
  await capacity.configure(config);

  async function start(
    index: number,
    budgets: { inputBudgetTokens?: number; outputBudgetTokens?: number } = {},
  ) {
    const tenant = tenants[index];
    if (!tenant) throw new Error('Invalid AI fixture tenant');
    const id = randomUUID();
    return database.withTenant(tenant, async (tx) => {
      const run = await runs.insert(tx, {
        id,
        orgId: tenant.orgId,
        initiatingUserId: tenant.userId,
        profileId: 'test-profile',
        profileVersion: 1,
        resolvedConfig: { model: 'synthetic/test' },
        modelId: 'synthetic/test',
        inputText: 'test input',
        inputBudgetTokens: budgets.inputBudgetTokens ?? 1000,
        outputBudgetTokens: budgets.outputBudgetTokens ?? 1000,
      });
      const { client } = requireSession(tx);
      await client.query(
        `INSERT INTO ops.outbox(id,type,org_id,user_id,payload) VALUES($1,'run.start.v1',$2,$3,$4::jsonb)`,
        [
          randomUUID(),
          tenant.orgId,
          tenant.userId,
          JSON.stringify({ runId: id }),
        ],
      );
      return run;
    });
  }

  async function countScoped(
    index: number,
    query: string,
    params: unknown[] = [],
  ) {
    const tenant = tenants[index];
    if (!tenant) throw new Error('Invalid AI fixture tenant');
    return database.withTenant(tenant, async (tx) => {
      const { client } = requireSession(tx);
      const result = await client.query<{ count: string }>(query, [
        tenant.orgId,
        ...params,
      ]);
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  async function waitForPgLockWait(pid: number): Promise<boolean> {
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = await migrator.query<{ waiting: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting',
        [pid],
      );
      if (result.rows[0]?.waiting) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  }

  async function waitForLeaseExpiry(
    index: number,
    stepId: string,
  ): Promise<void> {
    const tenant = tenants[index]!;
    for (let attempt = 0; attempt < 300; attempt++) {
      const expired = await database.withTenant(tenant, async (tx) => {
        const { client } = requireSession(tx);
        const result = await client.query<{ expired: boolean }>(
          'SELECT lease_until <= clock_timestamp() AS expired FROM app.ai_steps WHERE id=$1',
          [stepId],
        );
        return result.rows[0]?.expired ?? false;
      });
      if (expired) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('AI fixture lease did not expire');
  }

  async function actualSlotCount(orgId: string): Promise<number> {
    const slots = await migrator.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ops.ai_run_slots WHERE org_id=$1',
      [orgId],
    );
    return Number(slots.rows[0]?.count ?? 0);
  }

  async function insertPendingStep(index: number, runId: string) {
    const tenant = tenants[index];
    if (!tenant) throw new Error('Invalid AI fixture tenant');
    return database.withTenant(tenant, async (tx) => {
      const { client } = requireSession(tx);
      await client.query(
        `INSERT INTO app.ai_steps(id,org_id,run_id,sequence,expected_version,state)
         VALUES($1,$2,$3,1,1,'pending')`,
        [randomUUID(), tenant.orgId, runId],
      );
    });
  }

  return {
    database,
    capacity,
    capacityConfig: config,
    tenants,
    async close() {
      await Promise.all([
        database.close(),
        probeDatabase.close(),
        migrator.end(),
      ]);
    },
    start,
    withTenant<T>(index: number, work: (tx: TenantSession) => Promise<T>) {
      const tenant = tenants[index];
      if (!tenant) throw new Error('Invalid AI fixture tenant');
      return database.withTenant(tenant, work);
    },
    async expireClaimLeaseInSession(tx: TenantSession, claim: StepClaim) {
      const { client, ctx } = requireSession(tx);
      await client.query(
        "UPDATE app.ai_steps SET lease_until=clock_timestamp()-interval '1 second' WHERE org_id=$1 AND id=$2 AND fence=$3",
        [ctx.orgId, claim.stepId, claim.fence],
      );
    },
    insertCrossTenantStep(index: number, runId: string) {
      return insertPendingStep(index, runId);
    },
    seedPendingStep(index: number, runId: string) {
      return insertPendingStep(index, runId);
    },
    async receiptCount(outboxId: string): Promise<number> {
      const result = await migrator.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM ops.processed_jobs WHERE outbox_id=$1',
        [outboxId],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    async outboxCount(index: number, type: string): Promise<number> {
      return countScoped(
        index,
        'SELECT count(*)::text AS count FROM ops.outbox WHERE org_id=$1 AND type=$2',
        [type],
      );
    },
    async toolEffectCount(index: number): Promise<number> {
      const tenant = tenants[index];
      if (!tenant) throw new Error('Invalid AI fixture tenant');
      return countScoped(
        index,
        'SELECT count(*)::text AS count FROM app.ai_test_tool_effects WHERE org_id=$1',
      );
    },
    async toolEffectCountFor(tenant: TenantFixture): Promise<number> {
      const result = await migrator.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM app.ai_test_tool_effects WHERE org_id=$1',
        [tenant.orgId],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    async jsonbStorageBytes(index: number, value: unknown): Promise<number> {
      const tenant = tenants[index];
      if (!tenant) throw new Error('Invalid AI fixture tenant');
      return database.withTenant(tenant, async (tx) => {
        const { client } = requireSession(tx);
        const result = await client.query<{ bytes: number }>(
          'SELECT octet_length($1::jsonb::text)::int AS bytes',
          [JSON.stringify(value)],
        );
        return Number(result.rows[0]?.bytes);
      });
    },
    async outboxForRun(index: number, runId: string) {
      const tenant = tenants[index];
      if (!tenant) throw new Error('Invalid AI fixture tenant');
      return (
        (
          await migrator.query<{
            id: string;
            queue_name: string | null;
            priority: number | null;
            payload: unknown;
          }>(
            `SELECT id,queue_name,priority,payload FROM ops.outbox
           WHERE org_id=$1 AND type='run.start.v1' AND payload->>'runId'=$2`,
            [tenant.orgId, runId],
          )
        ).rows[0] ?? null
      );
    },
    async outboxForRunSequence(index: number, runId: string, sequence: number) {
      const tenant = tenants[index];
      if (!tenant) throw new Error('Invalid AI fixture tenant');
      return (
        (
          await migrator.query<{
            id: string;
            type: string;
            queue_name: string | null;
            priority: number | null;
            payload: unknown;
          }>(
            `SELECT id,type,queue_name,priority,payload FROM ops.outbox
           WHERE org_id=$1 AND payload->>'runId'=$2 AND (payload->>'sequence')::int=$3`,
            [tenant.orgId, runId, sequence],
          )
        ).rows[0] ?? null
      );
    },
    async outboxForTenantRunSequence(
      tenant: TenantFixture,
      runId: string,
      sequence: number,
    ) {
      return (
        (
          await migrator.query<{
            id: string;
            type: string;
            queue_name: string | null;
            priority: number | null;
            payload: unknown;
          }>(
            `SELECT id,type,queue_name,priority,payload FROM ops.outbox
             WHERE org_id=$1 AND payload->>'runId'=$2 AND (payload->>'sequence')::int=$3`,
            [tenant.orgId, runId, sequence],
          )
        ).rows[0] ?? null
      );
    },
    async noContextCounts(): Promise<number[]> {
      const fresh = new Client({ connectionString: services.appUrl });
      await fresh.connect();
      let freshCount: number;
      try {
        const result = await fresh.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM app.ai_runs',
        );
        freshCount = Number(result.rows[0]?.count ?? 0);
      } finally {
        await fresh.end();
      }
      const tenant = tenants[0]!;
      await probeDatabase.withTenant(tenant, async (tx) => {
        const { client } = requireSession(tx);
        await client.query('SELECT count(*) FROM app.ai_runs');
      });
      const client = await inspectPool(probeDatabase).connect();
      try {
        const result = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM app.ai_runs',
        );
        return [freshCount, Number(result.rows[0]?.count ?? 0)];
      } finally {
        client.release();
      }
    },
    async seedClaimableStep(
      index: number,
      runId: string,
      options: { activeAttempt: boolean },
    ) {
      const tenant = tenants[index]!;
      return database.withTenant(tenant, async (tx) => {
        const stepId = randomUUID();
        const { client } = requireSession(tx);
        await client.query(
          `INSERT INTO app.ai_steps(id,org_id,run_id,sequence,expected_version,state)
           VALUES($1,$2,$3,1,1,'pending')`,
          [stepId, tenant.orgId, runId],
        );
        const claim = await steps.claim(tx, {
          runId,
          sequence: 1,
          expectedVersion: 1,
          leaseMs: 30000,
        });
        if (!claim) throw new Error('AI fixture claim unavailable');
        if (options.activeAttempt) {
          const now = new Date();
          const settledAttemptId = randomUUID();
          await attempts.insert(tx, claim, {
            attemptId: settledAttemptId,
            orgId: tenant.orgId,
            runId,
            stepId,
            ordinal: 1,
            modelId: 'synthetic/test',
            estimatorVersion: 'test-v1',
            estimatedInputTokens: 1,
            reservedInputTokens: 1,
            reservedOutputTokens: 4,
            generationId: null,
            provider: null,
            reportedInputTokens: null,
            reportedOutputTokens: null,
            cachedInputTokens: null,
            reasoningOutputTokens: null,
            costUsd: null,
            active: true,
            outcome: null,
            createdAt: now,
            settledAt: null,
          });
          if (
            !(await attempts.settle(tx, claim, {
              attemptId: settledAttemptId,
              outcome: 'succeeded',
              usage: { inputTokens: 1, outputTokens: 1 },
              costUsd: '0.01',
            }))
          )
            throw new Error('AI fixture settlement unavailable');
          await attempts.insert(tx, claim, {
            attemptId: randomUUID(),
            orgId: tenant.orgId,
            runId,
            stepId,
            ordinal: 2,
            modelId: 'synthetic/test',
            estimatorVersion: 'test-v1',
            estimatedInputTokens: 1,
            reservedInputTokens: 1,
            reservedOutputTokens: 4,
            generationId: null,
            provider: null,
            reportedInputTokens: null,
            reportedOutputTokens: null,
            cachedInputTokens: null,
            reasoningOutputTokens: null,
            costUsd: null,
            active: true,
            outcome: null,
            createdAt: new Date(),
            settledAt: null,
          });
          await client.query(
            "UPDATE app.ai_steps SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
            [stepId],
          );
        }
        return claim;
      });
    },
    async insertWhileTakeoverWaits(index: number, claim: StepClaim) {
      const tenant = tenants[index]!;
      await database.withTenant(tenant, async (tx) => {
        const { client } = requireSession(tx);
        await client.query(
          "UPDATE app.ai_steps SET lease_until=clock_timestamp()+interval '250 milliseconds' WHERE id=$1",
          [claim.stepId],
        );
      });
      const ready = deferred<void>();
      const release = deferred<void>();
      const takeoverStarted = deferred<number>();
      const writer = database.withTenant(tenant, async (tx) => {
        await attempts.insert(tx, claim, makeAttempt(claim, 1));
        ready.resolve();
        await release.promise;
      });
      void writer.catch(ready.reject);
      await ready.promise;
      let takeover: Promise<StepClaim | null> | undefined;
      let writerRetainedRunLock: boolean;
      try {
        await waitForLeaseExpiry(index, claim.stepId);
        takeover = database.withTenant(tenant, async (tx) => {
          const { client } = requireSession(tx);
          const backend = await client.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          );
          takeoverStarted.resolve(backend.rows[0]!.pid);
          return steps.claim(tx, {
            runId: claim.runId,
            sequence: claim.sequence,
            expectedVersion: claim.expectedVersion,
            leaseMs: 30_000,
          });
        });
        writerRetainedRunLock = await waitForPgLockWait(
          await takeoverStarted.promise,
        );
      } finally {
        release.resolve();
      }
      const [, takeoverClaim] = await Promise.all([writer, takeover!]);
      if (!takeoverClaim) throw new Error('AI fixture takeover unavailable');
      return {
        writerRetainedRunLock,
        takeoverFence: takeoverClaim.fence,
        attempts: await database.withTenant(tenant, (tx) =>
          attempts.list(tx, claim.runId),
        ),
      };
    },
    async checkpointWhileTakeoverWaits(index: number, claim: StepClaim) {
      const tenant = tenants[index]!;
      const attempt = makeAttempt(claim, 1);
      await database.withTenant(tenant, async (tx) => {
        await attempts.insert(tx, claim, attempt);
        const { client } = requireSession(tx);
        await client.query(
          "UPDATE app.ai_steps SET lease_until=clock_timestamp()+interval '250 milliseconds' WHERE id=$1",
          [claim.stepId],
        );
      });
      const ready = deferred<void>();
      const release = deferred<void>();
      const takeoverStarted = deferred<number>();
      const writer = database.withTenant(tenant, async (tx) => {
        const checkpointed = await steps.checkpoint(tx, claim, {
          attemptId: attempt.attemptId,
          text: 'checkpoint before takeover',
        });
        if (!checkpointed) throw new Error('AI fixture checkpoint unavailable');
        ready.resolve();
        await release.promise;
      });
      void writer.catch(ready.reject);
      await ready.promise;
      let takeover: Promise<StepClaim | null> | undefined;
      let writerRetainedRunLock: boolean;
      try {
        await waitForLeaseExpiry(index, claim.stepId);
        takeover = database.withTenant(tenant, async (tx) => {
          const { client } = requireSession(tx);
          const backend = await client.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid',
          );
          takeoverStarted.resolve(backend.rows[0]!.pid);
          return steps.claim(tx, {
            runId: claim.runId,
            sequence: claim.sequence,
            expectedVersion: claim.expectedVersion,
            leaseMs: 30_000,
          });
        });
        writerRetainedRunLock = await waitForPgLockWait(
          await takeoverStarted.promise,
        );
      } finally {
        release.resolve();
      }
      const [, takeoverClaim] = await Promise.all([writer, takeover!]);
      if (!takeoverClaim) throw new Error('AI fixture takeover unavailable');
      return {
        writerRetainedRunLock,
        takeoverFence: takeoverClaim.fence,
        checkpointCount: await countScoped(
          index,
          'SELECT count(*)::text AS count FROM app.ai_checkpoints WHERE org_id=$1 AND run_id=$2',
          [claim.runId],
        ),
      };
    },
    async commitWhileTransitionWaits(
      index: number,
      runId: string,
      claim: StepClaim,
    ) {
      const tenant = tenants[index]!;
      const ready = deferred<void>();
      const release = deferred<void>();
      const transitionStarted = deferred<number>();
      const writer = database.withTenant(tenant, async (tx) => {
        const committed = await steps.commit(tx, claim, {
          state: 'committed',
          text: 'commit before transition',
          data: {},
        });
        if (!committed) throw new Error('AI fixture commit unavailable');
        ready.resolve();
        await release.promise;
      });
      void writer.catch(ready.reject);
      await ready.promise;
      const transition = database.withTenant(tenant, async (tx) => {
        const { client } = requireSession(tx);
        const backend = await client.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        transitionStarted.resolve(backend.rows[0]!.pid);
        return runs.transition(tx, {
          runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'failed',
        });
      });
      const commitRetainedRunLock = await waitForPgLockWait(
        await transitionStarted.promise,
      );
      release.resolve();
      const [, transitioned] = await Promise.all([writer, transition]);
      return {
        commitRetainedRunLock,
        transitioned,
        runVersion: await database.withTenant(
          tenant,
          async (tx) => (await runs.find(tx, runId))?.runVersion ?? null,
        ),
      };
    },
    async checkpointRetry(index: number, claim: StepClaim) {
      const tenant = tenants[index]!;
      return database.withTenant(tenant, async (tx) => {
        const first = makeAttempt(claim, 1);
        await attempts.insert(tx, claim, first);
        if (
          !(await steps.checkpoint(tx, claim, {
            attemptId: first.attemptId,
            text: 'first attempt output',
          }))
        )
          throw new Error('AI fixture first checkpoint unavailable');
        if (
          !(await attempts.settle(tx, claim, {
            attemptId: first.attemptId,
            outcome: 'failed',
          }))
        )
          throw new Error('AI fixture first attempt settlement unavailable');
        const second = makeAttempt(claim, 2);
        await attempts.insert(tx, claim, second);
        return steps.checkpoint(tx, claim, {
          attemptId: second.attemptId,
          text: 'replacement attempt output',
        });
      });
    },
    claim(
      index: number,
      runId: string,
      sequence: number,
      expectedVersion: number,
      leaseMs: number,
    ) {
      const tenant = tenants[index]!;
      return database.withTenant(tenant, (tx) =>
        steps.claim(tx, { runId, sequence, expectedVersion, leaseMs }),
      );
    },
    async persistAttemptLifecycle(index: number, claim: StepClaim) {
      const tenant = tenants[index]!;
      return database.withTenant(tenant, async (tx) => {
        const attemptId = randomUUID();
        await attempts.insert(tx, claim, {
          attemptId,
          orgId: tenant.orgId,
          runId: claim.runId,
          stepId: claim.stepId,
          ordinal: 1,
          modelId: 'synthetic/test',
          estimatorVersion: 'test-v1',
          estimatedInputTokens: 20,
          reservedInputTokens: 21,
          reservedOutputTokens: 10,
          generationId: null,
          provider: null,
          reportedInputTokens: null,
          reportedOutputTokens: null,
          cachedInputTokens: null,
          reasoningOutputTokens: null,
          costUsd: null,
          active: true,
          outcome: null,
          createdAt: new Date(),
          settledAt: null,
        });
        const metadata = await attempts.updateMetadata(tx, claim, {
          attemptId,
          generationId: 'generation-1',
          provider: 'synthetic-provider',
        });
        const renewed = await steps.renew(tx, claim, 30_000);
        const checkpoint = await steps.checkpoint(tx, claim, {
          attemptId,
          text: 'provisional output',
        });
        const settled = await attempts.settle(tx, claim, {
          attemptId,
          outcome: 'succeeded',
          usage: {
            inputTokens: 17,
            outputTokens: 9,
            cachedInputTokens: 2,
            reasoningOutputTokens: 3,
          },
          costUsd: '0.001',
        });
        const committed = await steps.commit(tx, claim, {
          state: 'committed',
          text: 'committed output',
          data: { accepted: true },
        });
        const attempt = (await attempts.list(tx, claim.runId))[0];
        return { metadata, renewed, checkpoint, settled, committed, attempt };
      });
    },
    async activeAttemptOutcomes(index: number, runId: string) {
      const tenant = tenants[index]!;
      return database.withTenant(tenant, async (tx) =>
        (await attempts.list(tx, runId)).map((attempt) => attempt.outcome),
      );
    },
    async oldClaimCanWrite(claim: StepClaim) {
      const tenant = tenants.find((value) => value.orgId === claim.orgId)!;
      return database.withTenant(tenant, async (tx) => {
        const attemptId = (await attempts.list(tx, claim.runId)).find(
          (attempt) => attempt.outcome === 'unknown',
        )?.attemptId;
        if (!attemptId) throw new Error('AI fixture attempt unavailable');
        return {
          renew: await steps.renew(tx, claim, 1000),
          metadata: await attempts.updateMetadata(tx, claim, {
            attemptId,
            generationId: randomUUID(),
            provider: 'test',
          }),
          checkpoint: await steps.checkpoint(tx, claim, {
            attemptId,
            text: 'late write',
          }),
          settle: await attempts.settle(tx, claim, {
            attemptId,
            outcome: 'succeeded',
          }),
          commit: await steps.commit(tx, claim, {
            state: 'committed',
            text: 'late commit',
            data: {},
          }),
        };
      });
    },
    async runVersion(index: number, runId: string) {
      const tenant = tenants[index]!;
      return database.withTenant(
        tenant,
        async (tx) => (await runs.find(tx, runId))?.runVersion ?? null,
      );
    },
    async admittedRunCount() {
      let count = 0;
      for (let index = 0; index < tenants.length; index++)
        count += await countScoped(
          index,
          `SELECT count(*)::text AS count FROM app.ai_runs WHERE org_id=$1 AND status IN ('queued','running','awaiting_approval','cancelling')`,
        );
      return count;
    },
    async losingStartCounts(index: number) {
      const runsCount = await countScoped(
        index,
        'SELECT count(*)::text AS count FROM app.ai_runs WHERE org_id=$1',
      );
      const outboxCount = await countScoped(
        index,
        "SELECT count(*)::text AS count FROM ops.outbox WHERE org_id=$1 AND type='run.start.v1'",
      );
      const slotsCount = await actualSlotCount(tenants[index]!.orgId);
      return { runs: runsCount, outbox: outboxCount, slots: slotsCount };
    },
    async orgSlotCount(index: number) {
      return actualSlotCount(tenants[index]!.orgId);
    },
    async orgSlotCountFor(tenant: TenantFixture) {
      return actualSlotCount(tenant.orgId);
    },
    async transition(
      index: number,
      runId: string,
      expectedVersion: number,
      from: string,
      to: string,
    ) {
      const tenant = tenants[index]!;
      return database.withTenant(tenant, (tx) =>
        runs.transition(tx, {
          runId,
          expectedVersion,
          from: from as 'queued' | 'running' | 'completed',
          to: to as 'running' | 'completed' | 'awaiting_approval' | 'failed',
        }),
      );
    },
    async startThenRollback(index: number) {
      const tenant = tenants[index]!;
      return database.withTenant(tenant, async (tx) => {
        const run = await runs.insert(tx, {
          id: randomUUID(),
          orgId: tenant.orgId,
          initiatingUserId: tenant.userId,
          profileId: 'test-profile',
          profileVersion: 1,
          resolvedConfig: { model: 'synthetic/test' },
          modelId: 'synthetic/test',
          inputText: 'rolled back',
          inputBudgetTokens: 1000,
          outputBudgetTokens: 1000,
        });
        const { client } = requireSession(tx);
        await client.query(
          `INSERT INTO ops.outbox(id,type,org_id,user_id,payload) VALUES($1,'run.start.v1',$2,$3,$4::jsonb)`,
          [
            randomUUID(),
            tenant.orgId,
            tenant.userId,
            JSON.stringify({ runId: run.id }),
          ],
        );
        throw new Error('fixture rollback');
      });
    },
    async configureMismatchedCapacity() {
      await independentCapacity.configure(readAiConfig({ AI_MAXLEN: '1000' }));
    },
    async configureCapacityFromIndependentRepository() {
      await independentCapacity.configure(config);
    },
    async capacityMutationSqlStates() {
      const pool = inspectPool(database);
      const update = await pool
        .query(
          'UPDATE ops.ai_engine_capacity SET configured_at=configured_at WHERE singleton=true',
        )
        .then(() => null)
        .catch((error: { code?: string }) => error.code ?? 'unknown');
      const deletion = await pool
        .query('DELETE FROM ops.ai_engine_capacity WHERE singleton=true')
        .then(() => null)
        .catch((error: { code?: string }) => error.code ?? 'unknown');
      return { update, deletion };
    },
  };
}
