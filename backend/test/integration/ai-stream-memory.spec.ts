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

test('1024 maximum-sized varying events plus stream indexes fit the 6 MiB slot', async ({
  services,
}) => {
  const runId = randomUUID();
  const claim: StepClaim = {
    runId,
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
    prefix: services.queuePrefix,
    authority: {
      authorizeActive: async () => ({
        runVersion: 1,
        nextSequence: 1,
        status: 'running',
        stepId: claim.stepId,
        sequence: 1,
        expectedVersion: 1,
        fence: 1,
        leaseUntil: new Date(Date.now() + 30_000),
      }),
      authorizeTerminal: async () => ({
        status: 'completed',
        runVersion: 2,
        nextSequence: 2,
        latestCommittedStepId: claim.stepId,
        latestCommittedSequence: 1,
        latestCommittedExpectedVersion: 1,
        latestCommittedFence: 1,
      }),
      reconcile: async (entries) =>
        entries.map((entry) => ({
          runId: entry.runId,
          state: 'active' as const,
        })),
    },
  });
  const redis = new Redis(services.valkey.streamsUrl);
  const prefix = `${services.queuePrefix}:{run-streams}`;
  const streamKey = `${prefix}:${runId}:events`;
  try {
    const empty = {
      version: 1 as const,
      runId,
      type: 'text-delta' as const,
      id: 'part',
      delta: '',
    };
    const length =
      RUN_STREAM_LIMITS.maxEventBytes -
      Buffer.byteLength(JSON.stringify(empty), 'utf8');
    for (let index = 0; index < RUN_STREAM_LIMITS.maxEntries; index++) {
      const event = { ...empty, delta: varyingText(index + 1, length) };
      expect(Buffer.byteLength(JSON.stringify(event), 'utf8')).toBe(
        RUN_STREAM_LIMITS.maxEventBytes,
      );
      expect(await streams.publish(claim, event)).toBe('written');
    }
    const overflowEvent = { ...empty, delta: varyingText(1025, length) };
    expect(await streams.publish(claim, overflowEvent)).toBe('written');
    await streams.finish(claim, { version: 1, runId, type: 'finish' });
    expect(await redis.xlen(streamKey)).toBe(1024);
    const keys = [
      streamKey,
      `${prefix}:${runId}:guard`,
      `${prefix}:active`,
      `${prefix}:terminal`,
      `${prefix}:terminal-members`,
      `${prefix}:epoch`,
      `${prefix}:contexts`,
    ];
    const sizes = await Promise.all(
      keys.map(async (key) =>
        Number((await redis.call('MEMORY', 'USAGE', key, 'SAMPLES', '0')) ?? 0),
      ),
    );
    const totalRunSlotMemoryBytes = sizes.reduce((sum, size) => sum + size, 0);
    process.stdout.write(
      `F3 stream slot memory: ${totalRunSlotMemoryBytes} bytes (${sizes.join(',')} per key)\n`,
    );
    expect(await redis.zcard(`${prefix}:terminal`)).toBe(1);
    expect(totalRunSlotMemoryBytes).toBeLessThanOrEqual(
      RUN_STREAM_LIMITS.slotBytes,
    );
  } finally {
    redis.disconnect();
    await streams.close();
  }
});
