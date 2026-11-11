import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { ChatSnapshot } from '@lexon/contracts';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  SseStreamReader,
  type StreamEntry,
} from '../../src/infrastructure/queue/sse-stream-reader.js';
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

test('snapshot recovery replaces a valid client cursor with the PG checkpoint prefix', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const runId = randomUUID();
  const attemptId = randomUUID();
  const key = `${services.queuePrefix}:{run-streams}:${runId}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
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
    await redis.set(generationKey, '1');
    const checkpointId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({
        version: 1,
        runId,
        type: 'text-delta',
        id: 'a1',
        delta: 'replayed prefix',
      }),
      'generation',
      '1',
    );
    const suffixId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({
        version: 1,
        runId,
        type: 'text-delta',
        id: 'a1',
        delta: ' after checkpoint',
      }),
      'generation',
      '1',
    );
    const latestId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({
        version: 1,
        runId,
        type: 'text-delta',
        id: 'a1',
        delta: ' latest',
      }),
      'generation',
      '1',
    );
    if (!checkpointId || !suffixId || !latestId)
      throw new Error('Valkey did not return stream cursors');
    const fallback = {
      streamGeneration: 1,
      snapshot: {
        runId,
        messageId: runId,
        attemptId,
        generation: 1,
        revision: 1,
        eventId: checkpointId,
        parts: [
          { type: 'text' as const, id: 'a1', text: 'persisted checkpoint' },
        ],
        operations: [],
        status: 'running' as const,
        errorCode: null,
        reasoningDurationMs: null,
      },
    };

    subscription = await hub.subscribe(
      key,
      `1:${latestId}`,
      sink,
      fallback,
      'snapshot',
    );

    const start = frames.findIndex((frame) =>
      frame.data.includes('"type":"snapshot-start"'),
    );
    const end = frames.findIndex((frame) =>
      frame.data.includes('"type":"snapshot-end"'),
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(
      frames
        .slice(start + 1, end)
        .some((frame) => frame.data.includes('persisted checkpoint')),
    ).toBe(true);
    expect(frames.some((frame) => frame.data.includes('snapshot-reset'))).toBe(
      false,
    );
    expect(frames[end]?.id).toBe(`1:${checkpointId}`);
    expect(frames.slice(start, end).some((frame) => frame.id)).toBe(false);
    expect(
      frames
        .filter((frame, index) => index > end && frame.id)
        .map((frame) => frame.id),
    ).toEqual([`1:${suffixId}`, `1:${latestId}`]);
  } finally {
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

test('trimmed snapshot recovery waits for a retained PG checkpoint before delivering the completed prefix', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const runId = randomUUID();
  const attemptId = randomUUID();
  const key = `${services.queuePrefix}:{run-streams}:${runId}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
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
    await redis.set(generationKey, '1');
    const trimmedCursor = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({
        version: 1,
        runId,
        type: 'text-delta',
        id: 'answer',
        delta: 'Answer prefix — ',
      }),
      'generation',
      '1',
    );
    if (!trimmedCursor)
      throw new Error('Valkey did not return a checkpoint cursor');
    await redis.xtrim(key, 'MAXLEN', '=', 0);

    let checkpoint: string | null = trimmedCursor;
    let revision = 1;
    let answer = 'Answer prefix — ';
    let status: ChatSnapshot['status'] = 'running';
    const reload = async () => ({
      streamGeneration: 1,
      snapshot: {
        runId,
        messageId: runId,
        attemptId,
        generation: 1,
        revision,
        eventId: checkpoint,
        parts: [{ type: 'text' as const, id: 'answer', text: answer }],
        operations: [],
        status,
        errorCode: null,
        reasoningDurationMs: 17,
      },
      reload,
    });
    const fallback = await reload();
    subscription = await hub.subscribe(
      key,
      `1:${trimmedCursor}`,
      sink,
      fallback,
      'snapshot',
    );

    const initialEnd = frames.findIndex((frame) =>
      frame.data.includes('"type":"snapshot-end"'),
    );
    expect(initialEnd).toBeGreaterThanOrEqual(0);
    expect(frames[initialEnd]?.id).toBeUndefined();
    expect(frames.some((frame) => frame.data.includes('snapshot-reset'))).toBe(
      false,
    );

    const suffixId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({
        version: 1,
        runId,
        type: 'text-delta',
        id: 'answer',
        delta: 'answer suffix.',
      }),
      'generation',
      '1',
    );
    if (!suffixId) throw new Error('Valkey did not return a suffix cursor');
    checkpoint = suffixId;
    revision = 2;
    answer = 'Answer prefix — answer suffix.';
    status = 'completed';

    await waitFor(() =>
      frames.some(
        (frame) =>
          frame.data.includes('"type":"snapshot-start"') &&
          frame.data.includes('"revision":2'),
      ),
    );
    const completedStartIndex = frames.findIndex(
      (frame) =>
        frame.data.includes('"type":"snapshot-start"') &&
        frame.data.includes('"revision":2'),
    );
    const completedEnd = frames
      .slice(completedStartIndex + 1)
      .find((frame) => frame.data.includes('"type":"snapshot-end"'));
    expect(completedEnd).toBeDefined();
    expect(completedEnd?.id).toBeUndefined();
    expect(
      frames.some((frame) =>
        frame.data.includes('Answer prefix — answer suffix.'),
      ),
    ).toBe(true);
    expect(frames.some((frame) => frame.data.includes('"type":"finish"'))).toBe(
      true,
    );
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
    const checkpointFrame = frames.find(
      (frame) => frame.id === `2:${replacedId}`,
    );
    expect(checkpointFrame?.data).toContain('"type":"snapshot-end"');
    const checkpointIndex = frames.indexOf(checkpointFrame!);
    const checkpointStart = frames
      .slice(0, checkpointIndex)
      .findLast((frame) => frame.data.includes('"type":"snapshot-start"'));
    expect(checkpointStart?.data).toContain(`"generation":2`);
    expect(checkpointStart?.data).toContain(`"eventId":"${replacedId}"`);
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
    attemptId: snapshotCursor ? attemptId : null,
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
    const discardedUnknownId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: ' then discarded traffic' }),
      'generation',
      '1',
    );
    if (!discardedUnknownId)
      throw new Error('Valkey did not return an XADD cursor');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frames.some((frame) => frame.id === `1:${discardedUnknownId}`)).toBe(
      false,
    );
    snapshotText = 'old committed text checkpointed then discarded traffic';
    snapshotCursor = discardedUnknownId;
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
      'old committed text checkpointed then discarded traffic',
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

test('a reset received during recovery cannot transition to live with a stale snapshot', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
  const runId = randomUUID();
  const frames: SseFrame[] = [];
  let cursor: string | undefined;
  let revision = 1;
  let releaseSnapshot!: (written: boolean) => void;
  let snapshotDrainStarted!: () => void;
  const snapshotDrain = new Promise<boolean>((resolve) => {
    releaseSnapshot = resolve;
  });
  const drainStarted = new Promise<void>((resolve) => {
    snapshotDrainStarted = resolve;
  });
  const makeFallback = (generation: number) => ({
    streamGeneration: generation,
    snapshot: {
      runId,
      messageId: runId,
      attemptId: runId,
      generation,
      revision,
      eventId: cursor ?? null,
      parts: [
        { type: 'text' as const, id: runId, text: `revision ${revision}` },
      ],
      operations: [],
      status: 'running' as const,
      errorCode: null,
      reasoningDurationMs: null,
    },
    reload: async () => makeFallback(2),
  });
  const fallback = makeFallback(1);
  const originalRange = reader.range.bind(reader);
  let recoveringRange = false;
  let releaseRange!: () => void;
  let rangeEntered!: () => void;
  const rangeGate = new Promise<void>((resolve) => {
    releaseRange = resolve;
  });
  const enteredRange = new Promise<void>((resolve) => {
    rangeEntered = resolve;
  });
  let resetReceived!: () => void;
  const receivedReset = new Promise<void>((resolve) => {
    resetReceived = resolve;
  });
  const originalAdd = reader.add.bind(reader);
  const addSpy = vi.spyOn(reader, 'add').mockImplementation((subscription) => {
    const originalReceive = subscription.receive;
    Object.defineProperty(subscription, 'receive', {
      configurable: true,
      value: (entry: StreamEntry) => {
        if (entry.event.includes('"type":"reset"')) resetReceived();
        originalReceive(entry);
      },
    });
    originalAdd(subscription);
  });
  const rangeSpy = vi
    .spyOn(reader, 'range')
    .mockImplementation(async (...args) => {
      const rows = await originalRange(...args);
      if (recoveringRange) {
        recoveringRange = false;
        rangeEntered();
        await rangeGate;
      }
      return rows;
    });
  const sink = {
    write(frame: SseFrame) {
      frames.push(frame);
      if (frame.data.includes('"type":"snapshot-start"')) return false;
      return true;
    },
    async drain() {
      snapshotDrainStarted();
      return snapshotDrain;
    },
    async close() {},
  };
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.set(generationKey, '1');
    const originalId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'status', status: 'running' }),
      'generation',
      '1',
    );
    if (!originalId) throw new Error('Valkey did not return an XADD cursor');
    cursor = originalId;
    subscription = await hub.subscribe(key, `1:${originalId}`, sink, fallback);

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
    cursor = replacementId;
    recoveringRange = true;
    const triggerId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'text-delta', delta: 'before reset' }),
      'generation',
      '2',
    );
    if (!triggerId) throw new Error('Valkey did not return an XADD cursor');
    await enteredRange;
    releaseRange();
    await drainStarted;

    revision = 2;
    const resetId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ version: 1, runId, type: 'reset', sequence: 2 }),
      'generation',
      '2',
    );
    if (!resetId) throw new Error('Valkey did not return an XADD cursor');
    cursor = resetId;
    await receivedReset;
    releaseSnapshot(true);

    await waitFor(() =>
      frames.some(
        (frame) =>
          frame.data.includes('"type":"snapshot-part"') &&
          frame.data.includes('revision 2'),
      ),
    );
    const checkpointFrame = frames.find((frame) => frame.id === `2:${resetId}`);
    expect(checkpointFrame?.data).toContain('"type":"snapshot-end"');
    const checkpointIndex = frames.indexOf(checkpointFrame!);
    const checkpointStart = frames
      .slice(0, checkpointIndex)
      .findLast((frame) => frame.data.includes('"type":"snapshot-start"'));
    expect(checkpointStart?.data).toContain('"generation":2');
    expect(checkpointStart?.data).toContain(`"eventId":"${resetId}"`);
    expect(
      frames.filter((frame) => frame.data.includes('"type":"snapshot-start"')),
    ).toHaveLength(2);
  } finally {
    releaseRange();
    releaseSnapshot(true);
    rangeSpy.mockRestore();
    addSpy.mockRestore();
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('snapshot-only subscribers survive unknown traffic until the PG terminal snapshot', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
  const runId = randomUUID();
  const frames: SseFrame[] = [];
  let status: 'running' | 'completed' = 'running';
  let text = 'authorized PG text';
  const snapshot = () => ({
    runId,
    messageId: runId,
    attemptId: null,
    generation: null,
    revision: 0,
    eventId: null,
    parts: [{ type: 'text' as const, id: runId, text }],
    operations: [],
    status,
    errorCode: null,
    reasoningDurationMs: null,
  });
  const fallback = {
    streamGeneration: 1,
    snapshot: snapshot(),
    reload: async () => ({
      streamGeneration: 1,
      snapshot: snapshot(),
      reload: fallback.reload,
    }),
  };
  let closeReason: string | undefined;
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.set(generationKey, '1');
    const seed = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'status', status: 'running' }),
      'generation',
      '1',
    );
    if (!seed) throw new Error('Valkey did not return an XADD cursor');
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
        async close(reason) {
          closeReason = reason;
        },
      },
      fallback,
    );
    await waitFor(() =>
      frames.some((frame) => frame.data.includes('"type":"snapshot-end"')),
    );
    const delta = 'unknown traffic '.repeat(600);
    for (let index = 0; index < 8; index++) {
      await redis.xadd(
        key,
        '*',
        'event',
        JSON.stringify({ type: 'text-delta', delta }),
        'generation',
        '1',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closeReason).toBeUndefined();

    text = 'complete PG terminal text';
    status = 'completed';
    await waitFor(() =>
      frames.some((frame) => frame.data.includes('"type":"finish"')),
    );
    const terminalPart = frames.find(
      (frame) =>
        frame.data.includes('"type":"snapshot-part"') &&
        frame.data.includes('complete PG terminal text'),
    );
    expect(terminalPart).toBeDefined();
    expect(frames.some((frame) => frame.data.includes('"type":"finish"'))).toBe(
      true,
    );
    expect(closeReason).toBeUndefined();
  } finally {
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('snapshot recovery captures an XREAD suffix while the actual high-water read is pending', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
  const runId = randomUUID();
  const frames: SseFrame[] = [];
  let snapshotCursor: string | null = null;
  const attemptId = randomUUID();
  const makeSnapshot = () => ({
    runId,
    messageId: runId,
    attemptId: snapshotCursor ? attemptId : null,
    generation: snapshotCursor ? 1 : null,
    revision: snapshotCursor ? 1 : 0,
    eventId: snapshotCursor,
    parts: [{ type: 'text' as const, id: runId, text: 'authorized PG prefix' }],
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
  const originalLatest = reader.latest.bind(reader);
  let holdLatest = false;
  let capturedHighWater!: (id: string | undefined) => void;
  const highWaterRead = new Promise<string | undefined>((resolve) => {
    capturedHighWater = resolve;
  });
  let releaseLatest!: () => void;
  const latestGate = new Promise<void>((resolve) => {
    releaseLatest = resolve;
  });
  const latestSpy = vi
    .spyOn(reader, 'latest')
    .mockImplementation(async (streamKey) => {
      const actualHighWater = await originalLatest(streamKey);
      if (holdLatest) {
        holdLatest = false;
        capturedHighWater(actualHighWater);
        await latestGate;
      }
      return actualHighWater;
    });
  let canaryReceived!: () => void;
  const receivedCanary = new Promise<void>((resolve) => {
    canaryReceived = resolve;
  });
  const originalAdd = reader.add.bind(reader);
  const addSpy = vi.spyOn(reader, 'add').mockImplementation((subscription) => {
    const originalReceive = subscription.receive;
    Object.defineProperty(subscription, 'receive', {
      configurable: true,
      value: (entry: StreamEntry) => {
        originalReceive(entry);
        if (entry.event.includes('highwater-window canary')) canaryReceived();
      },
    });
    originalAdd(subscription);
  });
  const advancedIds: string[] = [];
  const originalAdvance = reader.advance.bind(reader);
  const advanceSpy = vi
    .spyOn(reader, 'advance')
    .mockImplementation((sub, id) => {
      advancedIds.push(id);
      originalAdvance(sub, id);
    });
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.set(generationKey, '1');
    const highWaterId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'status', status: 'running' }),
      'generation',
      '1',
    );
    if (!highWaterId) throw new Error('Valkey did not return an XADD cursor');
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

    snapshotCursor = highWaterId;
    holdLatest = true;
    expect(await highWaterRead).toBe(highWaterId);
    const suffixId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({
        type: 'text-delta',
        delta: 'highwater-window canary',
      }),
      'generation',
      '1',
    );
    if (!suffixId) throw new Error('Valkey did not return an XADD cursor');
    await receivedCanary;
    expect(advancedIds).not.toContain(suffixId);
    // The reader has delivered this XADD after H. Simulate retention removing
    // it before the hub finishes recovery; only the active bounded capture can
    // preserve it now.
    await redis.xdel(key, suffixId);
    releaseLatest();

    await waitFor(() => frames.some((frame) => frame.id === `1:${suffixId}`));
    expect(frames.filter((frame) => frame.id === `1:${suffixId}`)).toHaveLength(
      1,
    );
    expect(
      frames.findIndex((frame) => frame.data.includes('"type":"snapshot-end"')),
    ).toBeLessThan(frames.findIndex((frame) => frame.id === `1:${suffixId}`));
    expect(
      frames.find((frame) => frame.id === `1:${suffixId}`)?.data,
    ).toContain('highwater-window canary');
  } finally {
    releaseLatest();
    latestSpy.mockRestore();
    addSpy.mockRestore();
    advanceSpy.mockRestore();
    await subscription?.close();
    await hub.close();
    redis.disconnect();
  }
});

test('recovery bounds outstanding bytes across cumulative drained suffix batches', async ({
  services,
}) => {
  const redis = new Redis(services.valkey.streamsUrl);
  const reader = new SseStreamReader(services.valkey.streamsUrl);
  const hub = new StreamHub(reader, 15_000, 5_000);
  const key = `${services.queuePrefix}:{run-streams}:${randomUUID()}:events`;
  const generationKey = key.replace(/:events$/, ':generation');
  const runId = randomUUID();
  const frames: SseFrame[] = [];
  const closeReasons: Array<string | undefined> = [];
  let snapshotCursor: string | null = null;
  const attemptId = randomUUID();
  const makeSnapshot = () => ({
    runId,
    messageId: runId,
    attemptId: snapshotCursor ? attemptId : null,
    generation: snapshotCursor ? 1 : null,
    revision: snapshotCursor ? 1 : 0,
    eventId: snapshotCursor,
    parts: [],
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
  let releaseRange!: () => void;
  let rangeEntered!: () => void;
  const rangeGate = new Promise<void>((resolve) => {
    releaseRange = resolve;
  });
  const enteredRange = new Promise<void>((resolve) => {
    rangeEntered = resolve;
  });
  const originalRange = reader.range.bind(reader);
  let holdRange = false;
  const rangeSpy = vi
    .spyOn(reader, 'range')
    .mockImplementation(async (...args) => {
      const rows = await originalRange(...args);
      if (holdRange) {
        holdRange = false;
        rangeEntered();
        await rangeGate;
      }
      return rows;
    });
  const batchCount = 5;
  const markers = Array.from(
    { length: batchCount },
    (_, index) => `drain-window suffix-${index}-${'x'.repeat(16_000)}`,
  );
  const encodedFrameBytes = markers.map((marker) =>
    Buffer.byteLength(
      `id: 1:9999999999999-999999\ndata: ${JSON.stringify({ type: 'text-delta', delta: marker })}\n\n`,
      'utf8',
    ),
  );
  expect(Math.max(...encodedFrameBytes)).toBeLessThanOrEqual(65_536);
  expect(
    encodedFrameBytes.reduce((total, bytes) => total + bytes, 0),
  ).toBeGreaterThan(65_536);
  const drains: Array<{
    started: Promise<void>;
    start: () => void;
    completion: Promise<boolean>;
    release: (drained: boolean) => void;
  }> = markers.map(() => {
    let start!: () => void;
    let release!: (drained: boolean) => void;
    return {
      started: new Promise<void>((resolve) => {
        start = resolve;
      }),
      start,
      completion: new Promise<boolean>((resolve) => {
        release = resolve;
      }),
      release,
    };
  });
  const drainStarted = new Set<(typeof drains)[number]>();
  const received = new Map<string, () => void>();
  const receivedPromises = new Map<string, Promise<void>>();
  for (const marker of markers) {
    let resolve!: () => void;
    receivedPromises.set(
      marker,
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    received.set(marker, resolve);
  }
  const suffixIds: string[] = [];
  const originalAdd = reader.add.bind(reader);
  const addSpy = vi.spyOn(reader, 'add').mockImplementation((subscription) => {
    const originalReceive = subscription.receive;
    Object.defineProperty(subscription, 'receive', {
      configurable: true,
      value: (entry: StreamEntry) => {
        originalReceive(entry);
        for (const [marker, notify] of received) {
          if (entry.event.includes(marker)) notify();
        }
      },
    });
    originalAdd(subscription);
  });
  let subscription: { close(): Promise<void> } | undefined;
  try {
    await redis.set(generationKey, '1');
    const highWaterId = await redis.xadd(
      key,
      '*',
      'event',
      JSON.stringify({ type: 'status', status: 'running' }),
      'generation',
      '1',
    );
    if (!highWaterId) throw new Error('Valkey did not return an XADD cursor');
    subscription = await hub.subscribe(
      key,
      undefined,
      {
        write(frame) {
          frames.push(frame);
          return !markers.some((marker) => frame.data.includes(marker));
        },
        async drain() {
          const gate = drains.find((candidate) => !drainStarted.has(candidate));
          if (!gate) throw new Error('Unexpected extra suffix drain');
          drainStarted.add(gate);
          gate.start();
          return gate.completion;
        },
        async close(reason) {
          closeReasons.push(reason);
        },
      },
      fallback,
    );

    snapshotCursor = highWaterId;
    holdRange = true;
    const appendSuffix = async (marker: string): Promise<string> => {
      const id = await redis.xadd(
        key,
        '*',
        'event',
        JSON.stringify({ type: 'text-delta', delta: marker }),
        'generation',
        '1',
      );
      if (!id) throw new Error('Valkey did not return an XADD cursor');
      return id;
    };
    await enteredRange;
    suffixIds.push(await appendSuffix(markers[0]!));
    await receivedPromises.get(markers[0]!);
    releaseRange();
    for (let index = 0; index < batchCount; index++) {
      await drains[index]!.started;
      if (index + 1 < batchCount) {
        suffixIds.push(await appendSuffix(markers[index + 1]!));
        await receivedPromises.get(markers[index + 1]!);
        expect(closeReasons).not.toContain('slow-client');
      }
      drains[index]!.release(true);
    }

    await waitFor(() =>
      frames.some((frame) => frame.id === `1:${suffixIds.at(-1)}`),
    );
    expect(await redis.exists(key)).toBe(1);
    for (const id of suffixIds) {
      expect(frames.filter((frame) => frame.id === `1:${id}`)).toHaveLength(1);
    }
    const deliveredIndices = suffixIds.map((id) =>
      frames.findIndex((frame) => frame.id === `1:${id}`),
    );
    expect(deliveredIndices).toEqual(
      [...deliveredIndices].sort((left, right) => left - right),
    );
  } finally {
    releaseRange();
    for (const gate of drains) gate.release(true);
    rangeSpy.mockRestore();
    addSpy.mockRestore();
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
