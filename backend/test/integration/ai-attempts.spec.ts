import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { ModelInput } from '../../src/infrastructure/ai/index.js';
import { AiAttemptRepository } from '../../src/infrastructure/db/index.js';
import { estimateInputTokens } from '../../src/modules/usage/token-estimator.js';
import { test } from '../setup/file-services.js';
import { createAttemptHarness } from '../setup/ai-attempt-fixture.js';

function modelInput(): ModelInput {
  return {
    model: 'synthetic/model',
    provider: 'synthetic',
    messages: [{ role: 'user', content: 'Review this clause.' }],
    maxOutputTokens: 256,
    signal: new AbortController().signal,
  };
}

function limits(
  harness: Awaited<ReturnType<typeof createAttemptHarness>>,
  input: ModelInput,
  tokenBudget = harness.tokenBudget,
) {
  return {
    maxAttemptsPerStep: 2,
    tokenBudget,
    maxOutputTokens: input.maxOutputTokens,
  };
}

async function reserve(
  harness: Awaited<ReturnType<typeof createAttemptHarness>>,
  service = harness.newService(),
  input = modelInput(),
) {
  return harness.withTenant((tx) =>
    service.reserve(tx, harness.claim, {
      attemptId: randomUUID(),
      modelInput: input,
      limits: limits(harness, input),
    }),
  );
}

async function settle(
  harness: Awaited<ReturnType<typeof createAttemptHarness>>,
  attemptId: string,
  outcome: 'succeeded' | 'failed' | 'unknown',
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    reasoningOutputTokens?: number;
  },
  costUsd?: string,
) {
  return harness.withTenant((tx) =>
    harness.newService().settle(tx, harness.claim, {
      attemptId,
      outcome,
      ...(usage ? { usage } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
    }),
  );
}

test('unknown keeps whole reserve after restart', async ({ services }) => {
  const harness = await createAttemptHarness(services);
  try {
    const service = harness.newService();
    const before = await reserve(harness, service);
    await settle(harness, before.attemptId, 'unknown');

    const reloadedRemainingTokens = await harness.withTenant((tx) =>
      harness.newService().remaining(tx, harness.runId),
    );
    expect(reloadedRemainingTokens).toBe(
      harness.tokenBudget -
        before.reservedInputTokens -
        before.reservedOutputTokens,
    );
  } finally {
    await harness.close();
  }
});

test('failed with no usage keeps reserve', async ({ services }) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    await settle(harness, reserved.attemptId, 'failed');
    expect(
      await harness.withTenant((tx) =>
        harness.newService().remaining(tx, harness.runId),
      ),
    ).toBe(
      harness.tokenBudget -
        reserved.reservedInputTokens -
        reserved.reservedOutputTokens,
    );
  } finally {
    await harness.close();
  }
});

test('reported usage replaces reserve', async ({ services }) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    await settle(harness, reserved.attemptId, 'succeeded', {
      inputTokens: 17,
      outputTokens: 9,
    });
    expect(
      await harness.withTenant((tx) =>
        harness.newService().remaining(tx, harness.runId),
      ),
    ).toBe(harness.tokenBudget - 26);
  } finally {
    await harness.close();
  }
});

test('partial usage keeps missing component reserve', async ({ services }) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    await settle(harness, reserved.attemptId, 'failed', { inputTokens: 17 });
    expect(
      await harness.withTenant((tx) =>
        harness.newService().remaining(tx, harness.runId),
      ),
    ).toBe(harness.tokenBudget - 17 - reserved.reservedOutputTokens);
  } finally {
    await harness.close();
  }
});

test('unknown retains reserve even if metadata carries usage', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    await settle(harness, reserved.attemptId, 'unknown', {
      inputTokens: 17,
      outputTokens: 9,
    });
    expect(
      await harness.withTenant((tx) =>
        harness.newService().remaining(tx, harness.runId),
      ),
    ).toBe(
      harness.tokenBudget -
        reserved.reservedInputTokens -
        reserved.reservedOutputTokens,
    );
  } finally {
    await harness.close();
  }
});

test('unknown overrun blocks new reserves while retaining the full reserve after restart', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    const settlement = await settle(harness, reserved.attemptId, 'unknown', {
      inputTokens:
        reserved.reservedInputTokens + reserved.reservedOutputTokens + 1,
      outputTokens: 0,
    });
    expect(settlement.budgetExceeded).toBe(true);

    const restartedService = harness.newService();
    const remaining = await harness.withTenant((tx) =>
      restartedService.remaining(tx, harness.runId),
    );
    expect(remaining).toBe(
      harness.tokenBudget -
        reserved.reservedInputTokens -
        reserved.reservedOutputTokens,
    );
    expect(remaining).toBeGreaterThan(0);
    await expect(reserve(harness, restartedService)).rejects.toMatchObject({
      code: 'AI_BUDGET_EXCEEDED',
    });
  } finally {
    await harness.close();
  }
});

test('over-reserve fails and blocks next reservation', async ({ services }) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    const settlement = await settle(harness, reserved.attemptId, 'succeeded', {
      inputTokens:
        reserved.reservedInputTokens + reserved.reservedOutputTokens + 1,
      outputTokens: 0,
    });
    expect(settlement.budgetExceeded).toBe(true);
    expect(
      await harness.withTenant((tx) =>
        harness.newService().remaining(tx, harness.runId),
      ),
    ).toBeGreaterThan(0);
    await expect(reserve(harness, harness.newService())).rejects.toMatchObject({
      code: 'AI_BUDGET_EXCEEDED',
    });
  } finally {
    await harness.close();
  }
});

test('two concurrent reservations cannot overspend', async ({ services }) => {
  const input = modelInput();
  const reserveTokens =
    estimateInputTokens(input).inputTokens + input.maxOutputTokens;
  const harness = await createAttemptHarness(services, {
    inputBudgetTokens: reserveTokens - 1,
    outputBudgetTokens: reserveTokens,
  });
  try {
    const results = await Promise.allSettled([
      reserve(harness),
      reserve(harness),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'AI_BUDGET_EXCEEDED' },
    });
  } finally {
    await harness.close();
  }
});

test('attempt 3 rejected at default 2', async ({ services }) => {
  const harness = await createAttemptHarness(services);
  try {
    const first = await reserve(harness);
    await settle(harness, first.attemptId, 'failed');
    const second = await reserve(harness);
    await settle(harness, second.attemptId, 'unknown');
    await expect(reserve(harness)).rejects.toMatchObject({
      code: 'AI_ATTEMPT_LIMIT',
    });
  } finally {
    await harness.close();
  }
});

test('reservation requires the stored run budget and enforced output limit', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const service = harness.newService();
    const input = modelInput();
    await expect(
      harness.withTenant((tx) =>
        service.reserve(tx, harness.claim, {
          attemptId: randomUUID(),
          modelInput: input,
          limits: limits(harness, input, harness.tokenBudget + 1),
        }),
      ),
    ).rejects.toMatchObject({ code: 'AI_INTERNAL' });
    await expect(
      harness.withTenant((tx) =>
        service.reserve(tx, harness.claim, {
          attemptId: randomUUID(),
          modelInput: { ...input, maxOutputTokens: input.maxOutputTokens + 1 },
          limits: limits(harness, input),
        }),
      ),
    ).rejects.toMatchObject({ code: 'AI_INTERNAL' });
    expect(await harness.listAttempts()).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('duplicate settlement cannot release a reservation twice', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    await settle(harness, reserved.attemptId, 'succeeded', {
      inputTokens: 17,
      outputTokens: 9,
    });
    const remaining = await harness.withTenant((tx) =>
      harness.newService().remaining(tx, harness.runId),
    );
    await expect(
      settle(harness, reserved.attemptId, 'succeeded', {
        inputTokens: 2,
        outputTokens: 2,
      }),
    ).rejects.toThrow();
    expect(
      await harness.withTenant((tx) =>
        harness.newService().remaining(tx, harness.runId),
      ),
    ).toBe(remaining);
  } finally {
    await harness.close();
  }
});

test('metadata is persisted only while its unique attempt is active', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    await harness.withTenant((tx) =>
      harness.newService().metadata(tx, harness.claim, {
        attemptId: reserved.attemptId,
        generationId: 'generation-1',
        provider: 'synthetic',
      }),
    );
    await settle(harness, reserved.attemptId, 'failed');
    await expect(
      harness.withTenant((tx) =>
        harness.newService().metadata(tx, harness.claim, {
          attemptId: reserved.attemptId,
          generationId: 'generation-2',
        }),
      ),
    ).rejects.toThrow();
    expect(await harness.listAttempts()).toContainEqual(
      expect.objectContaining({
        attemptId: reserved.attemptId,
        generationId: 'generation-1',
        provider: 'synthetic',
      }),
    );
  } finally {
    await harness.close();
  }
});

test('reservation and settlement roll back with their tenant transaction', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const service = harness.newService();
    await expect(
      harness.withTenant(async (tx) => {
        const attempt = await service.reserve(tx, harness.claim, {
          attemptId: randomUUID(),
          modelInput: modelInput(),
          limits: limits(harness, modelInput()),
        });
        await service.settle(tx, harness.claim, {
          attemptId: attempt.attemptId,
          outcome: 'succeeded',
          usage: { inputTokens: 17, outputTokens: 9 },
        });
        throw new Error('rollback fixture');
      }),
    ).rejects.toThrow('rollback fixture');
    expect(
      await harness.withTenant((tx) =>
        harness.newService().remaining(tx, harness.runId),
      ),
    ).toBe(harness.tokenBudget);
    const repository = new AiAttemptRepository();
    expect(
      await harness.withTenant((tx) => repository.list(tx, harness.runId)),
    ).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('expired tenant sessions cannot be reused', async ({ services }) => {
  const harness = await createAttemptHarness(services);
  try {
    let expired:
      | Parameters<ReturnType<typeof harness.newService>['remaining']>[0]
      | undefined;
    await harness.withTenant((tx) => {
      expired = tx;
      return Promise.resolve();
    });
    await expect(
      harness.newService().remaining(expired!, harness.runId),
    ).rejects.toThrow('Tenant session expired');
  } finally {
    await harness.close();
  }
});

test('missing cost stays null while known zero cost stays zero', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const missing = await reserve(harness);
    const zero = await reserve(harness);
    await settle(harness, missing.attemptId, 'succeeded', {
      inputTokens: 1,
      outputTokens: 1,
    });
    await settle(
      harness,
      zero.attemptId,
      'succeeded',
      { inputTokens: 1, outputTokens: 1 },
      '0',
    );
    const attempts = await harness.withTenant((tx) =>
      new AiAttemptRepository().list(tx, harness.runId),
    );
    expect(attempts.map((attempt) => attempt.costUsd)).toEqual([
      null,
      '0.0000000000',
    ]);
  } finally {
    await harness.close();
  }
});

test('cost precision beyond numeric scale is rejected before settlement', async ({
  services,
}) => {
  const harness = await createAttemptHarness(services);
  try {
    const reserved = await reserve(harness);
    await expect(
      settle(
        harness,
        reserved.attemptId,
        'succeeded',
        { inputTokens: 1, outputTokens: 1 },
        '0.00000000001',
      ),
    ).rejects.toThrow('AI settlement rejected');
    expect(await harness.listAttempts()).toContainEqual(
      expect.objectContaining({
        attemptId: reserved.attemptId,
        active: true,
        outcome: null,
        costUsd: null,
        reportedInputTokens: null,
      }),
    );
  } finally {
    await harness.close();
  }
});
