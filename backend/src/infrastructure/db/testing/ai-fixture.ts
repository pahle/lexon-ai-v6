import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { AiAttemptRepository } from '../ai-attempt.repository.js';
import { AiCapacityRepository } from '../ai-capacity.repository.js';
import { AiRunRepository } from '../ai-run.repository.js';
import { AiStepRepository } from '../ai-step.repository.js';
import { TenantDatabase } from '../tenant-database.js';
import { inspectPool, requireSession } from '../tenant-session.js';
import { readAiConfig } from '../../../config/ai-config.js';
import type { StepClaim } from '../ai-records.js';

interface Services {
  readonly appUrl: string;
  readonly migratorUrl: string;
}
interface TenantFixture {
  readonly orgId: string;
  readonly userId: string;
}
const knownTenants: TenantFixture[] = [];

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

  async function start(index: number) {
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

  return {
    tenants,
    async close() {
      await Promise.all([
        database.close(),
        probeDatabase.close(),
        migrator.end(),
      ]);
    },
    start,
    async insertCrossTenantStep(index: number, runId: string) {
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
      const slotsCount = await countScoped(
        index,
        `SELECT count(*)::text AS count FROM app.ai_runs WHERE org_id=$1 AND status IN ('queued','running','awaiting_approval','cancelling')`,
      );
      return { runs: runsCount, outbox: outboxCount, slots: slotsCount };
    },
    orgSlotCount(index: number) {
      return countScoped(
        index,
        `SELECT count(*)::text AS count FROM app.ai_runs WHERE org_id=$1 AND status IN ('queued','running','awaiting_approval','cancelling')`,
      );
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
      await capacity.configure(readAiConfig({ AI_MAXLEN: '1000' }));
    },
  };
}
