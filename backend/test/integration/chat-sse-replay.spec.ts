import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { SseStreamReader } from '../../src/infrastructure/queue/sse-stream-reader.js';
import {
  StreamHub,
  type SseFrame,
} from '../../src/infrastructure/queue/stream-hub.js';

test('replay and live delivery serialize writes through the replay boundary', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  let releaseDrain!: () => void;
  const drainGate = new Promise<boolean>((resolve) => {
    releaseDrain = () => resolve(true);
  });
  let activeWrites = 0;
  let maxConcurrentWrites = 0;
  const frames: SseFrame[] = [];
  let notifyWrite!: () => void;
  const wroteOnce = new Promise<void>((resolve) => {
    notifyWrite = resolve;
  });
  let firstWrite = true;
  const sink = {
    write(frame: SseFrame) {
      activeWrites++;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      frames.push(frame);
      if (firstWrite) {
        firstWrite = false;
        notifyWrite();
      }
      return false;
    },
    async drain() {
      await drainGate;
      activeWrites--;
      return true;
    },
    async close() {},
  };
  let subscription: { close(): Promise<void> } | undefined;
  try {
    const opening = hub.subscribe(key, '0-0', sink);
    await wroteOnce;
    const firstId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'one' }),
    );
    await redis.xadd(key, '*', 'event', JSON.stringify({ type: 'two' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(maxConcurrentWrites).toBe(1);
    releaseDrain();
    subscription = await opening;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      frames.filter((frame) => frame.id).map((frame) => frame.data),
    ).toEqual([
      JSON.stringify({ type: 'one' }),
      JSON.stringify({ type: 'two' }),
    ]);
    expect(frames.filter((frame) => frame.id).map((frame) => frame.id)).toEqual(
      expect.arrayContaining([firstId]),
    );
  } finally {
    releaseDrain();
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('shared reader keeps a monotonic live cursor and reconnects after all clients leave', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const firstFrames: SseFrame[] = [];
  const secondFrames: SseFrame[] = [];
  const thirdFrames: SseFrame[] = [];
  const sink = (frames: SseFrame[]) => ({
    write(frame: SseFrame) {
      frames.push(frame);
      return true;
    },
    async drain() {
      return true;
    },
    async close() {},
  });
  let first: { close(): Promise<void> } | undefined;
  let second: { close(): Promise<void> } | undefined;
  let third: { close(): Promise<void> } | undefined;
  try {
    const generation = 1;
    await redis.set(key.replace(/:events$/, ':generation'), String(generation));
    const oldId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'old' }),
      'generation',
      String(generation),
    );
    if (!oldId) throw new Error('Valkey did not return an XADD cursor');
    first = await hub.subscribe(key, undefined, sink(firstFrames));
    second = await hub.subscribe(key, undefined, sink(secondFrames));
    const nextId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'next' }),
      'generation',
      String(generation),
    );
    if (!nextId) throw new Error('Valkey did not return an XADD cursor');
    await waitFor(
      () =>
        firstFrames.some((frame) => frame.id === `${generation}:${oldId}`) &&
        firstFrames.some((frame) => frame.id === `${generation}:${nextId}`) &&
        secondFrames.some((frame) => frame.id === `${generation}:${oldId}`) &&
        secondFrames.some((frame) => frame.id === `${generation}:${nextId}`),
    );
    expect(
      firstFrames.filter((frame) => frame.id).map((frame) => frame.id),
    ).toEqual([`${generation}:${oldId}`, `${generation}:${nextId}`]);
    expect(
      secondFrames.filter((frame) => frame.id).map((frame) => frame.id),
    ).toEqual([`${generation}:${oldId}`, `${generation}:${nextId}`]);

    await first.close();
    await second.close();
    first = undefined;
    second = undefined;
    // Let the blocking XREAD return and the idle connection close.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await reader.latest(key)).toBe(nextId);
    third = await hub.subscribe(
      key,
      `${generation}:${nextId}`,
      sink(thirdFrames),
    );
    const lastId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'last' }),
      'generation',
      String(generation),
    );
    if (!lastId) throw new Error('Valkey did not return an XADD cursor');
    await waitFor(() =>
      thirdFrames.some((frame) => frame.id === `${generation}:${lastId}`),
    );
    expect(
      thirdFrames.filter((frame) => frame.id).map((frame) => frame.id),
    ).toEqual([`${generation}:${lastId}`]);
  } finally {
    await first?.close();
    await second?.close();
    await third?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('a new replay subscriber does not skip an entry for an existing live subscriber', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generation = 5;
  const firstFrames: SseFrame[] = [];
  const secondFrames: SseFrame[] = [];
  const sink = (frames: SseFrame[]) => ({
    write(frame: SseFrame) {
      frames.push(frame);
      return true;
    },
    async drain() {
      return true;
    },
    async close() {},
  });
  let reachedPostRead!: () => void;
  let releasePostRead!: () => void;
  const postRead = new Promise<void>((resolve) => {
    reachedPostRead = resolve;
  });
  const readGate = new Promise<void>((resolve) => {
    releasePostRead = resolve;
  });
  let mgetCount = 0;
  const originalMget = Redis.prototype.mget;
  const mgetSpy = vi
    .spyOn(Redis.prototype, 'mget')
    .mockImplementation(async function (this: Redis, ...keys: string[]) {
      mgetCount++;
      if (mgetCount === 2) {
        reachedPostRead();
        await readGate;
      }
      return originalMget.call(this, keys);
    } as never);
  let first: { close(): Promise<void> } | undefined;
  let second: { close(): Promise<void> } | undefined;
  try {
    await redis.set(key.replace(/:events$/, ':generation'), String(generation));
    first = await hub.subscribe(key, undefined, sink(firstFrames));
    await waitFor(() =>
      firstFrames.some((frame) => frame.data.startsWith(': connected')),
    );
    const id = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'barrier delta' }),
      'generation',
      String(generation),
    );
    if (!id) throw new Error('Valkey did not return an XADD cursor');
    await postRead;
    second = await hub.subscribe(key, undefined, sink(secondFrames));
    expect(
      secondFrames.filter((frame) => frame.data.includes('barrier delta')),
    ).toHaveLength(1);
    releasePostRead();
    await waitFor(() =>
      firstFrames.some((frame) => frame.id === `${generation}:${id}`),
    );
    expect(
      firstFrames.filter((frame) => frame.id === `${generation}:${id}`),
    ).toHaveLength(1);
    expect(
      secondFrames.filter((frame) => frame.id === `${generation}:${id}`),
    ).toHaveLength(1);
  } finally {
    releasePostRead();
    mgetSpy.mockRestore();
    await first?.close();
    await second?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('trimmed cursors produce reset instead of replaying an incompatible retained suffix', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const frames: SseFrame[] = [];
  const sink = {
    write(frame: SseFrame) {
      frames.push(frame);
      return true;
    },
    async drain() {
      return true;
    },
    async close() {},
  };
  let subscription: { close(): Promise<void> } | undefined;
  try {
    const oldId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'old' }),
    );
    if (!oldId) throw new Error('Valkey did not return an XADD cursor');
    await redis.xadd(key, '*', 'event', JSON.stringify({ type: 'new' }));
    await redis.xtrim(key, 'MAXLEN', '=', 1);
    subscription = await hub.subscribe(key, oldId, sink);
    expect(
      frames
        .filter((frame) => !frame.id)
        .some((frame) => frame.data.includes('"type":"snapshot-reset"')),
    ).toBe(true);
    expect(frames.filter((frame) => frame.id)).toEqual([]);
  } finally {
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('Last-Event-ID carries the durable incarnation and the actual XADD cursor', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generation = 37;
  const frames: SseFrame[] = [];
  const sink = {
    write(frame: SseFrame) {
      frames.push(frame);
      return true;
    },
    async drain() {
      return true;
    },
    async close() {},
  };
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.set(key.replace(/:events$/, ':generation'), String(generation));
    const id = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'cursor' }),
      'generation',
      String(generation),
    );
    if (!id) throw new Error('Valkey did not return an XADD cursor');
    subscription = await hub.subscribe(key, undefined, sink);
    expect(
      frames.find((frame) => frame.data.includes('"delta":"cursor"'))?.id,
    ).toBe(`${generation}:${id}`);
  } finally {
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('an open subscriber resets and adopts a replacement Valkey lineage before live suffix', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
  const frames: SseFrame[] = [];
  const runId = randomUUID();
  let replacementCursor: string | undefined;
  const fallback = (streamGeneration: number, cursor?: string) => ({
    streamGeneration,
    snapshot: {
      runId,
      messageId: runId,
      attemptId: cursor ? runId : null,
      generation: cursor ? streamGeneration : null,
      revision: cursor ? 1 : 0,
      eventId: cursor ?? null,
      parts: [],
      operations: [],
      status: 'running' as const,
      errorCode: null,
      reasoningDurationMs: null,
    },
    reload: async () => fallback(2, replacementCursor),
  });
  const sink = {
    write(frame: SseFrame) {
      frames.push(frame);
      return true;
    },
    async drain() {
      return true;
    },
    async close() {},
  };
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.set(generationKey, '1');
    const oldLineageId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'status', status: 'running' }),
      'generation',
      '1',
    );
    if (!oldLineageId) throw new Error('Valkey did not return an XADD cursor');
    subscription = await hub.subscribe(key, undefined, sink, fallback(1));
    await redis.del(key, generationKey);
    await redis.set(generationKey, '2');
    const replacementId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'status', status: 'running' }),
      'generation',
      '2',
    );
    if (!replacementId) throw new Error('Valkey did not return an XADD cursor');
    await waitFor(
      () =>
        frames.filter((frame) => frame.data.includes('"type":"snapshot-start"'))
          .length >= 2,
    );
    expect(frames.some((frame) => frame.id === `2:${replacementId}`)).toBe(
      false,
    );
    replacementCursor = replacementId;
    await waitFor(
      () =>
        frames.filter((frame) => frame.data.includes('"type":"snapshot-start"'))
          .length >= 3,
    );
    const suffixId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'new lineage suffix' }),
      'generation',
      '2',
    );
    if (!suffixId) throw new Error('Valkey did not return an XADD cursor');
    await waitFor(() => frames.some((frame) => frame.id === `2:${suffixId}`));
    expect(
      frames.filter((frame) => frame.id?.startsWith('2:')).at(-1)?.data,
    ).toContain('new lineage suffix');
  } finally {
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('replacement between XREAD and lineage read never relabels old entries', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
  const frames: SseFrame[] = [];
  const runId = randomUUID();
  let replacementCursor: string | undefined;
  const fallback = (streamGeneration: number, cursor?: string) => ({
    streamGeneration,
    snapshot: {
      runId,
      messageId: runId,
      attemptId: cursor ? runId : null,
      generation: cursor ? streamGeneration : null,
      revision: cursor ? 1 : 0,
      eventId: cursor ?? null,
      parts: cursor
        ? [{ type: 'text' as const, id: runId, text: 'new lineage canary' }]
        : [],
      operations: [],
      status: 'running' as const,
      errorCode: null,
      reasoningDurationMs: null,
    },
    reload: async () => fallback(2, replacementCursor),
  });
  const sink = {
    write(frame: SseFrame) {
      frames.push(frame);
      return true;
    },
    async drain() {
      return true;
    },
    async close() {},
  };
  let reachedLineageRead!: () => void;
  let releaseLineageRead!: () => void;
  const lineageRead = new Promise<void>((resolve) => {
    reachedLineageRead = resolve;
  });
  const lineageGate = new Promise<void>((resolve) => {
    releaseLineageRead = resolve;
  });
  let reads = 0;
  const originalMget = Redis.prototype.mget;
  const mgetSpy = vi
    .spyOn(Redis.prototype, 'mget')
    .mockImplementation(async function (this: Redis, ...keys: string[]) {
      reads++;
      if (reads === 2) {
        reachedLineageRead();
        await lineageGate;
      }
      return originalMget.call(this, keys);
    } as never);
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.set(generationKey, '1');
    subscription = await hub.subscribe(key, undefined, sink, fallback(1));
    await waitFor(() =>
      frames.some((frame) => frame.data.includes('"type":"snapshot-start"')),
    );
    const oldId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'old lineage canary' }),
      'generation',
      '1',
    );
    if (!oldId) throw new Error('Valkey did not return an XADD cursor');
    await lineageRead;
    await redis.del(key, generationKey);
    await redis.set(generationKey, '2');
    const replacedId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'new lineage canary' }),
      'generation',
      '2',
    );
    if (!replacedId) throw new Error('Valkey did not return an XADD cursor');
    releaseLineageRead();
    await waitFor(
      () =>
        frames.filter((frame) => frame.data.includes('"type":"snapshot-start"'))
          .length >= 2,
    );
    expect(
      frames.some(
        (frame) =>
          frame.id?.startsWith('2:') &&
          frame.data.includes('old lineage canary'),
      ),
    ).toBe(false);
    expect(frames.some((frame) => frame.id === `2:${replacedId}`)).toBe(false);
    replacementCursor = replacedId;
    await waitFor(
      () =>
        frames.filter((frame) => frame.data.includes('"type":"snapshot-start"'))
          .length >= 3,
    );
    expect(
      frames
        .filter((frame) => frame.data.includes('"type":"snapshot-part"'))
        .some((frame) => frame.data.includes('new lineage canary')),
    ).toBe(true);
    const suffixId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'suffix' }),
      'generation',
      '2',
    );
    if (!suffixId) throw new Error('Valkey did not return an XADD cursor');
    await waitFor(() => frames.some((frame) => frame.id === `2:${suffixId}`));
    expect(frames.some((frame) => frame.id === `2:${replacedId}`)).toBe(false);
  } finally {
    releaseLineageRead();
    mgetSpy.mockRestore();
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('large PG fallback snapshots are chunked into frames within the subscriber bound', async ({
  services,
}) => {
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const frames: SseFrame[] = [];
  let maximumFrameBytes = 0;
  const sink = {
    write(frame: SseFrame) {
      const bytes = serializedSseFrameBytes(frame);
      maximumFrameBytes = Math.max(maximumFrameBytes, bytes);
      frames.push(frame);
      return true;
    },
    async drain() {
      return true;
    },
    async close() {},
  };
  const answer = 'a'.repeat(262_144);
  const summary = 's'.repeat(16_384);
  let eventLoopTicks = 0;
  let expectedProbeTime = Date.now() + 10;
  let maximumEventLoopLagMs = 0;
  const eventLoopProbe = setInterval(() => {
    const now = Date.now();
    eventLoopTicks++;
    maximumEventLoopLagMs = Math.max(
      maximumEventLoopLagMs,
      now - expectedProbeTime,
    );
    expectedProbeTime = now + 10;
  }, 10);
  const runId = randomUUID();
  let subscription: { close(): Promise<void> } | undefined;
  try {
    subscription = await hub.subscribe(key, undefined, sink, {
      streamGeneration: 0,
      snapshot: {
        runId,
        messageId: runId,
        attemptId: null,
        generation: null,
        revision: 0,
        eventId: null,
        parts: [
          { type: 'text', id: runId, text: answer },
          { type: 'reasoning', id: runId, text: summary },
        ],
        operations: [],
        status: 'running',
        errorCode: null,
        reasoningDurationMs: null,
      },
    });
    expect(eventLoopTicks).toBeGreaterThan(0);
    expect(maximumEventLoopLagMs).toBeLessThan(250);
    expect(maximumFrameBytes).toBeLessThan(65_536);
    const parts = frames
      .filter((frame) => frame.data.includes('"type":"snapshot-part"'))
      .map(
        (frame) =>
          JSON.parse(frame.data) as { partIndex: number; text: string },
      );
    expect(
      parts
        .filter((part) => part.partIndex === 0)
        .map((part) => part.text)
        .join(''),
    ).toBe(answer);
    expect(
      parts
        .filter((part) => part.partIndex === 1)
        .map((part) => part.text)
        .join(''),
    ).toBe(summary);
    expect(
      frames.some(
        (frame) =>
          frame.data.includes('"type":"snapshot-start"') &&
          frame.data.includes('"reset":true'),
      ),
    ).toBe(true);
    expect(
      frames.some((frame) => frame.data.includes('"type":"snapshot-end"')),
    ).toBe(true);
  } finally {
    clearInterval(eventLoopProbe);
    await subscription?.close();
    await hub.close();
  }
});

test('snapshot chunks stay within 64 KiB after JSON escaping control characters', async ({
  services,
}) => {
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const frames: SseFrame[] = [];
  let closeReason: string | undefined;
  const text = '\u0001'.repeat(20_000);
  const runId = randomUUID();
  const subscription = await hub.subscribe(
    key,
    undefined,
    {
      write(frame) {
        frames.push(frame);
        return true;
      },
      async drain() {
        return true;
      },
      async close(reason) {
        closeReason = reason;
      },
    },
    {
      streamGeneration: 0,
      snapshot: {
        runId,
        messageId: runId,
        attemptId: null,
        generation: null,
        revision: 0,
        eventId: null,
        parts: [{ type: 'text', id: runId, text }],
        operations: [],
        status: 'running',
        errorCode: null,
        reasoningDurationMs: null,
      },
    },
  );
  try {
    expect(closeReason).toBeUndefined();
    expect(Math.max(...frames.map(serializedSseFrameBytes))).toBeLessThan(
      65_536,
    );
    expect(
      frames
        .filter((frame) => frame.data.includes('"type":"snapshot-part"'))
        .map((frame) => JSON.parse(frame.data) as { text: string })
        .map((frame) => frame.text)
        .join(''),
    ).toBe(text);
  } finally {
    await subscription.close();
    await hub.close();
  }
});

test('nonresumable snapshots hold unknown entries until PG provides a compatible cursor', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
  const runId = randomUUID();
  const attemptId = randomUUID();
  const frames: SseFrame[] = [];
  let snapshotText = 'old committed text';
  let snapshotCursor: string | null = null;
  let snapshotRevision = 0;
  const makeSnapshot = () => ({
    runId,
    messageId: runId,
    attemptId,
    generation: snapshotCursor ? 1 : null,
    revision: snapshotRevision,
    eventId: snapshotCursor,
    parts: [{ type: 'text' as const, id: runId, text: snapshotText }],
    operations: [],
    status: 'running' as const,
    errorCode: null,
    reasoningDurationMs: null,
  });
  const fallback = {
    streamGeneration: 1,
    snapshot: makeSnapshot(),
    reload: async () => ({
      streamGeneration: 1,
      snapshot: makeSnapshot(),
      reload: fallback.reload,
    }),
  };
  let checkpointedId = '';
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.set(generationKey, '1');
    checkpointedId =
      (await redis.xadd(
        key,
        '*',
        'event',
        JSON.stringify({ type: 'text-delta', delta: ' checkpointed' }),
        'generation',
        '1',
      )) ?? '';
    if (!checkpointedId)
      throw new Error('Valkey did not return an XADD cursor');
    subscription = await hub.subscribe(
      key,
      undefined,
      {
        write(frame) {
          frames.push(frame);
          return true;
        },
        async drain() {
          return true;
        },
        async close() {},
      },
      fallback,
    );
    await waitFor(() =>
      frames.some((frame) => frame.data.includes('"type":"snapshot-end"')),
    );
    expect(frames.some((frame) => frame.id === `1:${checkpointedId}`)).toBe(
      false,
    );
    snapshotText = 'old committed text checkpointed';
    snapshotCursor = checkpointedId;
    snapshotRevision = 1;
    await waitFor(
      () =>
        frames.filter((frame) => frame.data.includes('"type":"snapshot-start"'))
          .length >= 2,
    );
    const latestSnapshotStart = frames.findLastIndex((frame) =>
      frame.data.includes('"type":"snapshot-start"'),
    );
    const recoveredParts = frames
      .slice(latestSnapshotStart + 1)
      .filter((frame) => frame.data.includes('"type":"snapshot-part"'))
      .map((frame) => JSON.parse(frame.data) as { text: string });
    expect(recoveredParts.map((part) => part.text).join('')).toBe(
      'old committed text checkpointed',
    );
    const suffixId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: ' suffix' }),
      'generation',
      '1',
    );
    if (!suffixId) throw new Error('Valkey did not return an XADD cursor');
    await waitFor(() => frames.some((frame) => frame.id === `1:${suffixId}`));
    expect(frames.filter((frame) => frame.id === `1:${suffixId}`)).toHaveLength(
      1,
    );
    snapshotText = 'old committed text checkpointed';
    snapshotCursor = null;
    snapshotRevision = 1;
    const resetId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ version: 1, runId, type: 'reset', sequence: 2 }),
      'generation',
      '1',
    );
    if (!resetId) throw new Error('Valkey did not return an XADD cursor');
    await waitFor(
      () =>
        frames.filter((frame) => frame.data.includes('"type":"snapshot-start"'))
          .length >= 3,
    );
    expect(frames.some((frame) => frame.id === `1:${resetId}`)).toBe(false);
    snapshotCursor = resetId;
    const postResetSuffixId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: ' suffix' }),
      'generation',
      '1',
    );
    if (!postResetSuffixId)
      throw new Error('Valkey did not return an XADD cursor');
    await waitFor(() =>
      frames.some((frame) => frame.id === `1:${postResetSuffixId}`),
    );
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(
      frames.filter((frame) => frame.id === `1:${postResetSuffixId}`),
    ).toHaveLength(1);
    const liveId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: ' still live' }),
      'generation',
      '1',
    );
    if (!liveId) throw new Error('Valkey did not return an XADD cursor');
    await waitFor(() => frames.some((frame) => frame.id === `1:${liveId}`));
    expect(frames.filter((frame) => frame.id === `1:${liveId}`)).toHaveLength(
      1,
    );
  } finally {
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('reset snapshots emit every safe committed operation before snapshot-end', async ({
  services,
}) => {
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const runId = randomUUID();
  const operations = Array.from({ length: 15 }, (_, index) => ({
    operationId: randomUUID(),
    status: index < 7 ? ('awaiting_approval' as const) : ('completed' as const),
    approvalRequired: index < 7,
  }));
  const frames: SseFrame[] = [];
  const subscription = await hub.subscribe(
    key,
    undefined,
    {
      write(frame) {
        frames.push(frame);
        return true;
      },
      async drain() {
        return true;
      },
      async close() {},
    },
    {
      streamGeneration: 0,
      snapshot: {
        runId,
        messageId: runId,
        attemptId: null,
        generation: null,
        revision: 0,
        eventId: null,
        parts: [],
        operations,
        status: 'awaiting_approval',
        errorCode: null,
        reasoningDurationMs: null,
      },
    },
  );
  try {
    const decoded = frames
      .filter((frame) => frame.data.startsWith('{'))
      .map((frame) => JSON.parse(frame.data) as Record<string, unknown>);
    expect(decoded[0]).toMatchObject({
      type: 'snapshot-start',
      partCount: 0,
      operationCount: 15,
    });
    const operationFrames = decoded.filter(
      (frame) => frame.type === 'snapshot-operation',
    );
    expect(operationFrames).toHaveLength(15);
    expect(operationFrames.map((frame) => frame.index)).toEqual(
      Array.from({ length: 15 }, (_, index) => index),
    );
    expect(operationFrames.map((frame) => frame.operation)).toEqual(operations);
    expect(decoded.at(-1)).toMatchObject({
      type: 'snapshot-end',
      partCount: 0,
      operationCount: 15,
    });
    expect(
      decoded
        .slice(1, -1)
        .every((frame) => frame.type === 'snapshot-operation'),
    ).toBe(true);
    expect(
      frames.every((frame) => Buffer.byteLength(frame.data) < 65_536),
    ).toBe(true);
  } finally {
    await subscription.close();
    await hub.close();
  }
});

test('live overflow closes a slow subscriber before its queued frames exceed 64 KiB', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  let closeReason: string | undefined;
  let releaseDrain!: (value: boolean) => void;
  const drainGate = new Promise<boolean>((resolve) => {
    releaseDrain = resolve;
  });
  const sink = {
    write(frame: SseFrame) {
      return frame.data.startsWith(': connected');
    },
    async drain() {
      return drainGate;
    },
    async close(reason?: string) {
      closeReason = reason;
      releaseDrain(false);
    },
  };
  let subscription: { close(): Promise<void> } | undefined;
  try {
    subscription = await hub.subscribe(key, undefined, sink);
    const body = 'x'.repeat(12_000);
    for (let index = 0; index < 8; index++) {
      await redis.xadd(
        key,
        '*',
        'event',
        JSON.stringify({ type: 'text-delta', delta: body }),
      );
    }
    await waitFor(() => closeReason === 'slow-client');
    expect(closeReason).toBe('slow-client');
  } finally {
    releaseDrain(false);
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('replay buffering accounts for the UTF-8 SSE frame bytes before the replay boundary', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  let closeReason: string | undefined;
  let releaseRange!: () => void;
  let rangeEntered!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseRange = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    rangeEntered = resolve;
  });
  const originalRange = reader.range.bind(reader);
  const rangeSpy = vi
    .spyOn(reader, 'range')
    .mockImplementation(async (...args) => {
      rangeEntered();
      await gate;
      return originalRange(...args);
    });
  let opening: Promise<{ close(): Promise<void> }> | undefined;
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.xadd(key, '*', 'event', JSON.stringify({ type: 'seed' }));
    opening = hub.subscribe(key, undefined, {
      write() {
        return true;
      },
      async drain() {
        return true;
      },
      async close(reason) {
        closeReason = reason;
      },
    });
    await entered;
    const delta = '😀'.repeat(9_000);
    for (let index = 0; index < 2; index++)
      await redis.xadd(
        key,
        '*',
        'event',
        JSON.stringify({ type: 'text-delta', delta }),
      );
    await waitFor(() => closeReason === 'slow-client');
    expect(closeReason).toBe('slow-client');
  } finally {
    releaseRange();
    rangeSpy.mockRestore();
    subscription = await opening;
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for SSE frame');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function serializedSseFrameBytes(frame: SseFrame): number {
  return Buffer.byteLength(
    `${frame.id ? `id: ${frame.id}\n` : ''}data: ${frame.data}\n\n`,
    'utf8',
  );
}
