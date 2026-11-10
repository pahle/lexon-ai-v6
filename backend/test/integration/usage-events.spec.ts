import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  TenantDatabase,
  UsageEventRepository,
} from '../../src/infrastructure/db/index.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import { unscopedUsageEventProbe } from '../../src/infrastructure/db/testing/usage-event-probe.js';
import { StepCoordinator } from '../../src/modules/chat/step-coordinator.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { JobExecutor } from '../../src/modules/platform/job-executor.js';
import { AttemptService } from '../../src/modules/usage/attempt.service.js';
import { estimateInputTokens } from '../../src/modules/usage/token-estimator.js';
import { UsageEventsService } from '../../src/modules/usage/usage-events.service.js';
import { test } from '../setup/file-services.js';
import { createAttemptHarness } from '../setup/ai-attempt-fixture.js';

test('unknown first attempt retains the full maximum reservation and blocks a third attempt', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services, {
    inputBudgetTokens: 360_448,
    outputBudgetTokens: 32_768,
  });
  try {
    const makeInput = (content: string) => ({
      model: 'synthetic/model',
      provider: 'synthetic',
      effort: 'max' as const,
      messages: [{ role: 'user' as const, content }],
      maxOutputTokens: 32_768,
      signal: new AbortController().signal,
    });
    let low = 0;
    let high = 163_840;
    let content = '';
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = 'x'.repeat(middle);
      const estimate = estimateInputTokens(makeInput(candidate)).inputTokens;
      if (estimate === 163_840) {
        content = candidate;
        break;
      }
      if (estimate < 163_840) low = middle + 1;
      else high = middle - 1;
    }
    const modelInput = makeInput(content);
    expect(estimateInputTokens(modelInput).inputTokens).toBe(163_840);
    const service = harness.newService();
    await harness.withTenant(async (tx) => {
      const firstId = randomUUID();
      await service.reserve(tx, harness.claim, {
        attemptId: firstId,
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: 393_216,
          maxOutputTokens: 32_768,
        },
      });
      await service.settle(tx, harness.claim, {
        attemptId: firstId,
        outcome: 'unknown',
      });
      await service.reserve(tx, harness.claim, {
        attemptId: randomUUID(),
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: 393_216,
          maxOutputTokens: 32_768,
        },
      });
      await expect(
        service.reserve(tx, harness.claim, {
          attemptId: randomUUID(),
          modelInput,
          limits: {
            maxAttemptsPerStep: 2,
            tokenBudget: 393_216,
            maxOutputTokens: 32_768,
          },
        }),
      ).rejects.toMatchObject({ code: 'AI_ATTEMPT_LIMIT' });
      expect(await service.remaining(tx, harness.runId)).toBe(0);
    });
  } finally {
    await harness.close();
  }
});

test('runtime role cannot delete or truncate durable usage events', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  const attempt = await harness.withTenant((tx) =>
    harness.newService().reserve(tx, harness.claim, {
      attemptId: randomUUID(),
      modelInput: {
        model: 'synthetic/model',
        provider: 'synthetic',
        messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
        maxOutputTokens: 256,
        signal: new AbortController().signal,
      },
      limits: {
        maxAttemptsPerStep: 2,
        tokenBudget: harness.tokenBudget,
        maxOutputTokens: 256,
      },
    }),
  );
  try {
    await harness.withTenantClient(async (_tx, client) => {
      await client.query('SAVEPOINT deny_usage_delete');
      await expect(
        client.query('DELETE FROM app.usage_events WHERE attempt_id=$1', [
          attempt.attemptId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT deny_usage_delete');

      await client.query('SAVEPOINT deny_usage_truncate');
      await expect(
        client.query('TRUNCATE app.usage_events'),
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT deny_usage_truncate');
    });
  } finally {
    await harness.close();
  }
});

test('reserving a model attempt durably records its content-free identity', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const modelInput = {
      model: 'synthetic/model',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
      maxOutputTokens: 256,
      signal: new AbortController().signal,
    };
    const reserved = await harness.withTenant((tx) =>
      harness.newService().reserve(tx, harness.claim, {
        attemptId: randomUUID(),
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: harness.tokenBudget,
          maxOutputTokens: modelInput.maxOutputTokens,
        },
      }),
    );

    const rows = await harness.withTenantClient(async (_tx, client) => {
      const result = await client.query<{
        attempt_id: string;
        actor_user_id: string;
        run_id: string;
        step_id: string;
        model_id: string;
        requested_provider: string;
        observed_provider: string | null;
        resolved_effort: string | null;
        instruction_version: string | null;
        outcome: string;
      }>(
        `SELECT attempt_id,actor_user_id,run_id,step_id,model_id,requested_provider,
                observed_provider,resolved_effort,instruction_version,outcome
         FROM app.usage_events WHERE attempt_id=$1`,
        [reserved.attemptId],
      );
      return result.rows;
    });

    expect(rows).toEqual([
      {
        attempt_id: reserved.attemptId,
        actor_user_id: harness.claim.userId,
        run_id: harness.claim.runId,
        step_id: harness.claim.stepId,
        model_id: 'synthetic/model',
        requested_provider: 'synthetic',
        observed_provider: null,
        resolved_effort: null,
        instruction_version: null,
        outcome: 'reserved',
      },
    ]);
  } finally {
    await harness.close();
  }
});

test('metadata and normal settlement are durable and idempotent per attempt', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const modelInput = {
      model: 'synthetic/model',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
      maxOutputTokens: 256,
      signal: new AbortController().signal,
    };
    const attempt = await harness.withTenant((tx) =>
      harness.newService().reserve(tx, harness.claim, {
        attemptId: randomUUID(),
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: harness.tokenBudget,
          maxOutputTokens: modelInput.maxOutputTokens,
        },
      }),
    );
    await harness.withTenant((tx) =>
      harness.newService().metadata(tx, harness.claim, {
        attemptId: attempt.attemptId,
        generationId: 'generation-1',
        provider: 'synthetic-observed',
      }),
    );
    await harness.withTenant((tx) =>
      harness.newService().settle(tx, harness.claim, {
        attemptId: attempt.attemptId,
        outcome: 'succeeded',
        usage: {
          inputTokens: 61,
          outputTokens: 19,
          cachedInputTokens: 7,
          reasoningOutputTokens: 37,
        },
        costUsd: '0.0125',
      }),
    );

    const duplicate = await harness.withTenant((tx) =>
      new UsageEventsService().settle(tx, attempt.attemptId, {
        outcome: 'succeeded',
        inputTokens: 61,
        outputTokens: 19,
        cachedInputTokens: 7,
        reasoningOutputTokens: 37,
        costUsd: '0.0125',
      }),
    );
    expect(duplicate).toBe('duplicate');
    await expect(
      harness.withTenant((tx) =>
        new UsageEventsService().settle(tx, attempt.attemptId, {
          outcome: 'failed',
          inputTokens: 61,
          outputTokens: 19,
          cachedInputTokens: 7,
          reasoningOutputTokens: 37,
          costUsd: '0.0125',
        }),
      ),
    ).rejects.toThrow('Conflicting usage event settlement');

    const rows = await harness.withTenantClient(async (_tx, client) => {
      const result = await client.query<{
        generation_id: string | null;
        observed_provider: string | null;
        reported_input_tokens: number | null;
        reported_output_tokens: number | null;
        cached_input_tokens: number | null;
        reasoning_output_tokens: number | null;
        cost_usd: string | null;
        outcome: string;
      }>(
        `SELECT generation_id,observed_provider,reported_input_tokens,reported_output_tokens,
                cached_input_tokens,reasoning_output_tokens,cost_usd,outcome
         FROM app.usage_events WHERE attempt_id=$1`,
        [attempt.attemptId],
      );
      return result.rows;
    });
    expect(rows).toEqual([
      {
        generation_id: 'generation-1',
        observed_provider: 'synthetic-observed',
        reported_input_tokens: 61,
        reported_output_tokens: 19,
        cached_input_tokens: 7,
        reasoning_output_tokens: 37,
        cost_usd: '0.0125',
        outcome: 'succeeded',
      },
    ]);
    await expect(
      harness.withTenantClient((_tx, client) => {
        return client.query(
          "UPDATE app.usage_events SET cost_usd='Infinity' WHERE attempt_id=$1",
          [attempt.attemptId],
        );
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      harness.withTenantClient((_tx, client) => {
        return client.query(
          'UPDATE app.usage_events SET reasoning_output_tokens=-1 WHERE attempt_id=$1',
          [attempt.attemptId],
        );
      }),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await harness.close();
  }
});

test('unknown usage survives execution deletion and accepts one late result', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const modelInput = {
      model: 'synthetic/model',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
      maxOutputTokens: 256,
      signal: new AbortController().signal,
    };
    const attempt = await harness.withTenant((tx) =>
      harness.newService().reserve(tx, harness.claim, {
        attemptId: randomUUID(),
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: harness.tokenBudget,
          maxOutputTokens: modelInput.maxOutputTokens,
        },
      }),
    );
    await harness.withTenant((tx) =>
      new UsageEventsService().markUnknown(tx, attempt.attemptId),
    );
    await harness.withTenantClient(async (_tx, client) => {
      await client.query('DELETE FROM app.ai_runs WHERE org_id=$1 AND id=$2', [
        harness.claim.orgId,
        harness.runId,
      ]);
    });
    await harness.withTenant((tx) =>
      new UsageEventsService().metadata(tx, attempt.attemptId, {
        generationId: 'late-generation-1',
        provider: 'late-observed',
      }),
    );

    const result = {
      outcome: 'succeeded' as const,
      inputTokens: 91,
      outputTokens: 43,
      cachedInputTokens: 2,
      reasoningOutputTokens: 37,
      costUsd: '0.037',
    };
    expect(
      await harness.withTenant((tx) =>
        new UsageEventsService().settle(tx, attempt.attemptId, result),
      ),
    ).toBe('recorded');
    expect(
      await harness.withTenant((tx) =>
        new UsageEventsService().settle(tx, attempt.attemptId, result),
      ),
    ).toBe('duplicate');

    const rows = await harness.withTenantClient(async (_tx, client) => {
      const result = await client.query<{
        attempt_id: string;
        reasoning_output_tokens: number | null;
        generation_id: string | null;
        observed_provider: string | null;
      }>(
        `SELECT attempt_id,reasoning_output_tokens,generation_id,observed_provider
         FROM app.usage_events WHERE attempt_id=$1`,
        [attempt.attemptId],
      );
      return result.rows;
    });
    expect(rows).toEqual([
      {
        attempt_id: attempt.attemptId,
        reasoning_output_tokens: 37,
        generation_id: 'late-generation-1',
        observed_provider: 'late-observed',
      },
    ]);
    expect(await harness.listAttempts()).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('settlement without a reservation is rejected', async ({ services }) => {
  const harness = await createAttemptHarness(services);
  try {
    await expect(
      harness.withTenant((tx) =>
        new UsageEventsService().settle(tx, randomUUID(), {
          outcome: 'succeeded',
          inputTokens: 1,
          outputTokens: 1,
        }),
      ),
    ).rejects.toThrow('Usage event reservation unavailable');
  } finally {
    await harness.close();
  }
});

test('reservation and ledger settlement roll back together', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const modelInput = {
      model: 'synthetic/model',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
      maxOutputTokens: 256,
      signal: new AbortController().signal,
    };
    const attemptId = randomUUID();
    await expect(
      harness.withTenant(async (tx) => {
        await harness.newService().reserve(tx, harness.claim, {
          attemptId,
          modelInput,
          limits: {
            maxAttemptsPerStep: 2,
            tokenBudget: harness.tokenBudget,
            maxOutputTokens: modelInput.maxOutputTokens,
          },
        });
        await harness.newService().settle(tx, harness.claim, {
          attemptId,
          outcome: 'succeeded',
          usage: { inputTokens: 11, outputTokens: 5 },
        });
        throw new Error('rollback fixture');
      }),
    ).rejects.toThrow('rollback fixture');
    const counts = await harness.withTenantClient(async (_tx, client) => {
      const result = await client.query<{ attempts: string; events: string }>(
        `SELECT (SELECT count(*) FROM app.ai_attempts WHERE id=$1)::text AS attempts,
                (SELECT count(*) FROM app.usage_events WHERE attempt_id=$1)::text AS events`,
        [attemptId],
      );
      return result.rows[0];
    });
    expect(counts).toEqual({ attempts: '0', events: '0' });
  } finally {
    await harness.close();
  }
});

test('usage events stay isolated on fresh and reused unscoped connections', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10_000,
  });
  try {
    const modelInput = {
      model: 'synthetic/model',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
      maxOutputTokens: 256,
      signal: new AbortController().signal,
    };
    const attempt = await harness.withTenant((tx) =>
      harness.newService().reserve(tx, harness.claim, {
        attemptId: randomUUID(),
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: harness.tokenBudget,
          maxOutputTokens: modelInput.maxOutputTokens,
        },
      }),
    );
    expect(
      await unscopedUsageEventProbe({
        appUrl: services.appUrl,
        attemptId: attempt.attemptId,
      }),
    ).toEqual([]);
    expect(
      await db.withTenant({ orgId: randomUUID() }, (tx) =>
        new UsageEventRepository().exists(tx, attempt.attemptId),
      ),
    ).toBe(false);
    expect(
      await unscopedUsageEventProbe({
        appUrl: services.appUrl,
        attemptId: attempt.attemptId,
        reuseAfter: {
          orgId: harness.claim.orgId,
          userId: harness.claim.userId,
        },
      }),
    ).toEqual([]);
  } finally {
    await db.close();
    await harness.close();
  }
});

test('taking over an expired claim marks its reserved attempt unknown in Usage', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const job = {
      outboxId: stepJobId(run.id, 1),
      type: 'run.start.v1' as const,
      ctx: tenant,
      payload: { runId: run.id, sequence: 1, expectedVersion: 1 },
    };
    const usage = new AttemptService();
    const coordinator = new StepCoordinator(
      ai.database as TenantDatabase,
      new AiRunRepository(),
      new AiStepRepository(),
      usage,
      new OutboxRepository(),
      new JobExecutor(ai.database),
    );
    const first = await coordinator.claim(job);
    expect(first.kind).toBe('claimed');
    if (first.kind !== 'claimed') return;
    const modelInput = {
      model: 'synthetic/model',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
      maxOutputTokens: 16,
      signal: new AbortController().signal,
    };
    const attempt = await ai.withTenant(0, (tx) =>
      usage.reserve(tx, first.claim, {
        attemptId: randomUUID(),
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: 2000,
          maxOutputTokens: 16,
        },
      }),
    );
    await ai.withTenant(0, (tx) =>
      ai.expireClaimLeaseInSession(tx, first.claim),
    );

    const takeover = await coordinator.claim(job);
    expect(takeover.kind).toBe('claimed');
    const outcomes = await ai.withTenantSession(0, async (_tx, client) => {
      const result = await client.query<{ outcome: string }>(
        'SELECT outcome FROM app.usage_events WHERE attempt_id=$1',
        [attempt.attemptId],
      );
      return result.rows.map((row) => row.outcome);
    });
    expect(outcomes).toEqual(['unknown']);
  } finally {
    await ai.close();
  }
});

test('exhausted expired steps mark their Usage attempt unknown before failing the run', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const job = {
      outboxId: stepJobId(run.id, 1),
      type: 'run.start.v1' as const,
      ctx: tenant,
      payload: { runId: run.id, sequence: 1, expectedVersion: 1 },
    };
    const usage = new AttemptService();
    const coordinator = new StepCoordinator(
      ai.database as TenantDatabase,
      new AiRunRepository(),
      new AiStepRepository(),
      usage,
      new OutboxRepository(),
      new JobExecutor(ai.database),
    );
    const claimed = await coordinator.claim(job);
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') return;
    const modelInput = {
      model: 'synthetic/model',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
      maxOutputTokens: 16,
      signal: new AbortController().signal,
    };
    const attempt = await ai.withTenant(0, (tx) =>
      usage.reserve(tx, claimed.claim, {
        attemptId: randomUUID(),
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: 2000,
          maxOutputTokens: 16,
        },
      }),
    );
    await ai.withTenant(0, (tx) =>
      ai.expireClaimLeaseInSession(tx, claimed.claim),
    );

    await expect(coordinator.finalizeExhausted(job)).resolves.toBe('done');
    const rows = await ai.withTenantSession(0, async (_tx, client) => {
      const result = await client.query<{ outcome: string }>(
        'SELECT outcome FROM app.usage_events WHERE attempt_id=$1',
        [attempt.attemptId],
      );
      return result.rows;
    });
    expect(rows).toEqual([{ outcome: 'unknown' }]);
  } finally {
    await ai.close();
  }
});

test('cancellation recovery marks the expired owner attempt unknown', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const job = {
      outboxId: stepJobId(run.id, 1),
      type: 'run.start.v1' as const,
      ctx: tenant,
      payload: { runId: run.id, sequence: 1, expectedVersion: 1 },
    };
    const usage = new AttemptService();
    const runs = new AiRunRepository();
    const coordinator = new StepCoordinator(
      ai.database as TenantDatabase,
      runs,
      new AiStepRepository(),
      usage,
      new OutboxRepository(),
      new JobExecutor(ai.database),
    );
    const claimed = await coordinator.claim(job);
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') return;
    const modelInput = {
      model: 'synthetic/model',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'Synthetic prompt.' }],
      maxOutputTokens: 16,
      signal: new AbortController().signal,
    };
    const attempt = await ai.withTenant(0, (tx) =>
      usage.reserve(tx, claimed.claim, {
        attemptId: randomUUID(),
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: 2000,
          maxOutputTokens: 16,
        },
      }),
    );
    await ai.withTenant(0, async (tx) => {
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: 1,
          from: 'queued',
          to: 'cancelling',
        }),
      ).toBe(true);
      await ai.expireClaimLeaseInSession(tx, claimed.claim);
    });

    const cancelled = await coordinator.claim(job);
    expect(cancelled.kind).toBe('cancelled');
    const rows = await ai.withTenantSession(0, async (_tx, client) => {
      const result = await client.query<{ outcome: string }>(
        'SELECT outcome FROM app.usage_events WHERE attempt_id=$1',
        [attempt.attemptId],
      );
      return result.rows;
    });
    expect(rows).toEqual([{ outcome: 'unknown' }]);
  } finally {
    await ai.close();
  }
});
