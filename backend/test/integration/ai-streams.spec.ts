import { expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  consumeUiMessageChunks,
  type UIMessageChunk,
} from '../../src/infrastructure/ai/testing/ui-message-consumer.js';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiRunRepository,
  AiStepRepository,
  TenantDatabase,
  type TerminalStreamReference,
  type StepClaim,
} from '../../src/infrastructure/db/index.js';
import {
  RunStreams,
  type RunStreamAuthority,
} from '../../src/infrastructure/queue/index.js';
import {
  APPEND_RUN_STREAM,
  FINISH_RUN_STREAM,
  PREPARE_RUN_STREAM,
} from '../../src/infrastructure/queue/run-stream-scripts.js';

function claimAuthority(
  database: TenantDatabase,
  steps: AiStepRepository,
): RunStreamAuthority {
  const runs = new AiRunRepository();
  return {
    authorizeActive: (claim: StepClaim) =>
      database.withTenant({ orgId: claim.orgId, userId: claim.userId }, (tx) =>
        steps.streamActiveProof(tx, claim),
      ),
    authorizeTerminal: (claim: TerminalStreamReference) =>
      database.withTenant({ orgId: claim.orgId, userId: claim.userId }, (tx) =>
        steps.streamTerminalProof(tx, claim),
      ),
    authorizeCommitted: (claim, event) =>
      database.withTenant({ orgId: claim.orgId, userId: claim.userId }, (tx) =>
        steps.streamCommittedProof(tx, claim, event),
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
    expect(await redis.xlen(streamKey)).toBe(4);
    expect(
      (await redis.xrange(streamKey, '-', '+'))
        .map(([, fields]) => JSON.parse(fields[1]! as string))
        .slice(-2),
    ).toEqual([
      { version: 1, runId: run.id, type: 'status', status: 'completed' },
      { version: 1, runId: run.id, type: 'finish' },
    ]);
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
    expect(await redis.xlen(streamKey)).toBe(4);
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

test('terminal finish uses fresh committed run version after a pause notification', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const runs = new AiRunRepository();
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
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Terminal version claim unavailable');
    await streams.recover(claim, {
      version: 1,
      runId: run.id,
      type: 'reset',
      sequence: claim.sequence,
    });
    await ai.withTenant(0, async (tx) => {
      expect(await steps.lockClaim(tx, claim)).toBe(true);
      expect(
        await runs.markRunningForClaim(tx, {
          runId: claim.runId,
          stepId: claim.stepId,
          expectedVersion: claim.expectedVersion,
          sequence: claim.sequence,
          fence: claim.fence,
        }),
      ).toBe(true);
      expect(
        await steps.commit(tx, claim, {
          state: 'awaiting_approval',
          text: 'paused output',
          data: {},
        }),
      ).toBe(true);
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: claim.expectedVersion,
          from: 'running',
          to: 'awaiting_approval',
          nextSequence: claim.sequence + 1,
          outputAppend: 'paused output',
        }),
      ).toBe(true);
    });
    const committed = {
      runId: claim.runId,
      orgId: claim.orgId,
      userId: claim.userId,
      stepId: claim.stepId,
      sequence: claim.sequence,
      expectedVersion: claim.expectedVersion,
      fence: claim.fence,
      committedRunVersion: 2,
      committedStatus: 'awaiting_approval' as const,
    };
    await expect(
      streams.publishCommitted(committed, [
        {
          version: 1,
          runId: run.id,
          type: 'status',
          status: 'awaiting_approval',
        },
      ]),
    ).resolves.toBe('written');
    await ai.withTenant(0, async (tx) => {
      const current = await runs.find(tx, run.id);
      expect(current?.status).toBe('awaiting_approval');
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: current!.runVersion,
          from: 'awaiting_approval',
          to: 'cancelling',
        }),
      ).toBe(true);
      const cancelling = await runs.find(tx, run.id);
      expect(
        await runs.transition(tx, {
          runId: run.id,
          expectedVersion: cancelling!.runVersion,
          from: 'cancelling',
          to: 'cancelled',
        }),
      ).toBe(true);
    });
    const terminal = await ai.withTenant(0, (tx) =>
      runs.terminalStreamReference(tx, run.id),
    );
    if (!terminal) throw new Error('Terminal stream reference unavailable');
    await streams.finish(terminal, {
      version: 1,
      runId: run.id,
      type: 'finish',
    });
    const events = (
      await redis.xrange(
        `${services.queuePrefix}:{run-streams}:${run.id}:events`,
        '-',
        '+',
      )
    ).map(([, fields]) => JSON.parse(fields[1]! as string));
    expect(events.slice(-2)).toEqual([
      { version: 1, runId: run.id, type: 'status', status: 'cancelled' },
      { version: 1, runId: run.id, type: 'finish' },
    ]);
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('an owned stream connection stall bounds queued publications without late writes', async ({
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
  const inspector = new Redis(services.valkey.streamsUrl);
  const originalTime = Redis.prototype.time;
  let stallTime = false;
  let heldTimeCalls = 0;
  let releaseTime!: () => void;
  let resolveTimeHeld!: () => void;
  let resolveTimeSettled!: () => void;
  const timeBarrier = new Promise<void>((resolve) => {
    releaseTime = resolve;
  });
  const timeHeld = new Promise<void>((resolve) => {
    resolveTimeHeld = resolve;
  });
  const timeSettled = new Promise<void>((resolve) => {
    resolveTimeSettled = resolve;
  });
  const timeSpy = vi
    .spyOn(Redis.prototype, 'time')
    .mockImplementation(async function (this: Redis) {
      let heldCall = false;
      if (stallTime) {
        stallTime = false;
        heldCall = true;
        heldTimeCalls++;
        resolveTimeHeld();
        await timeBarrier;
      }
      try {
        return await originalTime.call(this);
      } finally {
        if (heldCall) resolveTimeSettled();
      }
    });
  let evalSpy: ReturnType<typeof vi.spyOn> | undefined;
  let releaseAppend!: () => void;
  let resolveAppendHeld!: () => void;
  let resolveAppendSettled!: () => void;
  const appendBarrier = new Promise<void>((resolve) => {
    releaseAppend = resolve;
  });
  const appendHeld = new Promise<void>((resolve) => {
    resolveAppendHeld = resolve;
  });
  const appendSettled = new Promise<void>((resolve) => {
    resolveAppendSettled = resolve;
  });
  let heldAppendCalls = 0;
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Deadline stream claim unavailable');
    await streams.recover(claim, {
      version: 1,
      runId: run.id,
      type: 'reset',
      sequence: claim.sequence,
    });
    stallTime = true;
    const timeCallsBeforeStall = heldTimeCalls;
    const started = performance.now();
    const first = streams.publish(claim, {
      version: 1,
      runId: run.id,
      type: 'text-delta',
      id: 'deadline-test',
      delta: 'must not arrive late',
    });
    const queued = streams.publish(claim, {
      version: 1,
      runId: run.id,
      type: 'text-delta',
      id: 'queued-deadline-test',
      delta: 'queued event must not arrive late',
    });
    await timeHeld;
    const [result, queuedResult] = await Promise.all([first, queued]);
    const elapsedMs = performance.now() - started;
    expect(result).toBe('unavailable');
    expect(queuedResult).toBe('unavailable');
    expect(elapsedMs).toBeLessThan(450);
    releaseTime();
    await timeSettled;
    expect(heldTimeCalls - timeCallsBeforeStall).toBe(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const entries = await inspector.xrange(
      `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      '-',
      '+',
    );
    expect(
      entries.some(([, fields]) => fields[1]?.includes('must not arrive late')),
    ).toBe(false);
    const originalEval = Redis.prototype.eval;
    let delayAppend = true;
    evalSpy = vi.spyOn(Redis.prototype, 'eval');
    evalSpy.mockImplementation(async function (
      this: Redis,
      ...args: unknown[]
    ) {
      if (
        delayAppend &&
        args[0] === APPEND_RUN_STREAM &&
        args.at(-2) === 'text-delta'
      ) {
        delayAppend = false;
        heldAppendCalls++;
        resolveAppendHeld();
        await appendBarrier;
      }
      try {
        return await originalEval.apply(this, args as never);
      } finally {
        if (heldAppendCalls > 0) resolveAppendSettled();
      }
    } as never);
    const appendStarted = performance.now();
    const appendResult = await streams.publish(claim, {
      version: 1,
      runId: run.id,
      type: 'text-delta',
      id: 'late-eval-test',
      delta: 'late EVAL must be refused',
    });
    await appendHeld;
    expect(appendResult).toBe('unavailable');
    expect(performance.now() - appendStarted).toBeLessThan(450);
    releaseAppend();
    await appendSettled;
    const afterLateEval = await inspector.xrange(
      `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      '-',
      '+',
    );
    expect(
      afterLateEval.some(([, fields]) =>
        fields[1]?.includes('late EVAL must be refused'),
      ),
    ).toBe(false);
  } finally {
    releaseTime();
    releaseAppend();
    if (heldAppendCalls > 0) await appendSettled;
    timeSpy.mockRestore();
    evalSpy?.mockRestore();
    redis.disconnect();
    inspector.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('timed out recovery EVAL cannot append a late reset before a newer publication', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: claimAuthority(ai.database as TenantDatabase, steps),
  });
  const inspector = new Redis(services.valkey.streamsUrl);
  const originalEval = Redis.prototype.eval;
  let holdNextAppend = false;
  let recoveryDeadlineAt = 0;
  let recoveryEvalCalls = 0;
  let recoveryObservedEvals = 0;
  let recoveryReleaseServerMs: number;
  const realDateNow = () => new Date().getTime();
  let clientClockOffsetMs = 0;
  const clientClockSpy = vi
    .spyOn(Date, 'now')
    .mockImplementation(() => realDateNow() + clientClockOffsetMs);
  let releaseAppend!: () => void;
  let resolveEvalHeld!: () => void;
  let resolveEvalSettled!: () => void;
  const evalHeld = new Promise<void>((resolve) => {
    resolveEvalHeld = resolve;
  });
  const evalSettled = new Promise<void>((resolve) => {
    resolveEvalSettled = resolve;
  });
  const appendBarrier = new Promise<void>((resolve) => {
    releaseAppend = resolve;
  });
  const evalSpy = vi.spyOn(Redis.prototype, 'eval');
  evalSpy.mockImplementation(async function (this: Redis, ...args: unknown[]) {
    recoveryObservedEvals++;
    const source = args[0];
    let heldCall = false;
    if (
      holdNextAppend &&
      typeof source === 'string' &&
      source.includes('local runId = ARGV[1]') &&
      args.at(-2) === 'reset'
    ) {
      holdNextAppend = false;
      heldCall = true;
      recoveryEvalCalls++;
      recoveryDeadlineAt = Number(args.at(-3));
      resolveEvalHeld();
      await appendBarrier;
    }
    try {
      return await originalEval.apply(this, args as never);
    } finally {
      if (heldCall) resolveEvalSettled();
    }
  } as never);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Recovery deadline claim unavailable');
    const snapshot = {
      version: 1 as const,
      runId: run.id,
      type: 'reset' as const,
      sequence: claim.sequence,
    };
    await streams.recover(claim, snapshot);
    clientClockOffsetMs = 100;
    holdNextAppend = true;
    const recoveryStarted = performance.now();
    const recovery = streams.recover(claim, snapshot);
    const heldResult = await Promise.race([
      evalHeld.then(() => 'held' as const),
      new Promise<'not-held'>((resolve) =>
        setTimeout(() => resolve('not-held'), 2_000),
      ),
    ]);
    if (heldResult !== 'held') {
      process.stderr.write(
        JSON.stringify({
          evidence: 'recovery-eval-not-intercepted',
          observedEvals: recoveryObservedEvals,
          heldEvals: recoveryEvalCalls,
        }) + '\n',
      );
      throw new Error(
        'Recovery APPEND EVAL was not observed at the writer boundary',
      );
    }
    const recoveryResult = await Promise.race([
      recovery.then((result) => result),
      new Promise<'still-pending'>((resolve) =>
        setTimeout(() => resolve('still-pending'), 300),
      ),
    ]);
    const recoveryElapsedMs = performance.now() - recoveryStarted;
    const [recoveryServerSeconds, recoveryServerMicros] =
      await inspector.time();
    recoveryReleaseServerMs =
      Number(recoveryServerSeconds) * 1000 +
      Math.floor(Number(recoveryServerMicros) / 1000);
    process.stderr.write(
      JSON.stringify({
        evidence: 'recovery-clock-skew',
        heldEvals: recoveryEvalCalls,
        clientDeadline: recoveryDeadlineAt,
        clientNowAtTimeout: Date.now(),
        valkeyNowBeforeRelease: recoveryReleaseServerMs,
        offsetMs: clientClockOffsetMs,
      }) + '\n',
    );
    expect(recoveryReleaseServerMs).toBeGreaterThanOrEqual(recoveryDeadlineAt);
    clientClockOffsetMs = 0;
    releaseAppend();
    const fresh = streams.publish(claim, {
      version: 1,
      runId: run.id,
      type: 'text-delta',
      id: 'after-timeout',
      delta: 'fresh publication',
    });
    await evalSettled;
    await expect(fresh).resolves.toBe('written');
    const entries = await inspector.xrange(
      `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      '-',
      '+',
    );
    process.stderr.write(
      JSON.stringify({
        evidence: 'recovery-events',
        types: entries.map(
          ([, fields]) => (JSON.parse(fields[1]!) as { type: string }).type,
        ),
        recoveryResult,
      }) + '\n',
    );
    expect(recoveryResult).toBe('unavailable');
    expect(recoveryElapsedMs).toBeLessThan(300);
    expect(entries.map(([, fields]) => JSON.parse(fields[1]!))).toEqual([
      snapshot,
      {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'after-timeout',
        delta: 'fresh publication',
      },
    ]);
  } finally {
    releaseAppend();
    if (recoveryEvalCalls > 0) await evalSettled;
    clientClockSpy.mockRestore();
    evalSpy.mockRestore();
    inspector.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('timed out terminal EVAL cannot append or recreate a stream after its deadline', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: claimAuthority(ai.database as TenantDatabase, steps),
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const originalEval = Redis.prototype.eval;
  let holdFinish = false;
  let finishDeadlineAt = 0;
  let finishEvalCalls = 0;
  let finishReleaseServerMs: number;
  const realFinishDateNow = () => new Date().getTime();
  let finishClockOffsetMs = 0;
  const finishClockSpy = vi
    .spyOn(Date, 'now')
    .mockImplementation(() => realFinishDateNow() + finishClockOffsetMs);
  let releaseFinish!: () => void;
  let resolveFinishEvalHeld!: () => void;
  let resolveFinishEvalSettled!: () => void;
  const finishBarrier = new Promise<void>((resolve) => {
    releaseFinish = resolve;
  });
  const finishEvalHeld = new Promise<void>((resolve) => {
    resolveFinishEvalHeld = resolve;
  });
  const finishEvalSettled = new Promise<void>((resolve) => {
    resolveFinishEvalSettled = resolve;
  });
  const evalSpy = vi.spyOn(Redis.prototype, 'eval');
  evalSpy.mockImplementation(async function (this: Redis, ...args: unknown[]) {
    let heldCall = false;
    if (holdFinish && args[0] === FINISH_RUN_STREAM) {
      holdFinish = false;
      heldCall = true;
      finishEvalCalls++;
      finishDeadlineAt = Number(args.at(-1));
      resolveFinishEvalHeld();
      await finishBarrier;
    }
    try {
      return await originalEval.apply(this, args as never);
    } finally {
      if (heldCall) resolveFinishEvalSettled();
    }
  } as never);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Terminal deadline claim unavailable');
    await streams.recover(claim, {
      version: 1,
      runId: run.id,
      type: 'reset',
      sequence: claim.sequence,
    });
    await ai.withTenant(0, async (tx) => {
      expect(await steps.lockClaim(tx, claim)).toBe(true);
      expect(
        await steps.commit(tx, claim, {
          state: 'committed',
          text: 'terminal',
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
          outputAppend: 'terminal',
          finalizeOutput: true,
        }),
      ).toBe(true);
    });
    const streamKey = `${services.queuePrefix}:{run-streams}:${run.id}:events`;
    const initialLength = await redis.xlen(streamKey);
    finishClockOffsetMs = 100;
    holdFinish = true;
    const started = performance.now();
    const finishing = streams.finish(claim, {
      version: 1,
      runId: run.id,
      type: 'finish',
    });
    await finishEvalHeld;
    const publicResult = await Promise.race([
      finishing.then(() => 'settled' as const),
      new Promise<'still-pending'>((resolve) =>
        setTimeout(() => resolve('still-pending'), 300),
      ),
    ]);
    const elapsedMs = performance.now() - started;
    const [finishServerSeconds, finishServerMicros] = await redis.time();
    finishReleaseServerMs =
      Number(finishServerSeconds) * 1000 +
      Math.floor(Number(finishServerMicros) / 1000);
    process.stderr.write(
      JSON.stringify({
        evidence: 'finish-clock-skew',
        heldEvals: finishEvalCalls,
        clientDeadline: finishDeadlineAt,
        clientNowAtTimeout: Date.now(),
        valkeyNowBeforeRelease: finishReleaseServerMs,
        offsetMs: finishClockOffsetMs,
      }) + '\n',
    );
    expect(finishReleaseServerMs).toBeGreaterThanOrEqual(finishDeadlineAt);
    finishClockOffsetMs = 0;
    releaseFinish();
    await finishEvalSettled;
    expect(publicResult).toBe('settled');
    expect(elapsedMs).toBeLessThan(300);
    const terminalEntries = await redis.xrange(streamKey, '-', '+');
    const terminalTypes = terminalEntries.map(
      ([, fields]) => (JSON.parse(fields[1]!) as { type: string }).type,
    );
    process.stderr.write(
      JSON.stringify({
        evidence: 'finish-events',
        initialLength,
        finalLength: terminalEntries.length,
        addedTypes: terminalTypes.slice(initialLength),
        heldEvals: finishEvalCalls,
      }) + '\n',
    );
    expect(terminalEntries.length).toBe(initialLength);
    expect(
      (
        await redis.zrange(
          `${services.queuePrefix}:{run-streams}:terminal`,
          '0',
          '-1',
        )
      ).some((member) => member.startsWith(`${run.id}|`)),
    ).toBe(false);
    expect(
      await redis.zscore(
        `${services.queuePrefix}:{run-streams}:active`,
        run.id,
      ),
    ).not.toBeNull();
  } finally {
    releaseFinish();
    if (finishEvalCalls > 0) await finishEvalSettled;
    finishClockSpy.mockRestore();
    evalSpy.mockRestore();
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('a stalled TIME sample settles on the local budget and dispatches no late write', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: claimAuthority(ai.database as TenantDatabase, steps),
  });
  const inspector = new Redis(services.valkey.streamsUrl);
  const originalTime = Redis.prototype.time;
  const originalEval = Redis.prototype.eval;
  let holdTime = true;
  let heldTime = false;
  let releaseTime!: () => void;
  let resolveTimeHeld!: () => void;
  let resolveTimeSettled!: () => void;
  let evalCalls = 0;
  const timeBarrier = new Promise<void>((resolve) => {
    releaseTime = resolve;
  });
  const timeHeld = new Promise<void>((resolve) => {
    resolveTimeHeld = resolve;
  });
  const timeSettled = new Promise<void>((resolve) => {
    resolveTimeSettled = resolve;
  });
  const timeSpy = vi
    .spyOn(Redis.prototype, 'time')
    .mockImplementation(async function (this: Redis) {
      let heldCall = false;
      if (holdTime) {
        holdTime = false;
        heldCall = true;
        heldTime = true;
        resolveTimeHeld();
        await timeBarrier;
      }
      try {
        return await originalTime.call(this);
      } finally {
        if (heldCall) resolveTimeSettled();
      }
    });
  const evalSpy = vi
    .spyOn(Redis.prototype, 'eval')
    .mockImplementation(async function (this: Redis, ...args: unknown[]) {
      evalCalls++;
      return originalEval.apply(this, args as never);
    });
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Stalled TIME claim unavailable');
    const started = performance.now();
    const recovery = streams.recover(claim, {
      version: 1,
      runId: run.id,
      type: 'reset',
      sequence: claim.sequence,
    });
    await timeHeld;
    const result = await Promise.race([
      recovery,
      new Promise<'still-pending'>((resolve) =>
        setTimeout(() => resolve('still-pending'), 300),
      ),
    ]);
    expect(result).toBe('unavailable');
    expect(performance.now() - started).toBeLessThan(300);
    releaseTime();
    await timeSettled;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(evalCalls).toBe(0);
    const prefix = `${services.queuePrefix}:{run-streams}`;
    expect(
      await inspector.exists(
        `${prefix}:${run.id}:events`,
        `${prefix}:${run.id}:guard`,
      ),
    ).toBe(0);
    expect(await inspector.zscore(`${prefix}:active`, run.id)).toBeNull();
  } finally {
    releaseTime();
    if (heldTime) await timeSettled;
    timeSpy.mockRestore();
    evalSpy.mockRestore();
    inspector.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('a separate terminal writer closes a text part left open by a dead publisher', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  const authority = claimAuthority(ai.database as TenantDatabase, steps);
  const oldPublisher = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority,
  });
  const terminalWriter = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority,
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Protocol closure claim unavailable');
    await oldPublisher.recover(claim, {
      version: 1,
      runId: run.id,
      type: 'reset',
      sequence: claim.sequence,
    });
    for (const event of [
      { version: 1, runId: run.id, type: 'start', messageId: run.id },
      { version: 1, runId: run.id, type: 'start-step' },
      { version: 1, runId: run.id, type: 'text-start', id: 'open-part' },
      {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'open-part',
        delta: 'persisted partial',
      },
    ] as const)
      expect(await oldPublisher.publish(claim, event as never)).toBe('written');

    await ai.withTenant(0, async (tx) => {
      expect(await steps.lockClaim(tx, claim)).toBe(true);
      expect(
        await steps.commit(tx, claim, {
          state: 'committed',
          text: 'persisted partial',
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
          outputAppend: 'persisted partial',
          finalizeOutput: true,
        }),
      ).toBe(true);
    });
    await terminalWriter.finish(claim, {
      version: 1,
      runId: run.id,
      type: 'finish',
    });
    const rows = await redis.xrange(
      `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      '-',
      '+',
    );
    const chunks = rows
      .map(([, fields]) => JSON.parse(fields[1]!) as Record<string, unknown>)
      .filter((event) =>
        [
          'start',
          'start-step',
          'text-start',
          'text-delta',
          'text-end',
          'finish-step',
          'finish',
        ].includes(String(event.type)),
      ) as UIMessageChunk[];
    const messages = await consumeUiMessageChunks(chunks);
    const parts = (
      messages.at(-1) as { parts: { type: string; state?: string }[] }
    ).parts;
    expect(parts.find((part) => part.type === 'text')).toMatchObject({
      type: 'text',
      state: 'done',
    });
    expect(
      rows.map(([, fields]) => JSON.parse(fields[1]!).type).slice(-4),
    ).toEqual(['text-end', 'finish-step', 'status', 'finish']);
  } finally {
    redis.disconnect();
    await Promise.all([oldPublisher.close(), terminalWriter.close()]);
    await ai.close();
  }
});

test('terminal guard preserves opaque text part IDs with leading or embedded pipes', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  const authority = claimAuthority(ai.database as TenantDatabase, steps);
  const oldPublisher = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority,
  });
  const terminalWriter = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority,
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const replayResults: {
    id: string;
    state?: string;
    terminalId: unknown;
    terminalTypes: unknown[];
    error?: string;
  }[] = [];
  try {
    for (const textPartId of ['part|tail', '|leading'] as const) {
      const run = await ai.start(0);
      await ai.seedPendingStep(0, run.id);
      const claim = await ai.claim(0, run.id, 1, 1, 30_000);
      if (!claim) throw new Error('Opaque text part ID claim unavailable');
      await oldPublisher.recover(claim, {
        version: 1,
        runId: run.id,
        type: 'reset',
        sequence: claim.sequence,
      });
      for (const event of [
        { version: 1, runId: run.id, type: 'start', messageId: run.id },
        { version: 1, runId: run.id, type: 'start-step' },
        { version: 1, runId: run.id, type: 'text-start', id: textPartId },
        {
          version: 1,
          runId: run.id,
          type: 'text-delta',
          id: textPartId,
          delta: 'opaque id text',
        },
      ] as const)
        expect(await oldPublisher.publish(claim, event as never)).toBe(
          'written',
        );

      await ai.withTenant(0, async (tx) => {
        expect(await steps.lockClaim(tx, claim)).toBe(true);
        expect(
          await steps.commit(tx, claim, {
            state: 'committed',
            text: 'opaque id text',
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
            outputAppend: 'opaque id text',
            finalizeOutput: true,
          }),
        ).toBe(true);
      });
      await terminalWriter.finish(claim, {
        version: 1,
        runId: run.id,
        type: 'finish',
      });

      const rows = await redis.xrange(
        `${services.queuePrefix}:{run-streams}:${run.id}:events`,
        '-',
        '+',
      );
      const chunks = rows
        .map(([, fields]) => JSON.parse(fields[1]!) as Record<string, unknown>)
        .filter((event) =>
          [
            'start',
            'start-step',
            'text-start',
            'text-delta',
            'text-end',
            'finish-step',
            'finish',
          ].includes(String(event.type)),
        ) as UIMessageChunk[];
      const terminalId = JSON.parse(rows.at(-4)![1][1]!).id;
      const terminalTypes = rows
        .map(([, fields]) => JSON.parse(fields[1]!).type)
        .slice(-4);
      try {
        const messages = await consumeUiMessageChunks(chunks);
        const parts = (
          messages.at(-1) as {
            parts: { type: string; id?: string; state?: string }[];
          }
        ).parts;
        const part = parts.find((value) => value.type === 'text');
        replayResults.push({
          id: textPartId,
          ...(part?.state === undefined ? {} : { state: part.state }),
          terminalId,
          terminalTypes,
        });
      } catch (error) {
        replayResults.push({
          id: textPartId,
          terminalId,
          terminalTypes,
          error:
            error instanceof Error ? error.message : 'unknown replay error',
        });
      }
    }
    expect(replayResults).toEqual([
      {
        id: 'part|tail',
        state: 'done',
        terminalId: 'part|tail',
        terminalTypes: ['text-end', 'finish-step', 'status', 'finish'],
      },
      {
        id: '|leading',
        state: 'done',
        terminalId: '|leading',
        terminalTypes: ['text-end', 'finish-step', 'status', 'finish'],
      },
    ]);
  } finally {
    redis.disconnect();
    await Promise.all([oldPublisher.close(), terminalWriter.close()]);
    await ai.close();
  }
});

test('worker recovery resets old framing state before the next UI replay', async ({
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
    if (!claim) throw new Error('Recovery framing claim unavailable');
    await streams.recover(claim, {
      version: 1,
      runId: run.id,
      type: 'reset',
      sequence: claim.sequence,
    });
    for (const event of [
      { version: 1, runId: run.id, type: 'start', messageId: run.id },
      { version: 1, runId: run.id, type: 'start-step' },
      { version: 1, runId: run.id, type: 'text-start', id: 'old-part' },
      {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'old-part',
        delta: 'discarded provisional text',
      },
    ] as const)
      expect(await streams.publish(claim, event as never)).toBe('written');

    await streams.recover(claim, {
      version: 1,
      runId: run.id,
      type: 'reset',
      sequence: claim.sequence,
    });
    expect(
      await streams.publish(claim, {
        version: 1,
        runId: run.id,
        type: 'start',
        messageId: run.id,
      }),
    ).toBe('written');
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
          runId: run.id,
          expectedVersion: claim.expectedVersion,
          from: 'queued',
          to: 'completed',
          nextSequence: claim.sequence + 1,
          outputAppend: '',
          finalizeOutput: true,
        }),
      ).toBe(true);
    });
    await streams.finish(claim, { version: 1, runId: run.id, type: 'finish' });
    const rows = await redis.xrange(
      `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      '-',
      '+',
    );
    const events = rows.map(
      ([, fields]) => JSON.parse(fields[1]!) as Record<string, unknown>,
    );
    const lastReset = events.findLastIndex((event) => event.type === 'reset');
    const replay = events.slice(lastReset + 1);
    expect(replay.map((event) => event.type)).toEqual([
      'start',
      'status',
      'finish',
    ]);
    const chunks = replay.filter((event) =>
      ['start', 'finish'].includes(String(event.type)),
    ) as UIMessageChunk[];
    const messages = await consumeUiMessageChunks(chunks);
    expect(messages.at(-1)).toMatchObject({
      id: run.id,
      role: 'assistant',
      parts: [],
    });
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('failed first step terminal finish is recovered from the real registry reference', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const claimAuthorityValue = claimAuthority(
    ai.database as TenantDatabase,
    steps,
  );
  const firstRun = await ai.start(0);
  await ai.seedPendingStep(0, firstRun.id);
  const oldClaim = await ai.claim(0, firstRun.id, 1, 1, 30_000);
  if (!oldClaim) throw new Error('Stream test claim unavailable');
  let loseFirstTerminalProof = true;
  const authority = {
    ...claimAuthorityValue,
    authorizeTerminal: (claim: TerminalStreamReference) => {
      if (loseFirstTerminalProof) {
        loseFirstTerminalProof = false;
        return Promise.resolve(undefined);
      }
      return claimAuthorityValue.authorizeTerminal(claim);
    },
  };
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority,
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    await streams.recover(oldClaim, {
      version: 1,
      runId: firstRun.id,
      type: 'reset',
      sequence: 1,
    });
    await ai.withTenant(0, async (tx) => {
      await ai.expireClaimLeaseInSession(tx, oldClaim);
      await steps.lockTenantClaimGuard(tx);
      const recovery = await steps.failExpiredCurrent(tx, {
        runId: oldClaim.runId,
        sequence: oldClaim.sequence,
        expectedVersion: oldClaim.expectedVersion,
        stepId: oldClaim.stepId,
        fence: oldClaim.fence,
      });
      expect(recovery.changed).toBe(true);
      expect(
        await runs.transition(tx, {
          runId: oldClaim.runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'failed',
          errorCode: 'AI_INTERNAL',
          nextSequence: 2,
        }),
      ).toBe(true);
    });
    const terminal = await ai.withTenant(0, (tx) =>
      runs.terminalStreamReference(tx, firstRun.id),
    );
    expect(terminal).toMatchObject({
      runId: firstRun.id,
      stepId: oldClaim.stepId,
      sequence: 1,
      expectedVersion: 1,
      fence: oldClaim.fence,
      neutral: true,
    });
    await streams.finish(terminal!, {
      version: 1,
      runId: firstRun.id,
      type: 'finish',
    });
    const firstStream = `${services.queuePrefix}:{run-streams}:${firstRun.id}:events`;
    expect(await redis.xlen(firstStream)).toBe(1);

    const secondRun = await ai.start(0);
    await ai.seedPendingStep(0, secondRun.id);
    const newClaim = await ai.claim(0, secondRun.id, 1, 1, 30_000);
    if (!newClaim) throw new Error('Second stream test claim unavailable');
    expect(
      await streams.publish(newClaim, {
        version: 1,
        runId: secondRun.id,
        type: 'start',
        messageId: randomUUID(),
      }),
    ).toBe('written');
    const events = await redis.xrange(firstStream, '-', '+');
    expect(events).toHaveLength(4);
    expect(
      events.map(([, fields]) => JSON.parse(fields[1]! as string)).slice(-3),
    ).toEqual([
      { version: 1, runId: firstRun.id, type: 'status', status: 'failed' },
      { version: 1, runId: firstRun.id, type: 'error', code: 'AI_INTERNAL' },
      { version: 1, runId: firstRun.id, type: 'finish' },
    ]);
    expect(
      await redis.zscore(
        `${services.queuePrefix}:{run-streams}:active`,
        firstRun.id,
      ),
    ).toBeNull();
  } finally {
    await streams.close();
    redis.disconnect();
    await ai.close();
  }
});

test('publication contains a Valkey failure and later recovers', async ({
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
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Stream outage claim unavailable');
    const original = Redis.prototype.zscore;
    let failActiveLookup = true;
    const zscore = vi
      .spyOn(Redis.prototype, 'zscore')
      .mockImplementation(function (this: Redis, key, member) {
        if (failActiveLookup && String(key).endsWith(':active')) {
          failActiveLookup = false;
          return Promise.reject(new Error('simulated Valkey disconnect'));
        }
        return original.call(this, key, member);
      });
    try {
      await expect(
        streams.publish(claim, {
          version: 1,
          runId: run.id,
          type: 'status',
          status: 'running',
        }),
      ).resolves.toBe('unavailable');
      await expect(
        streams.publish(claim, {
          version: 1,
          runId: run.id,
          type: 'status',
          status: 'running',
        }),
      ).resolves.toBe('written');
    } finally {
      zscore.mockRestore();
    }
    expect(
      await redis.xlen(
        `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      ),
    ).toBe(1);
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('an expired proof cannot mutate after a replacement fence is claimed', async ({
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
  let releasePrepare!: () => void;
  let prepareReady!: () => void;
  const release = new Promise<void>((resolve) => {
    releasePrepare = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    prepareReady = resolve;
  });
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const oldClaim = await ai.claim(0, run.id, 1, 1, 100);
    if (!oldClaim) throw new Error('Lease race claim unavailable');
    const originalEval = Redis.prototype.eval;
    const evalSpy = vi
      .spyOn(Redis.prototype, 'eval')
      .mockImplementation(async function (this: Redis, ...args) {
        if (
          typeof args[0] === 'string' &&
          args[0].includes('local activeGuard = ARGV[3]')
        ) {
          prepareReady();
          await release;
        }
        return originalEval.apply(this, args);
      });
    try {
      const pending = streams.publish(oldClaim, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'expired-proof',
        delta: 'must not append',
      });
      await ready;
      const remaining = oldClaim.leaseUntil.getTime() - Date.now();
      if (remaining > 0)
        await new Promise((resolve) => setTimeout(resolve, remaining + 5));
      const replacement = await ai.claim(0, run.id, 1, 1, 30_000);
      if (!replacement) throw new Error('Replacement lease claim unavailable');
      expect(replacement.fence).toBeGreaterThan(oldClaim.fence);
      releasePrepare();
      await expect(pending).resolves.toBe('stale');
    } finally {
      releasePrepare();
      evalSpy.mockRestore();
    }
    expect(
      await redis.exists(
        `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      ),
    ).toBe(0);
    expect(
      await redis.exists(
        `${services.queuePrefix}:{run-streams}:${run.id}:guard`,
      ),
    ).toBe(0);
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('a renewed DB lease remains publishable after the claim snapshot deadline', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: claimAuthority(ai.database as TenantDatabase, steps),
  });
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 1_200);
    if (!claim) throw new Error('Renewed lease claim unavailable');
    expect(await ai.withTenant(0, (tx) => steps.renew(tx, claim, 30_000))).toBe(
      true,
    );
    const remaining = claim.leaseUntil.getTime() - Date.now();
    if (remaining > 0)
      await new Promise((resolve) => setTimeout(resolve, remaining + 30));
    expect(
      await streams.publish(claim, {
        version: 1,
        runId: run.id,
        type: 'status',
        status: 'running',
      }),
    ).toBe('written');
  } finally {
    await streams.close();
    await ai.close();
  }
});

test('public publication cannot write a terminal marker or finalize a nonterminal event', async ({
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
    const claim = await ai.claim(0, run.id, 1, 1, 30_000);
    if (!claim) throw new Error('Stream boundary claim unavailable');
    await expect(
      streams.publish(claim, { version: 1, runId: run.id, type: 'finish' }),
    ).resolves.toBe('stale');
    await expect(
      streams.finish(claim, {
        version: 1,
        runId: run.id,
        type: 'text-delta',
        id: 'wrong-terminal',
        delta: 'no',
      }),
    ).rejects.toThrow('Terminal stream event must use finish');
    expect(
      await redis.exists(
        `${services.queuePrefix}:{run-streams}:${run.id}:events`,
      ),
    ).toBe(0);
  } finally {
    redis.disconnect();
    await streams.close();
    await ai.close();
  }
});

test('terminal replay after retained-key expiry preserves one generation', async ({
  services,
}) => {
  const testPrefix = `${services.queuePrefix}_r${randomUUID().slice(0, 6)}`;
  const active = new Set<string>();
  const terminal = new Set<string>();
  const claims = new Map<string, StepClaim>();
  const claim: StepClaim = {
    runId: randomUUID(),
    orgId: randomUUID(),
    userId: randomUUID(),
    stepId: randomUUID(),
    sequence: 1,
    expectedVersion: 1,
    fence: 1,
    leaseUntil: new Date(Date.now() + 30_000),
  };
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: testPrefix,
    authority: {
      authorizeActive: async (candidate) =>
        active.has(candidate.runId)
          ? {
              runVersion: candidate.expectedVersion,
              nextSequence: candidate.sequence,
              status: 'running',
              stepId: candidate.stepId,
              sequence: candidate.sequence,
              expectedVersion: candidate.expectedVersion,
              fence: candidate.fence,
              leaseUntil: new Date(Date.now() + 30_000),
            }
          : undefined,
      authorizeTerminal: async (candidate) =>
        terminal.has(candidate.runId)
          ? {
              status: 'completed',
              runVersion: candidate.expectedVersion + 1,
              nextSequence: candidate.sequence + 1,
              latestCommittedStepId: candidate.stepId,
              latestCommittedSequence: candidate.sequence,
              latestCommittedExpectedVersion: candidate.expectedVersion,
              latestCommittedFence: candidate.fence,
            }
          : undefined,
      reconcile: async (entries) =>
        entries.map(({ runId }) => {
          if (active.has(runId)) return { runId, state: 'active' as const };
          const knownClaim = claims.get(runId);
          if (terminal.has(runId) && knownClaim)
            return { runId, state: 'terminal' as const, claim: knownClaim };
          return { runId, state: 'missing' as const };
        }),
    },
  });
  claims.set(claim.runId, claim);
  const redis = new Redis(services.valkey.streamsUrl);
  const prefix = `${testPrefix}:{run-streams}`;
  try {
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
    await redis.del(
      `${prefix}:${claim.runId}:events`,
      `${prefix}:${claim.runId}:guard`,
    );
    await streams.finish(claim, {
      version: 1,
      runId: claim.runId,
      type: 'finish',
    });
    const [member] = await redis.zrange(`${prefix}:terminal`, '0', '-1');
    expect(await redis.zcard(`${prefix}:terminal`)).toBe(1);
    expect(member).toMatch(new RegExp(`^${claim.runId}\\|[0-9a-f-]{36}$`));
    expect(await redis.exists(`${prefix}:${claim.runId}:guard`)).toBe(0);
    expect(await redis.exists(`${prefix}:${claim.runId}:events`)).toBe(0);

    for (let index = 0; index < 6; index++) {
      const nextClaim: StepClaim = {
        ...claim,
        runId: randomUUID(),
        stepId: randomUUID(),
      };
      claims.set(nextClaim.runId, nextClaim);
      active.add(nextClaim.runId);
      expect(
        await streams.publish(nextClaim, {
          version: 1,
          runId: nextClaim.runId,
          type: 'status',
          status: 'running',
        }),
      ).toBe('written');
      active.delete(nextClaim.runId);
      terminal.add(nextClaim.runId);
      await streams.finish(nextClaim, {
        version: 1,
        runId: nextClaim.runId,
        type: 'finish',
      });
    }
    const retained = await redis.zrange(`${prefix}:terminal`, '0', '-1');
    expect(retained).toHaveLength(6);
    expect(new Set(retained.map((entry) => entry.split('|', 1)[0])).size).toBe(
      6,
    );
    for (const terminalMember of retained) {
      const runId = terminalMember.split('|', 1)[0]!;
      const guard = await redis.get(`${prefix}:${runId}:guard`);
      expect(guard?.endsWith(terminalMember.split('|')[1]!)).toBe(true);
      expect(
        await redis.exists(
          `${prefix}:${runId}:events`,
          `${prefix}:${runId}:guard`,
        ),
      ).toBe(2);
    }
    for (let index = 0; index < 10; index++) {
      const [expiredMember] = await redis.zrange(
        `${prefix}:terminal`,
        '0',
        '0',
      );
      if (!expiredMember) throw new Error('Terminal candidate unavailable');
      const expiredRunId = expiredMember.split('|', 1)[0]!;
      await redis.del(
        `${prefix}:${expiredRunId}:events`,
        `${prefix}:${expiredRunId}:guard`,
      );
      const nextClaim: StepClaim = {
        ...claim,
        runId: randomUUID(),
        stepId: randomUUID(),
      };
      claims.set(nextClaim.runId, nextClaim);
      active.add(nextClaim.runId);
      expect(
        await streams.publish(nextClaim, {
          version: 1,
          runId: nextClaim.runId,
          type: 'status',
          status: 'running',
        }),
      ).toBe('written');
      active.delete(nextClaim.runId);
      terminal.add(nextClaim.runId);
      await streams.finish(nextClaim, {
        version: 1,
        runId: nextClaim.runId,
        type: 'finish',
      });
      const currentMembers = await redis.zrange(
        `${prefix}:terminal`,
        '0',
        '-1',
      );
      const currentRunIds = currentMembers.map(
        (member) => member.split('|', 1)[0]!,
      );
      expect(new Set(await redis.hkeys(`${prefix}:contexts`))).toEqual(
        new Set(currentRunIds),
      );
      expect(await redis.hlen(`${prefix}:contexts`)).toBeLessThanOrEqual(6);
      expect(
        await redis.hlen(`${prefix}:terminal-members`),
      ).toBeLessThanOrEqual(6);
    }
  } finally {
    redis.disconnect();
    await streams.close();
  }
});

test('recovery bounds queued publication and resets before fresh deltas', async ({
  services,
}) => {
  const testPrefix = `${services.queuePrefix}_q${randomUUID().slice(0, 6)}`;
  const claim: StepClaim = {
    runId: randomUUID(),
    orgId: randomUUID(),
    userId: randomUUID(),
    stepId: randomUUID(),
    sequence: 1,
    expectedVersion: 1,
    fence: 1,
    leaseUntil: new Date(Date.now() + 30_000),
  };
  let releaseProof!: () => void;
  let proofReady!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseProof = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    proofReady = resolve;
  });
  let pause = true;
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: testPrefix,
    authority: {
      authorizeActive: async (candidate) => {
        if (pause) {
          pause = false;
          proofReady();
          await release;
        }
        return {
          runVersion: candidate.expectedVersion,
          nextSequence: candidate.sequence,
          status: 'running',
          stepId: candidate.stepId,
          sequence: candidate.sequence,
          expectedVersion: candidate.expectedVersion,
          fence: candidate.fence,
          leaseUntil: new Date(Date.now() + 30_000),
        };
      },
      authorizeTerminal: async () => undefined,
      reconcile: async (entries) =>
        entries.map(({ runId }) => ({ runId, state: 'active' as const })),
    },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    const first = streams.publish(claim, {
      version: 1,
      runId: claim.runId,
      type: 'text-delta',
      id: 'old',
      delta: 'old in-flight',
    });
    await ready;
    const overBudgetPending = streams.publish(claim, {
      version: 1,
      runId: claim.runId,
      type: 'text-delta',
      id: 'too-large-while-blocked',
      delta: 'x'.repeat(200_000),
    });
    let pendingTimeout: ReturnType<typeof setTimeout> | undefined;
    const pendingResult = await Promise.race([
      overBudgetPending,
      new Promise<'still-pending'>((resolve) => {
        pendingTimeout = setTimeout(() => resolve('still-pending'), 100);
      }),
    ]);
    if (pendingTimeout) clearTimeout(pendingTimeout);
    expect(pendingResult).toBe('unavailable');
    const queued = Array.from({ length: 8 }, (_, index) =>
      streams.publish(claim, {
        version: 1,
        runId: claim.runId,
        type: 'text-delta',
        id: 'old',
        delta: `old queued ${index}`,
      }),
    );
    let oversizedInputVisited = false;
    const saturatedEvent = {
      version: 1 as const,
      runId: claim.runId,
      type: 'tool-input-available' as const,
      toolCallId: 'saturated',
      toolName: 'updateDocument',
      operationId: randomUUID(),
      get input() {
        oversizedInputVisited = true;
        return { text: 'x'.repeat(1_000_000) };
      },
    };
    await expect(streams.publish(claim, saturatedEvent as never)).resolves.toBe(
      'unavailable',
    );
    expect(oversizedInputVisited).toBe(false);
    const recovery = streams.recover(claim, {
      version: 1,
      runId: claim.runId,
      type: 'reset',
      sequence: 1,
    });
    const fresh = streams.publish(claim, {
      version: 1,
      runId: claim.runId,
      type: 'text-delta',
      id: 'fresh',
      delta: 'fresh after reset',
    });
    releaseProof();
    await expect(first).resolves.toBe('stale');
    const queuedResults = await Promise.all(queued);
    expect(queuedResults).toEqual(Array(8).fill('unavailable'));
    await recovery;
    await expect(fresh).resolves.toBe('written');
    const entries = await redis.xrange(
      `${testPrefix}:{run-streams}:${claim.runId}:events`,
      '-',
      '+',
    );
    expect(entries.map((entry) => JSON.parse(entry[1][1]!))).toEqual([
      { version: 1, runId: claim.runId, type: 'reset', sequence: 1 },
      {
        version: 1,
        runId: claim.runId,
        type: 'text-delta',
        id: 'fresh',
        delta: 'fresh after reset',
      },
    ]);
  } finally {
    releaseProof();
    redis.disconnect();
    await streams.close();
  }
});

test('pending structured output publishes the bounded input snapshot', async ({
  services,
}) => {
  const testPrefix = `${services.queuePrefix}_snapshot_${randomUUID().slice(0, 6)}`;
  const claim: StepClaim = {
    runId: randomUUID(),
    orgId: randomUUID(),
    userId: randomUUID(),
    stepId: randomUUID(),
    sequence: 1,
    expectedVersion: 1,
    fence: 1,
    leaseUntil: new Date(Date.now() + 30_000),
  };
  let releaseProof!: () => void;
  let proofReady!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseProof = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    proofReady = resolve;
  });
  let pause = true;
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: testPrefix,
    authority: {
      authorizeActive: async (candidate) => {
        if (pause) {
          pause = false;
          proofReady();
          await release;
        }
        return {
          runVersion: candidate.expectedVersion,
          nextSequence: candidate.sequence,
          status: 'running',
          stepId: candidate.stepId,
          sequence: candidate.sequence,
          expectedVersion: candidate.expectedVersion,
          fence: candidate.fence,
          leaseUntil: new Date(Date.now() + 30_000),
        };
      },
      authorizeTerminal: async () => undefined,
      reconcile: async (entries) =>
        entries.map(({ runId }) => ({ runId, state: 'active' as const })),
    },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  try {
    const first = streams.publish(claim, {
      version: 1,
      runId: claim.runId,
      type: 'status',
      status: 'running',
    });
    await ready;
    const input = { title: 'bounded snapshot' };
    const pending = streams.publish(claim, {
      version: 1,
      runId: claim.runId,
      type: 'tool-input-available',
      toolCallId: 'snapshot-call',
      toolName: 'updateDocument',
      operationId: randomUUID(),
      input,
    });
    input.title = 'mutated after publish';
    releaseProof();
    await expect(first).resolves.toBe('written');
    await expect(pending).resolves.toBe('written');
    const entries = await redis.xrange(
      `${testPrefix}:{run-streams}:${claim.runId}:events`,
      '-',
      '+',
    );
    expect(JSON.parse(entries[1]![1][1]!)).toMatchObject({
      type: 'tool-input-available',
      input: { title: 'bounded snapshot' },
    });
  } finally {
    releaseProof();
    redis.disconnect();
    await streams.close();
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

test('a timed-out authorization cannot recreate a stream after it is released', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const steps = new AiStepRepository();
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
  const originalTime = Redis.prototype.time;
  let rejectProbeTime = false;
  let probeReachedTime!: () => void;
  const probeTimeReached = new Promise<void>((resolve) => {
    probeReachedTime = resolve;
  });
  const timeSpy = vi
    .spyOn(Redis.prototype, 'time')
    .mockImplementation(function (this: Redis) {
      if (rejectProbeTime) {
        rejectProbeTime = false;
        probeReachedTime();
        return Promise.reject(new Error('Reject only the drain probe TIME'));
      }
      return originalTime.call(this);
    });
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
    await expect(pendingPublish).resolves.toBe('unavailable');
    release();
    rejectProbeTime = true;
    const drainProbe = staleWriter.publish(oldClaim, {
      version: 1,
      runId: original.id,
      type: 'status',
      status: 'running',
    });
    await probeTimeReached;
    await expect(drainProbe).resolves.toBe('unavailable');
    const prefix = `${services.queuePrefix}:{run-streams}`;
    expect(await redis.exists(`${prefix}:${original.id}:events`)).toBe(0);
    expect(await redis.exists(`${prefix}:${original.id}:guard`)).toBe(0);
    expect(await redis.zscore(`${prefix}:active`, original.id)).toBeNull();
    expect(
      (await redis.zrange(`${prefix}:terminal`, '0', '-1')).some((member) =>
        member.startsWith(`${original.id}|`),
      ),
    ).toBe(false);
  } finally {
    release();
    timeSpy.mockRestore();
    redis.disconnect();
    await staleWriter.close();
    await streams.close();
    await ai.close();
  }
});

test('a stale authorization cannot recreate a stream evicted from the terminal pool', async ({
  services,
}) => {
  const prefix = `${services.queuePrefix}_stale_${randomUUID().slice(0, 6)}`;
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
  const proof = (claim: StepClaim) => ({
    runVersion: claim.expectedVersion,
    nextSequence: claim.sequence,
    status: 'running' as const,
    stepId: claim.stepId,
    sequence: claim.sequence,
    expectedVersion: claim.expectedVersion,
    fence: claim.fence,
    leaseUntil: new Date(Date.now() + 30_000),
  });
  const terminalRuns = new Set<string>();
  const authority = {
    authorizeActive: async (claim: StepClaim) =>
      terminalRuns.has(claim.runId) ? undefined : proof(claim),
    authorizeTerminal: async (claim: StepClaim) => ({
      status: 'completed' as const,
      runVersion: claim.expectedVersion + 1,
      nextSequence: claim.sequence + 1,
      latestCommittedStepId: claim.stepId,
      latestCommittedSequence: claim.sequence,
      latestCommittedExpectedVersion: claim.expectedVersion,
      latestCommittedFence: claim.fence,
    }),
    reconcile: async (entries: readonly { runId: string }[]) =>
      entries.map(({ runId }) => ({ runId, state: 'active' as const })),
  };
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix,
    authority,
  });
  let capturedProof: ReturnType<typeof proof> | undefined;
  let proofReads = 0;
  const staleWriter = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix,
    authority: {
      ...authority,
      authorizeActive: async (claim) => {
        proofReads++;
        if (proofReads <= 2) return capturedProof;
        return authority.authorizeActive(claim);
      },
    },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const oldClaim = makeClaim();
  const epochKey = `${prefix}:{run-streams}:epoch`;
  const originalGet = Redis.prototype.get;
  const originalEval = Redis.prototype.eval;
  let capturedEpoch: string | null = null;
  let injectCapturedEpoch = false;
  let capturePrepare = false;
  const prepareResults: number[] = [];
  const epochSpy = vi
    .spyOn(Redis.prototype, 'get')
    .mockImplementation(function (this: Redis, key) {
      if (injectCapturedEpoch && key === epochKey) {
        injectCapturedEpoch = false;
        return Promise.resolve(capturedEpoch);
      }
      return originalGet.call(this, key);
    });
  const evalSpy = vi
    .spyOn(Redis.prototype, 'eval')
    .mockImplementation(async function (this: Redis, ...args: unknown[]) {
      const result = await originalEval.apply(this, args as never);
      if (capturePrepare && args[0] === PREPARE_RUN_STREAM)
        prepareResults.push(Number(result));
      return result;
    } as never);
  const running = (claim: StepClaim) =>
    streams.publish(claim, {
      version: 1,
      runId: claim.runId,
      type: 'status',
      status: 'running',
    });
  const finish = async (claim: StepClaim) => {
    await streams.finish(claim, {
      version: 1,
      runId: claim.runId,
      type: 'finish',
    });
    terminalRuns.add(claim.runId);
  };
  try {
    await expect(running(oldClaim)).resolves.toBe('written');
    capturedEpoch = await redis.get(epochKey);
    capturedProof = await authority.authorizeActive(oldClaim);
    expect(capturedEpoch).not.toBeNull();
    expect(capturedProof).toBeDefined();
    await finish(oldClaim);
    for (let index = 0; index < 6; index++) {
      const claim = makeClaim();
      await expect(running(claim)).resolves.toBe('written');
      await finish(claim);
    }
    expect(await redis.get(epochKey)).not.toBe(capturedEpoch);
    injectCapturedEpoch = true;
    capturePrepare = true;
    const stalePublish = staleWriter.publish(oldClaim, {
      version: 1,
      runId: oldClaim.runId,
      type: 'text-delta',
      id: 'late',
      delta: 'late after eviction',
    });
    await expect(stalePublish).resolves.toBe('stale');
    expect(proofReads).toBe(3);
    expect(injectCapturedEpoch).toBe(false);
    expect(prepareResults).toEqual([-1]);
    const streamPrefix = `${prefix}:{run-streams}`;
    expect(await redis.exists(`${streamPrefix}:${oldClaim.runId}:events`)).toBe(
      0,
    );
    expect(await redis.exists(`${streamPrefix}:${oldClaim.runId}:guard`)).toBe(
      0,
    );
  } finally {
    evalSpy.mockRestore();
    epochSpy.mockRestore();
    redis.disconnect();
    await staleWriter.close();
    await streams.close();
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
