import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiAttemptRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import { JobExecutor } from '../../src/modules/platform/job-executor.js';
import { StepCoordinator } from '../../src/modules/chat/step-coordinator.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { AttemptService } from '../../src/modules/usage/index.js';

function coordinator(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  usage = new AttemptService(),
) {
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const outbox = new OutboxRepository();
  return new StepCoordinator(
    ai.database as TenantDatabase,
    runs,
    steps,
    usage,
    outbox,
    new JobExecutor(ai.database),
  );
}
function job(runId: string, tenant: { orgId: string; userId: string }) {
  return {
    outboxId: stepJobId(runId, 1),
    type: 'run.start.v1' as const,
    ctx: tenant,
    payload: { runId, sequence: 1, expectedVersion: 1 },
  };
}

test('two concurrent deliveries admit one active claim and preserve its version', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const results = await Promise.all([
      ai.claim(0, run.id, 1, 1, 30_000),
      ai.claim(0, run.id, 1, 1, 30_000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await ai.runVersion(0, run.id)).toBe(1);
  } finally {
    await ai.close();
  }
});

test('coordinator returns busy to a second delivery and performs no tenant discovery', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const service = coordinator(ai);
    const owner = ai.tenants[0]!;
    const [first, second] = await Promise.all([
      service.claim(job(run.id, owner)),
      service.claim(job(run.id, owner)),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['busy', 'claimed']);
    expect(await service.claim(job(run.id, ai.tenants[1]!))).toEqual({
      kind: 'noop',
    });
  } finally {
    await ai.close();
  }
});

test('coordinator defers, not drops, a pending step refused by the organization claim cap', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const runs = await Promise.all([ai.start(0), ai.start(0), ai.start(0)]);
    await Promise.all(runs.map((run) => ai.seedPendingStep(0, run.id)));
    expect(await ai.claim(0, runs[0]!.id, 1, 1, 30_000)).not.toBeNull();
    expect(await ai.claim(0, runs[1]!.id, 1, 1, 30_000)).not.toBeNull();
    const service = coordinator(ai);
    const before = Date.now();
    const deferred = await service.claim(job(runs[2]!.id, ai.tenants[0]!));
    expect(deferred.kind).toBe('busy');
    if (deferred.kind !== 'busy') throw new Error('expected busy');
    expect(deferred.retryAtMs).toBeGreaterThan(before);
    expect(deferred.retryAtMs).toBeLessThanOrEqual(Date.now() + 1000);
    expect(await ai.runVersion(0, runs[2]!.id)).toBe(1);
    expect(await ai.claim(0, runs[2]!.id, 1, 1, 30_000)).toBeNull();
  } finally {
    await ai.close();
  }
});

test('coordinator rejects a copied outer outbox job identity before claim', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const service = coordinator(ai);
    await expect(
      service.claim({
        ...job(run.id, ai.tenants[0]!),
        outboxId: '40000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow('Invalid run job identity');
    expect(await ai.runVersion(0, run.id)).toBe(1);
  } finally {
    await ai.close();
  }
});

test('terminal run delivery is a no-op and writes no receipt or successor', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const tenant = ai.tenants[0]!;
    await ai.transition(0, run.id, 1, 'queued', 'failed');
    const terminalJob = {
      ...job(run.id, tenant),
      payload: { runId: run.id, sequence: 1, expectedVersion: 2 },
    };
    expect(await coordinator(ai).claim(terminalJob)).toEqual({ kind: 'noop' });
    expect(await ai.receiptCount(terminalJob.outboxId)).toBe(0);
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
  } finally {
    await ai.close();
  }
});

test('stale commit rolls back receipt; terminal commit creates no continuation', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const service = coordinator(ai);
    const tenant = ai.tenants[0]!;
    const queuedJob = job(run.id, tenant);
    const old = await service.claim(queuedJob);
    expect(old.kind).toBe('claimed');
    if (old.kind !== 'claimed') return;
    // A replacement fence is established by the raw fixture's expired takeover helper.
    const oldOwner = await ai.seedClaimableStep(1, (await ai.start(1)).id, {
      activeAttempt: true,
    });
    const replacement = await ai.claim(1, oldOwner.runId, 1, 1, 30_000);
    expect(replacement?.fence).toBeGreaterThan(oldOwner.fence);
    const staleJob = job(oldOwner.runId, ai.tenants[1]!);
    const stale = await service.commit(staleJob, oldOwner, {
      state: 'committed',
      text: 'late',
      data: {},
      advancement: 'generation',
    });
    expect(stale).toBe('stale');
    expect(await ai.receiptCount(staleJob.outboxId)).toBe(0);
    expect(
      await ai.withTenant(1, (tx) =>
        new AiRunRepository().find(tx, oldOwner.runId),
      ),
    ).toMatchObject({ modelIterations: 0, runVersion: 1, nextSequence: 1 });
    const terminal = await service.commit(queuedJob, old.claim, {
      state: 'committed',
      text: 'done',
      data: {},
      terminal: true,
      advancement: 'generation',
    });
    expect(terminal).toBe('committed');
    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(1);
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
    expect(
      await ai.withTenant(0, (tx) => new AiRunRepository().find(tx, run.id)),
    ).toMatchObject({
      status: 'completed',
      partialOutput: 'done',
      finalOutput: 'done',
      modelIterations: 1,
    });
  } finally {
    await ai.close();
  }
});

test('stale settlement returns stale without changing the replacement owner or usage', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const staleClaim = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: true,
    });
    const tenant = ai.tenants[0]!;
    const queuedJob = job(run.id, tenant);
    const service = coordinator(ai);
    const attemptsRepository = new AiAttemptRepository();
    const beforeTakeover = await ai.withTenant(0, (tx) =>
      attemptsRepository.list(tx, run.id),
    );
    const expiredAttempt = beforeTakeover.find(
      (attempt) => attempt.stepId === staleClaim.stepId && attempt.active,
    );
    expect(expiredAttempt).toBeDefined();
    if (!expiredAttempt) return;
    const replacement = await service.claim(queuedJob);
    expect(replacement.kind).toBe('claimed');
    if (replacement.kind !== 'claimed') return;
    expect(replacement.claim.fence).toBeGreaterThan(staleClaim.fence);
    const attemptsBefore = await ai.withTenant(0, (tx) =>
      attemptsRepository.list(tx, run.id),
    );
    expect(attemptsBefore).toContainEqual(
      expect.objectContaining({
        attemptId: expiredAttempt.attemptId,
        active: false,
        outcome: 'unknown',
      }),
    );

    await expect(
      service.commit(queuedJob, staleClaim, {
        state: 'committed',
        text: 'late output',
        data: {},
        advancement: 'generation',
        attemptSettlement: {
          attemptId: expiredAttempt.attemptId,
          outcome: 'succeeded',
          usage: { inputTokens: 3, outputTokens: 2 },
        },
      }),
    ).resolves.toBe('stale');

    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(0);
    expect(
      await ai.withTenant(0, (tx) => new AiRunRepository().find(tx, run.id)),
    ).toMatchObject({
      status: 'queued',
      runVersion: 1,
      nextSequence: 1,
      modelIterations: 0,
      partialOutput: '',
      finalOutput: null,
    });
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
    expect(
      await ai.withTenant(0, (tx) => attemptsRepository.list(tx, run.id)),
    ).toEqual(attemptsBefore);
    expect(await service.renew(replacement.claim)).toBe(true);
  } finally {
    await ai.close();
  }
});

test('invalid Usage settlement is not translated into stale ownership', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const queuedJob = job(run.id, tenant);
    const service = coordinator(ai);
    const claimed = await service.claim(queuedJob);
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') return;

    await expect(
      service.commit(queuedJob, claimed.claim, {
        state: 'committed',
        text: 'not committed',
        data: {},
        advancement: 'generation',
        attemptSettlement: {
          attemptId: '70000000-0000-4000-8000-000000000001',
          outcome: 'succeeded',
          usage: { inputTokens: 3, outputTokens: 2 },
        },
      }),
    ).rejects.toMatchObject({
      code: 'AI_INTERNAL',
      message: 'AI settlement unavailable',
    });
    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(0);
  } finally {
    await ai.close();
  }
});

test('lease expiry between claim checks rolls settlement back as stale', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const queuedJob = job(run.id, tenant);
    const usage = new (class extends AttemptService {
      override async settle(
        tx: Parameters<AttemptService['settle']>[0],
        claim: Parameters<AttemptService['settle']>[1],
        input: Parameters<AttemptService['settle']>[2],
      ) {
        await ai.expireClaimLeaseInSession(tx, claim);
        return super.settle(tx, claim, input);
      }
    })();
    const service = coordinator(ai, usage);
    const claimed = await service.claim(queuedJob);
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') return;
    const modelInput = {
      model: 'synthetic/test',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'small reserved input' }],
      maxOutputTokens: 16,
      signal: new AbortController().signal,
    };
    const attempt = await ai.withTenant(0, (tx) =>
      usage.reserve(tx, claimed.claim, {
        attemptId: '70000000-0000-4000-8000-000000000002',
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: 2000,
          maxOutputTokens: 16,
        },
      }),
    );

    await expect(
      service.commit(queuedJob, claimed.claim, {
        state: 'committed',
        text: 'late output',
        data: {},
        advancement: 'generation',
        attemptSettlement: {
          attemptId: attempt.attemptId,
          outcome: 'succeeded',
          usage: { inputTokens: 3, outputTokens: 2 },
        },
      }),
    ).resolves.toBe('stale');

    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(0);
    expect(
      await ai.withTenant(0, (tx) => new AiRunRepository().find(tx, run.id)),
    ).toMatchObject({
      status: 'queued',
      runVersion: 1,
      nextSequence: 1,
      modelIterations: 0,
      partialOutput: '',
      finalOutput: null,
    });
    const attempts = await ai.withTenant(0, (tx) =>
      new AiAttemptRepository().list(tx, run.id),
    );
    expect(attempts).toMatchObject([
      {
        attemptId: attempt.attemptId,
        active: true,
        outcome: null,
        reportedInputTokens: null,
        reportedOutputTokens: null,
      },
    ]);
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
    expect(await service.renew(claimed.claim)).toBe(true);
  } finally {
    await ai.close();
  }
});

test('lease expiry after Usage validation rolls repository settlement back as stale', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const queuedJob = job(run.id, tenant);
    const usage = new AttemptService();
    const service = coordinator(ai, usage);
    const claimed = await service.claim(queuedJob);
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') return;
    const modelInput = {
      model: 'synthetic/test',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'small reserved input' }],
      maxOutputTokens: 16,
      signal: new AbortController().signal,
    };
    const attempt = await ai.withTenant(0, (tx) =>
      usage.reserve(tx, claimed.claim, {
        attemptId: '70000000-0000-4000-8000-000000000003',
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: 2000,
          maxOutputTokens: 16,
        },
      }),
    );
    const originalSettle = AiAttemptRepository.prototype.settle;
    const settlementProxy = vi
      .spyOn(AiAttemptRepository.prototype, 'settle')
      .mockImplementation(async function (
        this: AiAttemptRepository,
        tx,
        claim,
        input,
      ) {
        await ai.expireClaimLeaseInSession(tx, claim);
        return originalSettle.call(this, tx, claim, input);
      });

    try {
      await expect(
        service.commit(queuedJob, claimed.claim, {
          state: 'committed',
          text: 'late output',
          data: {},
          advancement: 'generation',
          attemptSettlement: {
            attemptId: attempt.attemptId,
            outcome: 'succeeded',
            usage: { inputTokens: 3, outputTokens: 2 },
          },
        }),
      ).resolves.toBe('stale');
    } finally {
      settlementProxy.mockRestore();
    }

    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(0);
    expect(
      await ai.withTenant(0, (tx) => new AiRunRepository().find(tx, run.id)),
    ).toMatchObject({
      status: 'queued',
      runVersion: 1,
      nextSequence: 1,
      modelIterations: 0,
      partialOutput: '',
      finalOutput: null,
    });
    expect(
      await ai.withTenant(0, (tx) =>
        new AiAttemptRepository().list(tx, run.id),
      ),
    ).toMatchObject([
      {
        attemptId: attempt.attemptId,
        active: true,
        outcome: null,
        reportedInputTokens: null,
        reportedOutputTokens: null,
      },
    ]);
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
    expect(await service.renew(claimed.claim)).toBe(true);
  } finally {
    await ai.close();
  }
});

test('a live claim preserves the generic repository settlement rejection', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const tenant = ai.tenants[0]!;
    const queuedJob = job(run.id, tenant);
    const usage = new AttemptService();
    const service = coordinator(ai, usage);
    const claimed = await service.claim(queuedJob);
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') return;
    const modelInput = {
      model: 'synthetic/test',
      provider: 'synthetic',
      messages: [{ role: 'user' as const, content: 'small reserved input' }],
      maxOutputTokens: 16,
      signal: new AbortController().signal,
    };
    const attempt = await ai.withTenant(0, (tx) =>
      usage.reserve(tx, claimed.claim, {
        attemptId: '70000000-0000-4000-8000-000000000004',
        modelInput,
        limits: {
          maxAttemptsPerStep: 2,
          tokenBudget: 2000,
          maxOutputTokens: 16,
        },
      }),
    );
    const settlementProxy = vi
      .spyOn(AiAttemptRepository.prototype, 'settle')
      .mockResolvedValue(false);

    try {
      await expect(
        service.commit(queuedJob, claimed.claim, {
          state: 'committed',
          text: 'not committed',
          data: {},
          advancement: 'generation',
          attemptSettlement: {
            attemptId: attempt.attemptId,
            outcome: 'succeeded',
            usage: { inputTokens: 3, outputTokens: 2 },
          },
        }),
      ).rejects.toMatchObject({
        code: 'AI_INTERNAL',
        message: 'AI settlement rejected',
      });
    } finally {
      settlementProxy.mockRestore();
    }

    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(0);
    expect(
      await ai.withTenant(0, (tx) =>
        new AiAttemptRepository().list(tx, run.id),
      ),
    ).toMatchObject([
      {
        attemptId: attempt.attemptId,
        active: true,
        outcome: null,
        reportedInputTokens: null,
        reportedOutputTokens: null,
      },
    ]);
    expect(await service.renew(claimed.claim)).toBe(true);
  } finally {
    await ai.close();
  }
});

test('committed nonterminal step writes one deterministic next outbox row', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const service = coordinator(ai);
    const tenant = ai.tenants[0]!;
    const queuedJob = job(run.id, tenant);
    const result = await service.claim(queuedJob);
    expect(result.kind).toBe('claimed');
    if (result.kind !== 'claimed') return;
    expect(
      await ai.withTenant(0, (tx) => new AiRunRepository().find(tx, run.id)),
    ).toMatchObject({ status: 'queued', runVersion: 1, nextSequence: 1 });
    expect(
      await service.commit(queuedJob, result.claim, {
        state: 'committed',
        text: 'step',
        data: {},
        advancement: 'generation',
      }),
    ).toBe('committed');
    expect(
      await service.commit(queuedJob, result.claim, {
        state: 'committed',
        text: 'duplicate',
        data: {},
        advancement: 'generation',
      }),
    ).toBe('committed');
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(1);
    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(1);
  } finally {
    await ai.close();
  }
});

test('the first committed generation can pause for approval without a successor', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const service = coordinator(ai);
    const tenant = ai.tenants[0]!;
    const queuedJob = job(run.id, tenant);
    const result = await service.claim(queuedJob);
    expect(result.kind).toBe('claimed');
    if (result.kind !== 'claimed') return;
    expect(
      await ai.withTenant(0, (tx) => new AiRunRepository().find(tx, run.id)),
    ).toMatchObject({ status: 'queued', runVersion: 1, nextSequence: 1 });
    expect(
      await service.commit(queuedJob, result.claim, {
        state: 'awaiting_approval',
        text: 'proposal',
        data: {},
        advancement: 'generation',
      }),
    ).toBe('committed');
    const stored = await ai.withTenant(0, (tx) =>
      new AiRunRepository().find(tx, run.id),
    );
    expect(stored).toMatchObject({
      status: 'awaiting_approval',
      runVersion: 2,
      nextSequence: 2,
    });
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
    expect(await service.claim(queuedJob)).toEqual({ kind: 'noop' });
  } finally {
    await ai.close();
  }
});

test('model iteration increments once for a generation and not for duplicate or continuation commits', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const service = coordinator(ai);
    const tenant = ai.tenants[0]!;
    const firstJob = job(run.id, tenant);
    const firstClaim = await service.claim(firstJob);
    expect(firstClaim.kind).toBe('claimed');
    if (firstClaim.kind !== 'claimed') return;
    const generation = {
      state: 'committed' as const,
      text: 'generated',
      data: {},
      advancement: 'generation' as const,
    };
    expect(await service.commit(firstJob, firstClaim.claim, generation)).toBe(
      'committed',
    );
    expect(await service.commit(firstJob, firstClaim.claim, generation)).toBe(
      'committed',
    );
    let stored = await ai.withTenant(0, (tx) =>
      new AiRunRepository().find(tx, run.id),
    );
    expect(stored?.modelIterations).toBe(1);
    expect(stored?.nextSequence).toBe(2);

    const secondJob = {
      outboxId: stepJobId(run.id, 2),
      type: 'run.advance.v1' as const,
      ctx: tenant,
      payload: { runId: run.id, sequence: 2, expectedVersion: 2 },
    };
    const secondClaim = await service.claim(secondJob);
    expect(secondClaim.kind).toBe('claimed');
    if (secondClaim.kind !== 'claimed') return;
    expect(
      await service.commit(secondJob, secondClaim.claim, {
        state: 'committed',
        text: 'approval continuation',
        data: {},
        advancement: 'continuation',
      }),
    ).toBe('committed');
    stored = await ai.withTenant(0, (tx) =>
      new AiRunRepository().find(tx, run.id),
    );
    expect(stored).toMatchObject({
      modelIterations: 1,
      nextSequence: 3,
      runVersion: 3,
    });
  } finally {
    await ai.close();
  }
});

test('reported usage over reservation fails the run without losing usage or committing another request', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const usage = new AttemptService();
  try {
    for (const [index, terminal] of [true, false].entries()) {
      const run = await ai.start(index);
      await ai.seedPendingStep(index, run.id);
      const tenant = ai.tenants[index]!;
      const queuedJob = job(run.id, tenant);
      const service = coordinator(ai);
      const claimResult = await service.claim(queuedJob);
      expect(claimResult.kind).toBe('claimed');
      if (claimResult.kind !== 'claimed') continue;
      const modelInput = {
        model: 'synthetic/test',
        provider: 'synthetic',
        messages: [{ role: 'user' as const, content: 'small reserved input' }],
        maxOutputTokens: 16,
        signal: new AbortController().signal,
      };
      const attempt = await ai.withTenant(index, (tx) =>
        usage.reserve(tx, claimResult.claim, {
          attemptId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          modelInput,
          limits: {
            maxAttemptsPerStep: 2,
            tokenBudget: 2000,
            maxOutputTokens: 16,
          },
        }),
      );
      const commit = {
        state: 'committed' as const,
        text: `partial-${index}`,
        data: {},
        terminal,
        advancement: 'generation' as const,
        outcome: 'succeeded' as const,
        attemptSettlement: {
          attemptId: attempt.attemptId,
          outcome: 'succeeded' as const,
          usage: { inputTokens: 3000, outputTokens: 16 },
        },
      };
      expect(
        await service.commit(queuedJob, claimResult.claim, commit as never),
      ).toBe('committed');
      expect(
        await service.commit(queuedJob, claimResult.claim, commit as never),
      ).toBe('committed');
      const stored = await ai.withTenant(index, (tx) =>
        new AiRunRepository().find(tx, run.id),
      );
      expect(stored).toMatchObject({
        status: 'failed',
        errorCode: 'AI_BUDGET_EXCEEDED',
        partialOutput: `partial-${index}`,
        finalOutput: null,
        modelIterations: 1,
        nextSequence: 2,
      });
      const attempts = await ai.withTenant(index, (tx) =>
        new AiAttemptRepository().list(tx, run.id),
      );
      expect(attempts).toMatchObject([
        {
          attemptId: attempt.attemptId,
          active: false,
          outcome: 'succeeded',
          reportedInputTokens: 3000,
          reportedOutputTokens: 16,
        },
      ]);
      expect(await ai.outboxCount(index, 'run.advance.v1')).toBe(0);
      expect(await ai.orgSlotCount(index)).toBe(0);
    }
  } finally {
    await ai.close();
  }
});

test('an expired previous owner cannot checkpoint, settle, or commit after takeover', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const oldOwner = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: true,
    });
    const replacement = await ai.claim(0, run.id, 1, 1, 30_000);
    expect(replacement?.fence).toBeGreaterThan(oldOwner.fence);
    expect(await ai.oldClaimCanWrite(oldOwner)).toEqual({
      renew: false,
      metadata: false,
      checkpoint: false,
      settle: false,
      commit: false,
    });
  } finally {
    await ai.close();
  }
});
