import { expect } from 'vitest';
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

function coordinator(ai: Awaited<ReturnType<typeof createAiFixture>>) {
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const outbox = new OutboxRepository();
  return new StepCoordinator(
    ai.database as TenantDatabase,
    runs,
    steps,
    new AiAttemptRepository(),
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
    });
    expect(stale).toBe('stale');
    expect(await ai.receiptCount(staleJob.outboxId)).toBe(0);
    const terminal = await service.commit(queuedJob, old.claim, {
      state: 'committed',
      text: 'done',
      data: {},
      terminal: true,
    });
    expect(terminal).toBe('committed');
    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(1);
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(0);
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
      await service.commit(queuedJob, result.claim, {
        state: 'committed',
        text: 'step',
        data: {},
      }),
    ).toBe('committed');
    expect(
      await service.commit(queuedJob, result.claim, {
        state: 'committed',
        text: 'duplicate',
        data: {},
      }),
    ).toBe('committed');
    expect(await ai.outboxCount(0, 'run.advance.v1')).toBe(1);
    expect(await ai.receiptCount(queuedJob.outboxId)).toBe(1);
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
