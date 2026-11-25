import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { createRoleClient } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  hashOperationArgs,
  OutboxRepository,
  requireSession,
  RunActorFactsRepository,
} from '../../src/infrastructure/db/index.js';
import { OperationExpirySweep } from '../../src/modules/chat/expiry-sweep.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RunRegistry } from '../../src/modules/chat/index.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { JobExecutor, JobRegistry } from '../../src/modules/platform/index.js';
import {
  QueueConsumer,
  RunStreams,
} from '../../src/infrastructure/queue/index.js';
import { createRuntimeContext } from '../../src/bootstrap/context.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { runtimeEnvironment } from '../setup/runtime-environment.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// §7 expiry sweep: BullMQ-scheduled job `ai.operation-expiry.v1` on the
// ai-interactive queue; each `app.ai_expired_operations(64)` candidate is
// processed inside its own withTenant transaction keyed on the initiator.

type Ai = Awaited<ReturnType<typeof createAiFixture>>;

const approvalArgs = { newTitle: 'Expiry fixture rename' };
const questionArgs = {
  questions: [
    {
      questionId: 'q1',
      text: 'Which filing applies?',
      kind: 'single',
      options: [{ label: 'First' }, { label: 'Second' }],
      allowFreeText: false,
    },
  ],
};

function createStreams(ai: Ai, streamsUrl: string, prefix: string) {
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  return new RunStreams({
    url: streamsUrl,
    prefix,
    authority: {
      authorizeActive: (claim) =>
        ai.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamActiveProof(tx, claim),
        ),
      authorizeTerminal: (claim) =>
        ai.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamTerminalProof(tx, claim),
        ),
      authorizeCommitted: (claim, event) =>
        ai.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamCommittedProof(tx, claim, event),
        ),
      reconcile: async (entries) =>
        Promise.all(
          entries.map(async ({ runId, orgId, userId }) => {
            const result = await ai.database.withTenant(
              { orgId, userId },
              (tx) => runs.streamRegistryState(tx, runId, userId),
            );
            return result.state === 'terminal'
              ? { runId, state: 'terminal' as const, claim: result.claim }
              : { runId, state: result.state };
          }),
        ),
    },
  });
}

function createSweep(
  ai: Ai,
  streams?: RunStreams,
  logger?: { warn(event: Record<string, unknown>): void },
) {
  const registry = new RunRegistry();
  registry.register({
    profiles: [
      {
        id: 'test-profile',
        version: 1,
        allowedModels: ['synthetic/test'],
        defaultModel: 'synthetic/test',
        queue: 'ai-interactive',
        priority: 5,
        maxIterations: 3,
        tokenBudget: 4000,
        maxOutputTokens: 100,
        contextBudgets: {},
        capabilities: [],
      },
    ],
    contexts: [],
    tools: [],
  });
  return new OperationExpirySweep({
    database: ai.database,
    runs: new AiRunRepository(),
    steps: new AiStepRepository(),
    operations: new AiOperationRepository(ai.database),
    facts: new RunActorFactsRepository(),
    authorization: new RunAuthorizationService(),
    outbox: new OutboxRepository(),
    registry,
    ...(streams ? { streams } : {}),
    logger: logger ?? { warn: () => undefined },
  });
}

/**
 * Seeds the paused state a tool-proposal commit produces: step 1 claimed then
 * parked 'awaiting_approval', the op awaiting its owner with a past expiry,
 * and the run 'awaiting_approval' at next_sequence=2.
 */
async function seedPausedCandidate(
  ai: Ai,
  tenantIndex: number,
  options: {
    kind: 'approval' | 'question';
    expiredHoursAgo?: number;
    streams?: RunStreams;
  },
) {
  const tenant = ai.tenants[tenantIndex]!;
  const run = await ai.start(tenantIndex);
  await ai.seedPendingStep(tenantIndex, run.id);
  const claim = await ai.claim(tenantIndex, run.id, 1, 1, 30_000);
  expect(claim).not.toBeNull();
  // A run paused awaiting approval keeps the stream state (stream, guard,
  // context, generation) its active events created; publishCommitted only
  // appends to that existing state, so the seed publishes the start event
  // while the claim is still live.
  if (options.streams)
    expect(
      await options.streams.publish(claim!, {
        version: 1,
        runId: run.id,
        type: 'start',
        messageId: run.id,
      }),
    ).toBe('written');
  const args = options.kind === 'question' ? questionArgs : approvalArgs;
  const operation = await ai.withTenant(tenantIndex, async (tx) => {
    const persisted = await new AiOperationRepository().persist(tx, claim!, {
      callOccurrence: 0,
      toolName: options.kind === 'question' ? 'ask_user' : 'rename_chat',
      toolVersion: 1,
      mode: 'transactional',
      args,
      argsHash: hashOperationArgs(args),
      snapshotHash: createHash('sha256')
        .update(`expiry-${options.kind}-${randomUUID()}`)
        .digest('hex'),
      approvalRequired: true,
      kind: options.kind,
    });
    const { client } = requireSession(tx);
    await client.query(
      `UPDATE app.ai_steps SET state='awaiting_approval' WHERE id=$1`,
      [claim!.stepId],
    );
    const runs = new AiRunRepository();
    if (
      !(await runs.transition(tx, {
        runId: run.id,
        expectedVersion: 1,
        from: 'queued',
        to: 'running',
      })) ||
      !(await runs.transition(tx, {
        runId: run.id,
        expectedVersion: 2,
        from: 'running',
        to: 'awaiting_approval',
        nextSequence: 2,
      }))
    )
      throw new Error('Fixture run transition failed');
    await client.query(
      `UPDATE app.ai_operations
       SET expires_at=clock_timestamp()-interval '1 hour' * $2 WHERE id=$1`,
      [persisted.id, options.expiredHoursAgo ?? 1],
    );
    return persisted;
  });
  return { run, operation, tenant };
}

async function operationRow(ai: Ai, index: number, operationId: string) {
  return ai.withTenantSession(index, async (tx, client) => {
    const result = await client.query(
      `SELECT status::text,decision::text,decision_by_user_id::text,result,
              decided_at IS NOT NULL AS decided,completed_at IS NOT NULL AS completed,
              expires_at IS NULL AS expiry_cleared
         FROM app.ai_operations WHERE org_id=$1 AND id=$2`,
      [requireSession(tx).ctx.orgId, operationId],
    );
    return result.rows[0] as
      | {
          status: string;
          decision: string | null;
          decision_by_user_id: string | null;
          result: unknown;
          decided: boolean;
          completed: boolean;
          expiry_cleared: boolean;
        }
      | undefined;
  });
}

async function runRow(ai: Ai, index: number, runId: string) {
  return ai.withTenant(index, async (tx) => {
    const run = await new AiRunRepository().find(tx, runId);
    return run
      ? {
          status: run.status,
          runVersion: run.runVersion,
          nextSequence: run.nextSequence,
          errorCode: run.errorCode,
          completedAt: run.completedAt,
        }
      : null;
  });
}

async function auditRows(
  migrator: ReturnType<typeof createRoleClient>,
  type: string,
  operationId: string,
) {
  return (
    await migrator.query<{
      actor_user_id: string | null;
      outcome: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT actor_user_id,outcome,metadata FROM ops.audit_events
       WHERE type=$1 AND metadata->>'operationId'=$2`,
      [type, operationId],
    )
  ).rows;
}

async function runFinishedRows(
  migrator: ReturnType<typeof createRoleClient>,
  runId: string,
) {
  return (
    await migrator.query<{
      actor_user_id: string | null;
      outcome: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT actor_user_id,outcome,metadata FROM ops.audit_events
       WHERE type='chat.run_finished.v1' AND metadata->>'runId'=$1`,
      [runId],
    )
  ).rows;
}

async function resumeCount(
  ai: Ai,
  index: number,
  runId: string,
): Promise<number> {
  return ai.withTenantSession(index, async (tx, client) => {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ops.outbox
       WHERE org_id=$1 AND type='run.resume.v1' AND payload->>'runId'=$2`,
      [requireSession(tx).ctx.orgId, runId],
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function streamEvents(redis: Redis, prefix: string, runId: string) {
  const entries = await redis.xrange(
    `${prefix}:{run-streams}:${runId}:events`,
    '-',
    '+',
  );
  return entries.map(
    ([, fields]) =>
      JSON.parse(fields[1]!) as {
        type: string;
        status?: string;
        operationId?: string;
      },
  );
}

test('the scheduled sweep expires the op, audits actor-null and enqueues the resume', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const audit = createAuditInspector(services);
  const migrator = createRoleClient(services.migratorUrl);
  const redis = new Redis(services.valkey.streamsUrl);
  const queue = new Queue('ai-interactive', {
    connection: { url: services.valkey.queueUrl },
    prefix: services.queuePrefix,
  });
  const streams = createStreams(
    ai,
    services.valkey.streamsUrl,
    services.queuePrefix,
  );
  const sweep = createSweep(ai, streams);
  const consumer = new QueueConsumer(
    {
      url: services.valkey.queueUrl,
      limiterUrl: services.valkey.limiterUrl,
      prefix: services.queuePrefix,
    },
    new JobExecutor(ai.database),
    {},
    ai.database,
  );
  try {
    await migrator.connect();
    const seeded = await seedPausedCandidate(ai, 0, {
      kind: 'approval',
      streams,
    });
    const registry = new JobRegistry();
    registry.register('ai.operation-expiry.v1', {
      strategy: 'expiry-sweep',
      handle: () => sweep.sweep(),
    });
    await consumer.start(registry);
    await consumer.scheduleOperationExpiry();
    // §7 scheduler options, deduplicated by scheduler id on repeat upserts.
    const schedulers = await queue.getJobSchedulers();
    const expiry = schedulers.filter(
      (entry) => entry.key === 'ai-operation-expiry',
    );
    expect(expiry).toHaveLength(1);
    expect(expiry[0]).toMatchObject({
      name: 'ai.operation-expiry.v1',
      every: 60_000,
      template: {
        opts: {
          removeOnComplete: true,
          removeOnFail: { age: 86_400 },
        },
      },
    });
    // BullMQ stores the template without a `data` key when it is `{}`;
    // produced jobs still carry the empty data payload.
    expect(expiry[0]?.template?.data ?? {}).toEqual({});
    await consumer.scheduleOperationExpiry();
    expect(
      (await queue.getJobSchedulers()).filter(
        (entry) => entry.key === 'ai-operation-expiry',
      ),
    ).toHaveLength(1);

    await queue.add('ai.operation-expiry.v1', {});
    await expect
      .poll(() => operationRow(ai, 0, seeded.operation.id), {
        interval: 100,
        timeout: 10_000,
      })
      .toMatchObject({ status: 'expired' });

    expect(await operationRow(ai, 0, seeded.operation.id)).toMatchObject({
      status: 'expired',
      decision: null,
      decision_by_user_id: null,
      result: { expired: 'approval' },
      decided: true,
      completed: true,
      expiry_cleared: true,
    });
    expect(await runRow(ai, 0, seeded.run.id)).toMatchObject({
      status: 'running',
      runVersion: 4,
      nextSequence: 2,
    });
    expect(
      await ai.withTenant(0, (tx) =>
        new AiStepRepository().find(tx, {
          runId: seeded.run.id,
          sequence: 2,
        }),
      ),
    ).toMatchObject({ state: 'pending', expectedVersion: 4 });
    const resume = await ai.outboxForTenantRunSequence(
      seeded.tenant,
      seeded.run.id,
      2,
    );
    expect(resume).toMatchObject({
      id: stepJobId(seeded.run.id, 2),
      type: 'run.resume.v1',
      payload: {
        runId: seeded.run.id,
        sequence: 2,
        expectedVersion: 4,
      },
    });
    expect(await resumeCount(ai, 0, seeded.run.id)).toBe(1);
    const audits = await auditRows(
      migrator,
      'chat.approval_decided.v1',
      seeded.operation.id,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_user_id: null,
      outcome: 'failure',
      metadata: {
        runId: seeded.run.id,
        operationId: seeded.operation.id,
        status: 'expired',
      },
    });
    const events = await streamEvents(
      redis,
      services.queuePrefix,
      seeded.run.id,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'status',
        status: 'running',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'operation-status',
        status: 'expired',
        operationId: seeded.operation.id,
      }),
    );

    // A second pass leaves everything untouched (at-most-once via CAS+stepJobId).
    await queue.add('ai.operation-expiry.v1', {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await resumeCount(ai, 0, seeded.run.id)).toBe(1);
    expect(
      await auditRows(
        migrator,
        'chat.approval_decided.v1',
        seeded.operation.id,
      ),
    ).toHaveLength(1);
    await streams.close();
  } finally {
    await consumer.close();
    await queue.close();
    redis.disconnect();
    await migrator.end();
    await audit.close();
    await ai.close();
  }
});

test('a question op expires to the unanswered stored result', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const migrator = createRoleClient(services.migratorUrl);
  const sweep = createSweep(ai);
  try {
    await migrator.connect();
    const seeded = await seedPausedCandidate(ai, 0, { kind: 'question' });
    await sweep.sweep();
    expect(await operationRow(ai, 0, seeded.operation.id)).toMatchObject({
      status: 'expired',
      decision: null,
      decision_by_user_id: null,
      result: { unanswered: true },
      decided: true,
      completed: true,
      expiry_cleared: true,
    });
    expect(await runRow(ai, 0, seeded.run.id)).toMatchObject({
      status: 'running',
      runVersion: 4,
    });
    expect(await resumeCount(ai, 0, seeded.run.id)).toBe(1);
    const audits = await auditRows(
      migrator,
      'chat.question_decided.v1',
      seeded.operation.id,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_user_id: null,
      outcome: 'failure',
      metadata: { status: 'expired' },
    });
  } finally {
    await migrator.end();
    await ai.close();
  }
});

test('a candidate decided between listing and processing is a no-op', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const audit = createAuditInspector(services);
  const migrator = createRoleClient(services.migratorUrl);
  const sweep = createSweep(ai);
  try {
    await migrator.connect();
    const seeded = await seedPausedCandidate(ai, 0, { kind: 'approval' });
    const before = await audit.count('chat.approval_decided.v1');
    // The owner decides in the gap between the listing and the candidate tx.
    await ai.withTenant(0, (tx) =>
      new AiOperationRepository().decideApproval(tx, {
        runId: seeded.run.id,
        operationId: seeded.operation.id,
        snapshotHash: seeded.operation.snapshotHash,
        userId: seeded.tenant.userId,
        decision: 'approve',
      }),
    );
    await sweep.sweep();
    expect(await operationRow(ai, 0, seeded.operation.id)).toMatchObject({
      status: 'approved',
      decision: 'approve',
      decision_by_user_id: seeded.tenant.userId,
      expiry_cleared: true,
    });
    expect(await runRow(ai, 0, seeded.run.id)).toMatchObject({
      status: 'awaiting_approval',
      runVersion: 3,
    });
    expect(await resumeCount(ai, 0, seeded.run.id)).toBe(0);
    expect(await audit.count('chat.approval_decided.v1')).toBe(before);
  } finally {
    await migrator.end();
    await audit.close();
    await ai.close();
  }
});

test('a poison candidate expires the op but fails the run without a resume', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const migrator = createRoleClient(services.migratorUrl);
  const redis = new Redis(services.valkey.streamsUrl);
  const streams = createStreams(
    ai,
    services.valkey.streamsUrl,
    services.queuePrefix,
  );
  const sweep = createSweep(ai, streams);
  try {
    await migrator.connect();
    const seeded = await seedPausedCandidate(ai, 0, { kind: 'approval' });
    // The fixture tenants are personal orgs whose membership is immutable;
    // banning the initiator revokes access through the same `banned` fact.
    await migrator.query(`UPDATE auth."user" SET banned=true WHERE id=$1`, [
      seeded.tenant.userId,
    ]);

    await sweep.sweep();

    expect(await operationRow(ai, 0, seeded.operation.id)).toMatchObject({
      status: 'expired',
      decision: null,
      result: { expired: 'approval' },
      completed: true,
      expiry_cleared: true,
    });
    expect(await runRow(ai, 0, seeded.run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'AI_ACCESS_REVOKED',
      runVersion: 4,
    });
    expect((await runRow(ai, 0, seeded.run.id))!.completedAt).not.toBeNull();
    expect(
      await ai.withTenant(0, (tx) =>
        new AiStepRepository().find(tx, {
          runId: seeded.run.id,
          sequence: 2,
        }),
      ),
    ).toBeNull();
    expect(await resumeCount(ai, 0, seeded.run.id)).toBe(0);
    const audits = await auditRows(
      migrator,
      'chat.approval_decided.v1',
      seeded.operation.id,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_user_id: null,
      outcome: 'failure',
      metadata: { status: 'expired' },
    });
    // Every terminal run fires chat.run_finished.v1; the run's actor is the
    // initiator like every other run_finished emission.
    const finished = await runFinishedRows(migrator, seeded.run.id);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      actor_user_id: seeded.tenant.userId,
      outcome: 'failure',
    });
    // §8: run_finished metadata is ids/status/safeCode only — the exact key
    // set proves no K1 (the seeded args carry 'Expiry fixture rename').
    expect(finished[0]?.metadata).toEqual({
      runId: seeded.run.id,
      model: 'synthetic/test',
      provider: 'synthetic-provider',
      status: 'failed',
      safeCode: 'AI_ACCESS_REVOKED',
    });
    expect(JSON.stringify(finished[0])).not.toContain('Expiry fixture rename');
    const events = await streamEvents(
      redis,
      services.queuePrefix,
      seeded.run.id,
    );
    expect(events.some((event) => event.type === 'finish')).toBe(true);
    await streams.close();
  } finally {
    redis.disconnect();
    await migrator.end();
    await ai.close();
  }
});

test('a poison candidate never blocks the rest of the batch', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const migrator = createRoleClient(services.migratorUrl);
  const sweep = createSweep(ai);
  try {
    await migrator.connect();
    // Ordering by expires_at: the poison candidate is listed first.
    const poison = await seedPausedCandidate(ai, 0, {
      kind: 'approval',
      expiredHoursAgo: 2,
    });
    const healthy = await seedPausedCandidate(ai, 1, {
      kind: 'approval',
      expiredHoursAgo: 1,
    });
    await migrator.query(`UPDATE auth."user" SET banned=true WHERE id=$1`, [
      poison.tenant.userId,
    ]);

    await sweep.sweep();

    expect(await operationRow(ai, 0, poison.operation.id)).toMatchObject({
      status: 'expired',
    });
    expect(await runRow(ai, 0, poison.run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'AI_ACCESS_REVOKED',
    });
    expect(await resumeCount(ai, 0, poison.run.id)).toBe(0);
    expect(await operationRow(ai, 1, healthy.operation.id)).toMatchObject({
      status: 'expired',
      result: { expired: 'approval' },
    });
    expect(await runRow(ai, 1, healthy.run.id)).toMatchObject({
      status: 'running',
      runVersion: 4,
    });
    expect(await resumeCount(ai, 1, healthy.run.id)).toBe(1);
  } finally {
    await migrator.end();
    await ai.close();
  }
});

test('a candidate with an invalid resume priority skips the override, logs without K1 and is not retried', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const migrator = createRoleClient(services.migratorUrl);
  const warnings: Record<string, unknown>[] = [];
  const sweep = createSweep(ai, undefined, {
    warn: (event) => warnings.push(event),
  });
  try {
    await migrator.connect();
    // The fixture's resolved_config carries no routing, so the corrupt
    // routing is merged in: a valid queue with a poisoned priority. jsonb
    // cannot hold NaN (JSON.stringify(NaN) is 'null'), so the stored form of
    // a NaN priority is null; 1.5 and 0 reach the sweep as numbers.
    const invalidPriorities = [1.5, 0, null] as const;
    const seeded = [];
    for (const [index, priority] of invalidPriorities.entries()) {
      const candidate = await seedPausedCandidate(ai, index, {
        kind: 'approval',
      });
      await ai.withTenant(index, async (tx) => {
        const { client } = requireSession(tx);
        await client.query(
          `UPDATE app.ai_runs
           SET resolved_config = resolved_config || $2::jsonb
           WHERE id=$1`,
          [
            candidate.run.id,
            JSON.stringify({ queue: 'ai-interactive', priority }),
          ],
        );
      });
      seeded.push(candidate);
    }

    await sweep.sweep();

    for (const [index, candidate] of seeded.entries()) {
      expect(
        await operationRow(ai, index, candidate.operation.id),
      ).toMatchObject({
        status: 'expired',
        result: { expired: 'approval' },
        expiry_cleared: true,
      });
      expect(await runRow(ai, index, candidate.run.id)).toMatchObject({
        status: 'running',
        runVersion: 4,
      });
      // The invalid override is skipped: the resume lands on the default
      // queue with no priority rather than poisoning the append.
      const resume = await ai.outboxForTenantRunSequence(
        candidate.tenant,
        candidate.run.id,
        2,
      );
      expect(resume).toMatchObject({
        type: 'run.resume.v1',
        queue_name: null,
        priority: null,
      });
      expect(await resumeCount(ai, index, candidate.run.id)).toBe(1);
    }
    // One K1-free warn per skipped override: ids and a safe code only.
    expect(warnings).toHaveLength(invalidPriorities.length);
    for (const [index, warning] of warnings.entries())
      expect(warning).toEqual({
        event: 'ai_operation_expiry_invalid_routing',
        runId: seeded[index]!.run.id,
        operationId: seeded[index]!.operation.id,
        safeCode: 'AI_INTERNAL',
      });
    expect(JSON.stringify(warnings)).not.toContain('Expiry fixture rename');

    // Settled candidates never re-list: a second pass adds nothing.
    await sweep.sweep();
    expect(warnings).toHaveLength(invalidPriorities.length);
    for (const [index, candidate] of seeded.entries())
      expect(await resumeCount(ai, index, candidate.run.id)).toBe(1);
  } finally {
    await migrator.end();
    await ai.close();
  }
});

test('the ai-worker bootstrap registers the scheduler once per replica', async ({
  services,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-expiry-boot-'));
  const env = runtimeEnvironment(services, join(directory, 'health.json'));
  for (const key of Object.keys(env))
    if (key.startsWith('S3_')) delete env[key];
  const app = await createRuntimeContext(
    'ai-worker',
    loadRuntimeConfig('ai-worker', env),
  );
  const queue = new Queue('ai-interactive', {
    connection: { url: services.valkey.queueUrl },
    prefix: services.queuePrefix,
  });
  try {
    expect(app.get(OperationExpirySweep)).toBeInstanceOf(OperationExpirySweep);
    const schedulers = await queue.getJobSchedulers();
    const expiry = schedulers.filter(
      (entry) => entry.key === 'ai-operation-expiry',
    );
    expect(expiry).toHaveLength(1);
    expect(expiry[0]).toMatchObject({
      name: 'ai.operation-expiry.v1',
      every: 60_000,
      template: {
        opts: {
          removeOnComplete: true,
          removeOnFail: { age: 86_400 },
        },
      },
    });
    expect(expiry[0]?.template?.data ?? {}).toEqual({});
  } finally {
    await app.close();
    await queue.close();
    await rm(directory, { recursive: true, force: true });
  }
});
