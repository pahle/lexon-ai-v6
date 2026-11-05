import { expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiRunRepository,
  AiStepRepository,
  TenantDatabase,
  type StepClaim,
} from '../../src/infrastructure/db/index.js';
import { RunStreams } from '../../src/infrastructure/queue/index.js';

function claimAuthority(database: TenantDatabase, steps: AiStepRepository) {
  const runs = new AiRunRepository();
  return {
    authorizeActive: (claim: StepClaim) =>
      database.withTenant({ orgId: claim.orgId, userId: claim.userId }, (tx) =>
        steps.streamActiveProof(tx, claim),
      ),
    authorizeTerminal: (claim: StepClaim) =>
      database.withTenant({ orgId: claim.orgId, userId: claim.userId }, (tx) =>
        steps.streamTerminalProof(tx, claim),
      ),
    reconcile: (
      entries: readonly { runId: string; orgId: string; userId: string }[],
    ) =>
      Promise.all(
        entries.map(async ({ runId, orgId, userId }) => {
          const result = await database.withTenant({ orgId, userId }, (tx) =>
            runs.streamRegistryState(tx, runId, userId),
          );
          return result.state === 'terminal'
            ? { runId, state: 'terminal' as const, claim: result.claim }
            : { runId, state: result.state };
        }),
      ),
  };
}

test('one run stream remains open across events and closes only after terminal DB commit', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: claimAuthority(ai.database as TenantDatabase, steps),
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Stream test claim unavailable');
    expect(
      await claimAuthority(
        ai.database as TenantDatabase,
        steps,
      ).authorizeActive(claim),
    ).toMatchObject({
      stepId: claim.stepId,
      fence: claim.fence,
    });
    expect(
      await streams.publish(claim, {
        version: 1,
        runId: run.id,
        type: 'start',
        messageId: '40000000-0000-4000-8000-000000000010',
      }),
    ).toBe('written');
    expect(
      await streams.publish(claim, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'part',
        delta: 'hello',
      }),
    ).toBe('written');
    await streams.finish(claim, { version: 1, runId: run.id, type: 'finish' });
    const streamKey = `${services.queuePrefix}:{run-streams}:${run.id}:events`;
    expect(await redis.xlen(streamKey)).toBe(2);

    await ai.withTenant(0, async (tx) => {
      expect(await steps.lockClaim(tx, claim)).toBe(true);
      expect(
        await steps.commit(tx, claim, {
          state: 'committed',
          text: 'hello',
          data: {},
        }),
      ).toBe(true);
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: claim.expectedVersion,
          from: 'queued',
          to: 'completed',
          nextSequence: claim.sequence + 1,
          outputAppend: 'hello',
          finalizeOutput: true,
        }),
      ).toBe(true);
    });

    await streams.finish(claim, { version: 1, runId: run.id, type: 'finish' });
    expect(await redis.xlen(streamKey)).toBe(3);
    expect(await redis.ttl(streamKey)).toBeGreaterThan(0);
    expect(await redis.ttl(streamKey)).toBeLessThanOrEqual(3600);
    expect(
      await streams.publish(claim, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'late',
        delta: 'late',
      }),
    ).toBe('stale');
    expect(await redis.xlen(streamKey)).toBe(3);
    const guardKey = `${services.queuePrefix}:{run-streams}:${run.id}:guard`;
    await redis.del(guardKey);
    expect(
      await streams.publish(claim, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'replay',
        delta: 'replay',
      }),
    ).toBe('stale');
    expect(await redis.exists(guardKey)).toBe(0);
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('active admission and terminal retention stay bounded without evicting active streams', async ({
  services,
}) => {
  const active = new Set<string>();
  const terminal = new Set<string>();
  const claims = new Map<string, StepClaim>();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: {
      authorizeActive: async (claim) => {
        if (!active.has(claim.runId)) return undefined;
        return {
          runVersion: claim.expectedVersion,
          nextSequence: claim.sequence,
          status: 'running' as const,
          stepId: claim.stepId,
          sequence: claim.sequence,
          expectedVersion: claim.expectedVersion,
          fence: claim.fence,
          leaseUntil: new Date(Date.now() + 30_000),
        };
      },
      authorizeTerminal: async (claim) =>
        terminal.has(claim.runId)
          ? {
              status: 'completed' as const,
              runVersion: claim.expectedVersion + 1,
              nextSequence: claim.sequence + 1,
              latestCommittedStepId: claim.stepId,
              latestCommittedSequence: claim.sequence,
              latestCommittedExpectedVersion: claim.expectedVersion,
              latestCommittedFence: claim.fence,
            }
          : undefined,
      reconcile: async (entries) =>
        entries.map(({ runId }) => {
          if (active.has(runId)) return { runId, state: 'active' as const };
          if (terminal.has(runId) && claims.has(runId))
            return {
              runId,
              state: 'terminal' as const,
              claim: claims.get(runId)!,
            };
          return { runId, state: 'missing' as const };
        }),
    },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const prefix = `${services.queuePrefix}:{run-streams}`;
  const makeClaim = (): StepClaim => ({
    runId: randomUUID(),
    orgId: randomUUID(),
    userId: randomUUID(),
    stepId: randomUUID(),
    sequence: 1,
    expectedVersion: 1,
    fence: 1,
    leaseUntil: new Date(Date.now() + 30_000),
  });
  try {
    for (let index = 0; index < 6; index++) {
      const claim = makeClaim();
      claims.set(claim.runId, claim);
      active.add(claim.runId);
      expect(
        await streams.publish(claim, {
          version: 1,
          runId: claim.runId,
          type: 'status',
          status: 'running',
        }),
      ).toBe('written');
      active.delete(claim.runId);
      terminal.add(claim.runId);
      await streams.finish(claim, {
        version: 1,
        runId: claim.runId,
        type: 'finish',
      });
    }
    for (let index = 0; index < 24; index++) {
      const claim = makeClaim();
      claims.set(claim.runId, claim);
      active.add(claim.runId);
      expect(
        await streams.publish(claim, {
          version: 1,
          runId: claim.runId,
          type: 'status',
          status: 'running',
        }),
      ).toBe('written');
    }
    const denied = makeClaim();
    active.add(denied.runId);
    expect(
      await streams.publish(denied, {
        version: 1,
        runId: denied.runId,
        type: 'status',
        status: 'running',
      }),
    ).toBe('unavailable');
    expect(await redis.zcard(`${prefix}:active`)).toBe(24);
    expect(await redis.zcard(`${prefix}:terminal`)).toBe(6);
    expect(
      (await redis.zcard(`${prefix}:active`)) +
        (await redis.zcard(`${prefix}:terminal`)),
    ).toBe(30);
    for (const claim of claims.values()) {
      if (!active.has(claim.runId)) continue;
      const key = `${prefix}:${claim.runId}:events`;
      expect(await redis.xlen(key)).toBe(1);
    }
    for (const claim of claims.values()) {
      active.delete(claim.runId);
      terminal.add(claim.runId);
      await streams.finish(claim, {
        version: 1,
        runId: claim.runId,
        type: 'finish',
      });
    }
    for (let index = 0; index < 100; index++) {
      const claim = makeClaim();
      active.add(claim.runId);
      expect(
        await streams.publish(claim, {
          version: 1,
          runId: claim.runId,
          type: 'status',
          status: 'running',
        }),
      ).toBe('written');
      active.delete(claim.runId);
      terminal.add(claim.runId);
      await streams.finish(claim, {
        version: 1,
        runId: claim.runId,
        type: 'finish',
      });
    }
    expect(await redis.zcard(`${prefix}:active`)).toBe(0);
    expect(await redis.zcard(`${prefix}:terminal`)).toBeLessThanOrEqual(6);
    expect(
      (await redis.zcard(`${prefix}:active`)) +
        (await redis.zcard(`${prefix}:terminal`)),
    ).toBeLessThanOrEqual(30);
    const retained = await redis.zrange(`${prefix}:terminal`, '0', '-1');
    for (const member of retained) {
      const runId = member.split('|', 1)[0]!;
      expect(
        await redis.exists(
          `${prefix}:${runId}:events`,
          `${prefix}:${runId}:guard`,
        ),
      ).toBe(2);
    }
  } finally {
    redis.disconnect();
    await streams.close();
  }
});

test('an authorization paused before Valkey cannot recreate an evicted terminal stream', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  const baseAuthority = claimAuthority(ai.database as TenantDatabase, steps);
  let release!: () => void;
  let proofReady!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    proofReady = resolve;
  });
  let shouldPause = true;
  const staleWriter = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: {
      ...baseAuthority,
      authorizeActive: async (claim) => {
        const proof = await baseAuthority.authorizeActive(claim);
        if (shouldPause && proof) {
          shouldPause = false;
          proofReady();
          await paused;
        }
        return proof;
      },
    },
  });
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: baseAuthority,
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const finishRun = async (runId: string, claim: StepClaim) => {
    await ai.withTenant(0, async (tx) => {
      expect(await steps.lockClaim(tx, claim)).toBe(true);
      expect(
        await steps.commit(tx, claim, {
          state: 'committed',
          text: '',
          data: {},
        }),
      ).toBe(true);
      expect(
        await runs.transition(tx, {
          runId,
          expectedVersion: claim.expectedVersion,
          from: 'queued',
          to: 'completed',
          nextSequence: claim.sequence + 1,
          finalizeOutput: true,
        }),
      ).toBe(true);
    });
    await streams.finish(claim, { version: 1, runId, type: 'finish' });
  };
  try {
    const original = await ai.start(0);
    await ai.seedPendingStep(0, original.id);
    const oldClaim = await ai.claim(0, original.id, 1, 1, 30_000);
    if (!oldClaim) throw new Error('Stream race claim unavailable');
    const pendingPublish = staleWriter.publish(oldClaim, {
      version: 1,
      runId: original.id,
      type: 'text-delta',
      id: 'late',
      delta: 'late',
    });
    await ready;
    await finishRun(original.id, oldClaim);
    for (let index = 0; index < 6; index++) {
      const run = await ai.start(0);
      await ai.seedPendingStep(0, run.id);
      const claim = await ai.claim(0, run.id, 1, 1, 30_000);
      if (!claim) throw new Error('Stream eviction claim unavailable');
      expect(
        await streams.publish(claim, {
          version: 1,
          runId: run.id,
          type: 'status',
          status: 'running',
        }),
      ).toBe('written');
      await finishRun(run.id, claim);
    }
    release();
    expect(await pendingPublish).toBe('stale');
    const prefix = `${services.queuePrefix}:{run-streams}`;
    expect(await redis.exists(`${prefix}:${original.id}:events`)).toBe(0);
    expect(await redis.exists(`${prefix}:${original.id}:guard`)).toBe(0);
    expect(await redis.zcard(`${prefix}:terminal`)).toBe(6);
  } finally {
    release();
    redis.disconnect();
    await staleWriter.close();
    await streams.close();
    await ai.close();
  }
});

test('reconciliation retains approval-paused streams without a live step lease', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: claimAuthority(ai.database as TenantDatabase, steps),
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const prefix = `${services.queuePrefix}:{run-streams}`;
  try {
    const pausedRun = await ai.start(0);
    await ai.seedPendingStep(0, pausedRun.id);
    const pausedClaim = await ai.claim(0, pausedRun.id, 1, 1, 30_000);
    if (!pausedClaim) throw new Error('Approval stream claim unavailable');
    expect(
      await streams.publish(pausedClaim, {
        version: 1,
        runId: pausedRun.id,
        type: 'status',
        status: 'running',
      }),
    ).toBe('written');
    await ai.withTenant(0, async (tx) => {
      expect(await steps.lockClaim(tx, pausedClaim)).toBe(true);
      expect(
        await runs.markRunningForClaim(tx, {
          runId: pausedRun.id,
          stepId: pausedClaim.stepId,
          expectedVersion: pausedClaim.expectedVersion,
          sequence: pausedClaim.sequence,
          fence: pausedClaim.fence,
        }),
      ).toBe(true);
      expect(
        await steps.commit(tx, pausedClaim, {
          state: 'awaiting_approval',
          text: '',
          data: {},
        }),
      ).toBe(true);
      expect(
        await runs.transition(tx, {
          runId: pausedRun.id,
          expectedVersion: pausedClaim.expectedVersion,
          from: 'running',
          to: 'awaiting_approval',
          nextSequence: pausedClaim.sequence + 1,
        }),
      ).toBe(true);
    });

    const nextRun = await ai.start(0);
    await ai.seedPendingStep(0, nextRun.id);
    const nextClaim = await ai.claim(0, nextRun.id, 1, 1, 30_000);
    if (!nextClaim) throw new Error('Admission stream claim unavailable');
    expect(
      await streams.publish(nextClaim, {
        version: 1,
        runId: nextRun.id,
        type: 'status',
        status: 'running',
      }),
    ).toBe('written');
    expect(await redis.exists(`${prefix}:${pausedRun.id}:events`)).toBe(1);
    expect(await redis.zcard(`${prefix}:active`)).toBe(2);
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('successful steps keep one stream and an old sequence cannot finish it', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: claimAuthority(ai.database as TenantDatabase, steps),
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const first = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!first) throw new Error('First stream sequence claim unavailable');
    expect(
      await streams.publish(first, {
        version: 1,
        runId: run.id,
        type: 'start',
        messageId: '40000000-0000-4000-8000-000000000011',
      }),
    ).toBe('written');
    expect(
      await streams.publish(first, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'part',
        delta: 'first',
      }),
    ).toBe('written');
    await ai.withTenant(0, async (tx) => {
      expect(await steps.lockClaim(tx, first)).toBe(true);
      expect(
        await runs.markRunningForClaim(tx, {
          runId: run.id,
          stepId: first.stepId,
          expectedVersion: 1,
          sequence: 1,
          fence: first.fence,
        }),
      ).toBe(true);
      expect(
        await steps.commit(tx, first, {
          state: 'committed',
          text: 'first',
          data: {},
        }),
      ).toBe(true);
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: 1,
          from: 'running',
          to: 'running',
          nextSequence: 2,
          outputAppend: 'first',
        }),
      ).toBe(true);
      await steps.insertInitial(tx, {
        id: randomUUID(),
        runId: run.id,
        sequence: 2,
        expectedVersion: 2,
      });
    });
    const second = await ai.claim(0, run.id, 2, 2, 30_000);
    if (!second) throw new Error('Second stream sequence claim unavailable');
    await streams.finish(first, { version: 1, runId: run.id, type: 'finish' });
    expect(
      await streams.publish(second, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'part',
        delta: ' second',
      }),
    ).toBe('written');
    const streamKey = `${services.queuePrefix}:{run-streams}:${run.id}:events`;
    expect(await redis.xlen(streamKey)).toBe(3);
    const entries = await redis.xrange(streamKey, '-', '+');
    expect(entries.map((entry) => JSON.parse(entry[1][1]!))).toMatchObject([
      { type: 'start' },
      { type: 'text-delta', delta: 'first' },
      { type: 'text-delta', delta: ' second' },
    ]);
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('a stale claim fence cannot publish after a newer claim', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: claimAuthority(ai.database as TenantDatabase, steps),
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const stale = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!stale) throw new Error('Stale stream claim unavailable');
    await ai.withTenant(0, (tx) => ai.expireClaimLeaseInSession(tx, stale));
    const current = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!current) throw new Error('Current stream claim unavailable');
    expect(current.fence).toBeGreaterThan(stale.fence);
    expect(
      await streams.publish(stale, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'old',
        delta: 'old',
      }),
    ).toBe('stale');
    expect(
      await streams.publish(current, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'new',
        delta: 'new',
      }),
    ).toBe('written');
    const entries = await redis.xrange(
      `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      '-',
      '+',
    );
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0]![1][1]!)).toMatchObject({
      id: 'new',
      delta: 'new',
    });
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});
