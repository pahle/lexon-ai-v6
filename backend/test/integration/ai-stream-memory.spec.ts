import { expect } from 'vitest';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { test } from '../setup/file-services.js';
import {
  RunStreams,
  RUN_STREAM_LIMITS,
} from '../../src/infrastructure/queue/index.js';
import type { StepClaim } from '../../src/infrastructure/db/index.js';

function varyingText(seed: number, length: number): string {
  const alphabet =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let state = seed >>> 0;
  let value = '';
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    value += alphabet[state % alphabet.length];
  }
  return value;
}

function makeClaim(): StepClaim {
  return {
    runId: randomUUID(),
    orgId: randomUUID(),
    userId: randomUUID(),
    stepId: randomUUID(),
    sequence: 1,
    expectedVersion: 1,
    fence: 1,
    leaseUntil: new Date(Date.now() + 30_000),
  };
}

async function measureKeys(redis: Redis, keys: readonly string[]) {
  const sizes = await Promise.all(
    keys.map(async (key) =>
      Number((await redis.call('MEMORY', 'USAGE', key, 'SAMPLES', '0')) ?? 0),
    ),
  );
  return {
    sizes,
    totalBytes: sizes.reduce((sum, size) => sum + size, 0),
  };
}

test('active and retained terminal stream slots fit 6 MiB with full registries', async ({
  services,
}) => {
  const activeClaims = new Map<string, StepClaim>();
  const terminalClaims = new Map<string, StepClaim>();
  const primary = makeClaim();
  activeClaims.set(primary.runId, primary);
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: {
      authorizeActive: async (claim) =>
        activeClaims.has(claim.runId)
          ? {
              runVersion: claim.expectedVersion,
              nextSequence: claim.sequence,
              status: 'running',
              stepId: claim.stepId,
              sequence: claim.sequence,
              expectedVersion: claim.expectedVersion,
              fence: claim.fence,
              leaseUntil: new Date(Date.now() + 30_000),
            }
          : undefined,
      authorizeTerminal: async (claim) =>
        terminalClaims.has(claim.runId)
          ? {
              status: 'completed',
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
          const active = activeClaims.get(runId);
          if (active) return { runId, state: 'active' as const };
          const terminal = terminalClaims.get(runId);
          if (terminal)
            return { runId, state: 'terminal' as const, claim: terminal };
          return { runId, state: 'missing' as const };
        }),
    },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const prefix = `${services.queuePrefix}:{run-streams}`;
  const streamKey = `${prefix}:${primary.runId}:events`;
  const globalKeys = [
    `${prefix}:active`,
    `${prefix}:terminal`,
    `${prefix}:terminal-members`,
    `${prefix}:epoch`,
    `${prefix}:contexts`,
  ];
  const memoryKeys = [
    streamKey,
    `${prefix}:${primary.runId}:guard`,
    ...globalKeys,
  ];
  try {
    const empty = {
      version: 1 as const,
      runId: primary.runId,
      type: 'text-delta' as const,
      id: 'part',
      delta: '',
    };
    const length =
      RUN_STREAM_LIMITS.maxEventBytes -
      Buffer.byteLength(JSON.stringify(empty), 'utf8');
    for (let index = 0; index < RUN_STREAM_LIMITS.maxEntries + 1; index++) {
      const event = {
        ...empty,
        delta: varyingText(index + 1, length),
      };
      expect(Buffer.byteLength(JSON.stringify(event), 'utf8')).toBe(
        RUN_STREAM_LIMITS.maxEventBytes,
      );
      expect(await streams.publish(primary, event)).toBe('written');
    }
    expect(await redis.xlen(streamKey)).toBe(RUN_STREAM_LIMITS.maxEntries);

    const shortEvent = (claim: StepClaim) => ({
      version: 1 as const,
      runId: claim.runId,
      type: 'status' as const,
      status: 'running' as const,
    });
    for (let index = 0; index < 6; index++) {
      const claim = makeClaim();
      activeClaims.set(claim.runId, claim);
      expect(await streams.publish(claim, shortEvent(claim))).toBe('written');
      activeClaims.delete(claim.runId);
      terminalClaims.set(claim.runId, claim);
      await streams.finish(claim, {
        version: 1,
        runId: claim.runId,
        type: 'finish',
      });
    }
    for (let index = 0; index < 23; index++) {
      const claim = makeClaim();
      activeClaims.set(claim.runId, claim);
      expect(await streams.publish(claim, shortEvent(claim))).toBe('written');
    }
    expect(await redis.zcard(`${prefix}:active`)).toBe(24);
    expect(await redis.zcard(`${prefix}:terminal`)).toBe(6);
    expect(await redis.hlen(`${prefix}:contexts`)).toBe(30);
    expect(await redis.hlen(`${prefix}:terminal-members`)).toBe(6);

    const activeMeasurement = await measureKeys(redis, memoryKeys);
    process.stdout.write(
      `F3 active stream slot: ${activeMeasurement.totalBytes} bytes (${activeMeasurement.sizes.join(',')} per key)\n`,
    );
    expect(activeMeasurement.totalBytes).toBeLessThanOrEqual(
      RUN_STREAM_LIMITS.slotBytes,
    );

    activeClaims.delete(primary.runId);
    terminalClaims.set(primary.runId, primary);
    await streams.finish(primary, {
      version: 1,
      runId: primary.runId,
      type: 'finish',
    });
    const extraActive = makeClaim();
    activeClaims.set(extraActive.runId, extraActive);
    expect(await streams.publish(extraActive, shortEvent(extraActive))).toBe(
      'written',
    );
    expect(await redis.xlen(streamKey)).toBe(RUN_STREAM_LIMITS.maxEntries);
    expect(await redis.zcard(`${prefix}:active`)).toBe(24);
    expect(await redis.zcard(`${prefix}:terminal`)).toBe(6);
    expect(await redis.hlen(`${prefix}:contexts`)).toBe(30);
    const terminalMeasurement = await measureKeys(redis, memoryKeys);
    process.stdout.write(
      `F3 terminal stream slot: ${terminalMeasurement.totalBytes} bytes (${terminalMeasurement.sizes.join(',')} per key)\n`,
    );
    expect(terminalMeasurement.totalBytes).toBeLessThanOrEqual(
      RUN_STREAM_LIMITS.slotBytes,
    );
  } finally {
    redis.disconnect();
    await streams.close();
  }
});
