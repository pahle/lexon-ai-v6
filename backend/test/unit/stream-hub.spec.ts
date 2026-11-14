import { RunStreamEventSchema, type ChatSnapshot } from '@lexon/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  StreamEntry,
  StreamSubscription,
  SseStreamReader,
} from '../../src/infrastructure/queue/sse-stream-reader.js';
import {
  StreamHub,
  type SseFrame,
  type SseSink,
} from '../../src/infrastructure/queue/stream-hub.js';

const runId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';
const key = 'run:11111111-1111-4111-8111-111111111111:events';
const activeHubs: Array<{ close(): Promise<void> }> = [];
const activeSubscriptions: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const subscription of activeSubscriptions.splice(0))
    await subscription.close();
  for (const hub of activeHubs.splice(0)) await hub.close();
  vi.useRealTimers();
});

class FakeReader {
  readonly subscriptions = new Set<StreamSubscription>();
  readonly advanced: string[] = [];
  readonly removed: StreamSubscription[] = [];
  readonly ranges: Array<readonly StreamEntry[] | undefined> = [];
  readonly rangeCalls: Array<{ after: string; through: string }> = [];
  readonly retainedIds = new Set<string>();
  latestId: string | undefined = '10-0';
  oldestId: string | undefined = '9-0';
  streamGeneration: number | undefined = 1;
  latestGate: Promise<string | undefined> | undefined;
  releaseLatest: ((id: string | undefined) => void) | undefined;

  add(subscription: StreamSubscription): void {
    this.subscriptions.add(subscription);
  }

  advance(subscription: StreamSubscription, id: string): void {
    this.advanced.push(id);
    const [nextMs, nextSequence] = id.split('-').map(BigInt);
    const [currentMs, currentSequence] = subscription.cursor
      .split('-')
      .map(BigInt);
    if (
      nextMs! > currentMs! ||
      (nextMs === currentMs && nextSequence! > currentSequence!)
    )
      subscription.cursor = id;
  }

  remove(subscription: StreamSubscription): void {
    this.removed.push(subscription);
    this.subscriptions.delete(subscription);
  }

  async latest(_streamKey: string): Promise<string | undefined> {
    void _streamKey;
    return this.latestGate ?? this.latestId;
  }

  async oldest(_streamKey: string): Promise<string | undefined> {
    void _streamKey;
    return this.oldestId;
  }

  async generation(_streamKey: string): Promise<number | undefined> {
    void _streamKey;
    return this.streamGeneration;
  }

  async contains(_streamKey: string, id: string): Promise<boolean> {
    void _streamKey;
    return this.retainedIds.has(id);
  }

  async range(
    _streamKey: string,
    after: string,
    through: string,
  ): Promise<readonly StreamEntry[] | undefined> {
    void _streamKey;
    this.rangeCalls.push({ after, through });
    return this.ranges.shift() ?? [];
  }

  async close(): Promise<void> {
    this.subscriptions.clear();
  }

  emit(entry: StreamEntry): void {
    for (const subscription of this.subscriptions) subscription.receive(entry);
  }

  holdLatest(): void {
    this.latestGate = new Promise((resolve) => {
      this.releaseLatest = resolve;
    });
  }

  unblockLatest(id: string | undefined): void {
    this.releaseLatest?.(id);
    this.latestGate = undefined;
  }
}

function snapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return {
    runId,
    messageId,
    attemptId,
    generation: 1,
    revision: 1,
    eventId: '9-99',
    status: 'running',
    errorCode: null,
    reasoningDurationMs: null,
    parts: [],
    operations: [],
    ...overrides,
  };
}

function streamEvent(event: Record<string, unknown>): string {
  return JSON.stringify(RunStreamEventSchema.parse(event));
}

function textDelta(delta: string): string {
  return streamEvent({
    version: 1,
    runId,
    type: 'text-delta',
    id: 'part-1',
    delta,
  });
}

function wireBytes(entry: StreamEntry, qualified = true): number {
  const id = qualified ? `${entry.generation}:${entry.id}` : entry.id;
  return Buffer.byteLength(`id: ${id}\ndata: ${entry.event}\n\n`, 'utf8');
}

function setup(reader = new FakeReader()) {
  const frames: SseFrame[] = [];
  const close = vi.fn(async () => undefined);
  const recoveryModes: string[] = [];
  const sink: SseSink = {
    write(frame) {
      frames.push(frame);
      return true;
    },
    setRecoveryMode(mode) {
      recoveryModes.push(mode);
    },
    drain: async () => true,
    close,
  };
  const hub = new StreamHub(
    reader as unknown as SseStreamReader,
    60_000,
    5_000,
  );
  activeHubs.push(hub);
  return { hub, reader, sink, frames, close, recoveryModes };
}

function fallback(
  state: ChatSnapshot = snapshot(),
  streamGeneration = state.generation ?? 1,
  reload?: () => Promise<{ snapshot: ChatSnapshot; streamGeneration: number }>,
) {
  return {
    snapshot: state,
    streamGeneration,
    ...(reload ? { reload } : {}),
  };
}

function frameData(frames: readonly SseFrame[]) {
  return frames.flatMap((frame) => {
    try {
      return [JSON.parse(frame.data) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function track<T extends { close(): Promise<void> }>(subscription: T): T {
  activeSubscriptions.push(subscription);
  return subscription;
}

async function flushRecovery(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

it('resumes a retained matching-generation cursor across numeric millisecond and sequence boundaries', async () => {
  const reader = new FakeReader();
  reader.oldestId = '9007199254740993-1';
  reader.latestId = '9007199254740993-3';
  reader.retainedIds.add('9007199254740993-1');
  reader.ranges.push([
    {
      id: '9007199254740993-2',
      generation: 1,
      event: textDelta('first'),
    },
    {
      id: '9007199254740993-3',
      generation: 1,
      event: textDelta('last'),
    },
  ]);
  const { hub, sink, frames, recoveryModes } = setup(reader);

  const subscription = track(
    await hub.subscribe(key, `1:${reader.oldestId}`, sink, fallback()),
  );

  expect(recoveryModes).toEqual(['incremental']);
  expect(frames.map((frame) => frame.id)).toContain('1:9007199254740993-2');
  expect(frames.map((frame) => frame.id)).toContain('1:9007199254740993-3');
  await subscription.close();
});

it('orders a nine-millisecond cursor before a ten-millisecond high water mark', async () => {
  const reader = new FakeReader();
  reader.oldestId = '9-0';
  reader.latestId = '10-0';
  reader.retainedIds.add('9-99');
  reader.ranges.push([{ id: '10-0', generation: 1, event: textDelta('ten') }]);
  const { hub, sink, frames } = setup(reader);
  const sub = track(await hub.subscribe(key, '1:9-99', sink, fallback()));

  expect(frames.map((frame) => frame.id)).toContain('1:10-0');
  await sub.close();
});

it('orders sequence nine before sequence ten within one millisecond', async () => {
  const reader = new FakeReader();
  reader.oldestId = '9-0';
  reader.latestId = '9-10';
  reader.retainedIds.add('9-9');
  reader.ranges.push([
    { id: '9-10', generation: 1, event: textDelta('sequence ten') },
  ]);
  const { hub, sink, frames } = setup(reader);
  const sub = track(await hub.subscribe(key, '1:9-9', sink, fallback()));

  expect(frames.map((frame) => frame.id)).toContain('1:9-10');
  await sub.close();
});

it('uses a snapshot for an unsafe client generation instead of trusting its cursor', async () => {
  const reader = new FakeReader();
  reader.retainedIds.add('9-99');
  reader.ranges.push([]);
  const { hub, sink, frames, recoveryModes } = setup(reader);
  const sub = track(
    await hub.subscribe(key, '9007199254740992:9-99', sink, fallback()),
  );

  expect(recoveryModes).toEqual(['snapshot']);
  expect(
    frameData(frames).some((frame) => frame.type === 'snapshot-start'),
  ).toBe(true);
  expect(
    frames.find((frame) => frame.data.includes('snapshot-start'))?.id,
  ).toBe(undefined);
  await sub.close();
});

it.each(['prefix-1:9-99', '1:9-99-suffix', 'x:9-99'])(
  'uses snapshot recovery for malformed client cursor %s',
  async (cursor) => {
    const reader = new FakeReader();
    reader.retainedIds.add('9-99');
    reader.ranges.push([]);
    const { hub, sink, frames, recoveryModes } = setup(reader);

    const sub = track(await hub.subscribe(key, cursor, sink, fallback()));

    expect(recoveryModes).toEqual(['snapshot']);
    expect(
      frameData(frames).some((frame) => frame.type === 'snapshot-start'),
    ).toBe(true);
    expect(
      frames.find((frame) => frame.data.includes('snapshot-start'))?.id,
    ).toBeUndefined();
    expect(reader.rangeCalls).toEqual([{ after: '9-99', through: '10-0' }]);
    await sub.close();
  },
);

it('accepts a numeric multi-digit sequence cursor without replaying the equal event ID', async () => {
  const reader = new FakeReader();
  reader.oldestId = '9-0';
  reader.latestId = '9-10';
  reader.retainedIds.add('9-10');
  reader.ranges.push([]);
  const { hub, sink, frames, recoveryModes } = setup(reader);

  const sub = track(await hub.subscribe(key, '1:9-10', sink, fallback()));

  expect(recoveryModes).toEqual(['incremental']);
  expect(reader.rangeCalls).toEqual([{ after: '9-10', through: '9-10' }]);
  expect(frames.some((frame) => frame.id === '1:9-10')).toBe(false);
  await sub.close();
});

it('resumes a retained cursor with a safe multi-digit stream generation', async () => {
  const reader = new FakeReader();
  reader.streamGeneration = 12;
  reader.latestId = '9-100';
  reader.retainedIds.add('9-99');
  reader.ranges.push([
    { id: '9-100', generation: 12, event: textDelta('after cursor') },
  ]);
  const { hub, sink, frames, recoveryModes } = setup(reader);

  const sub = track(
    await hub.subscribe(
      key,
      '12:9-99',
      sink,
      fallback(snapshot({ generation: 12, eventId: '9-99' }), 12),
    ),
  );

  expect(recoveryModes).toEqual(['incremental']);
  expect(frames.map((frame) => frame.id)).toContain('12:9-100');
  expect(
    frameData(frames).some((frame) => frame.type === 'snapshot-start'),
  ).toBe(false);
  await sub.close();
});

it('sorts buffered same-millisecond entries numerically and delivers each ID once', async () => {
  const reader = new FakeReader();
  reader.oldestId = '9-0';
  reader.retainedIds.add('9-8');
  reader.ranges.push([]);
  reader.holdLatest();
  const { hub, sink, frames } = setup(reader);
  const pending = hub.subscribe(
    key,
    undefined,
    sink,
    fallback(snapshot({ eventId: '9-8' }), 1),
  );
  const live = [...reader.subscriptions][0]!;
  const ten = { id: '9-10', generation: 1, event: textDelta('ten') };
  const nine = { id: '9-9', generation: 1, event: textDelta('nine') };

  live.receive(ten);
  live.receive(nine);
  live.receive(ten);
  reader.unblockLatest('9-8');
  activeSubscriptions.push(await pending);

  expect(
    frames.filter((frame) => frame.id === '1:9-9').map((frame) => frame.id),
  ).toEqual(['1:9-9']);
  expect(
    frames.filter((frame) => frame.id === '1:9-10').map((frame) => frame.id),
  ).toEqual(['1:9-10']);
  const deliveredOrder = frames
    .filter((frame) => frame.id === '1:9-9' || frame.id === '1:9-10')
    .map((frame) => frame.id);
  expect(deliveredOrder).toEqual(['1:9-9', '1:9-10']);
});

it('does not resume a snapshot cursor from a different stream lineage', async () => {
  const reader = new FakeReader();
  reader.ranges.push([]);
  const { hub, sink, frames, recoveryModes } = setup(reader);
  const sub = track(
    await hub.subscribe(key, '1:9-99', sink, fallback(snapshot(), 2)),
  );

  const end = frames.find((frame) => frame.data.includes('snapshot-end'));
  expect(end?.id).toBeUndefined();
  expect(recoveryModes).toEqual(['snapshot']);
  expect(reader.rangeCalls).toEqual([]);
  await sub.close();
});

it.each([
  '{malformed reset',
  'null',
  'false',
  '1',
  '"reset"',
  '{"type":"reset"}',
  '{"version":2,"type":"reset"}',
  '{"version":1,"type":"status"}',
])(
  'delivers a non-reset entry (%s) without forcing snapshot recovery',
  async (event) => {
    const reader = new FakeReader();
    reader.retainedIds.add('9-99');
    reader.ranges.push([
      { id: '9-100', generation: 1, event },
      {
        id: '9-101',
        generation: 1,
        event: streamEvent({
          version: 1,
          runId,
          type: 'status',
          status: 'running',
        }),
      },
    ]);
    const reload = vi.fn(async () => fallback());
    const { hub, sink, frames } = setup(reader);
    const sub = track(
      await hub.subscribe(key, '1:9-99', sink, fallback(snapshot(), 1, reload)),
    );

    expect(frames.map((frame) => frame.id)).toContain('1:9-100');
    expect(frames.map((frame) => frame.id)).toContain('1:9-101');
    expect(reload).not.toHaveBeenCalled();
    await sub.close();
  },
);

it('recovers from a valid reset entry using a schema-valid database snapshot', async () => {
  const reader = new FakeReader();
  reader.retainedIds.add('9-99');
  const reset = {
    id: '10-0',
    generation: 1,
    event: streamEvent({ version: 1, runId, type: 'reset', sequence: 1 }),
  };
  reader.ranges.push([reset], [reset]);
  const reload = vi.fn(async () => fallback());
  const { hub, sink, frames } = setup(reader);
  const sub = track(
    await hub.subscribe(key, '1:9-99', sink, fallback(snapshot(), 1, reload)),
  );
  await flushRecovery();

  expect(reload).toHaveBeenCalled();
  expect(
    frameData(frames).some((frame) => frame.type === 'snapshot-start'),
  ).toBe(true);
  await sub.close();
});

it.each<[string, Partial<ChatSnapshot>]>([
  ['status', { status: 'awaiting_approval' as const }],
  ['error code', { errorCode: 'AI_INTERNAL' as const }],
  ['reasoning duration', { reasoningDurationMs: 7 }],
  [
    'parts',
    { parts: [{ type: 'text' as const, id: 'part-1', text: 'new part' }] },
  ],
  [
    'operations',
    {
      operations: [
        { operationId, status: 'pending' as const, approvalRequired: true },
      ],
    },
  ],
])(
  'emits a refreshed snapshot when %s changes without a cursor change',
  async (_label, change) => {
    const reader = new FakeReader();
    reader.retainedIds.add('9-99');
    vi.useFakeTimers();
    const baseline = snapshot({ eventId: null });
    const refreshed = snapshot({
      eventId: null,
      ...change,
    });
    const reload = vi.fn(async () => fallback(refreshed, 1));
    const { hub, sink, frames } = setup(reader);
    const sub = track(
      await hub.subscribe(key, undefined, sink, fallback(baseline, 1, reload)),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    const data = frameData(frames);
    if ('parts' in change)
      expect(
        data.some(
          (frame) =>
            frame.type === 'snapshot-part' && frame.text === 'new part',
        ),
      ).toBe(true);
    else if ('operations' in change)
      expect(
        data.some(
          (frame) =>
            frame.type === 'snapshot-operation' &&
            (frame.operation as Record<string, unknown>).operationId ===
              operationId,
        ),
      ).toBe(true);
    else
      expect(
        data.some(
          (frame) =>
            frame.type === 'snapshot-start' &&
            (frame.snapshot as Record<string, unknown>)[
              Object.keys(change)[0]!
            ] === Object.values(change)[0],
        ),
      ).toBe(true);
    await sub.close();
  },
);

it('counts UTF-8 bytes and generation-qualified IDs in the buffered replay limit', async () => {
  const reader = new FakeReader();
  reader.holdLatest();
  const { hub, sink, close } = setup(reader);
  const pending = hub.subscribe(key, undefined, sink);
  const sub = [...reader.subscriptions][0]!;
  const entries = Array.from({ length: 24 }, (_, index) => ({
    id: `9-${index + 1}`,
    generation: 1,
    event: textDelta('漢'.repeat(1_000)),
  }));
  expect(
    entries.every((entry) => Buffer.byteLength(entry.event, 'utf8') <= 4_096),
  ).toBe(true);
  for (const entry of entries) sub.receive(entry);
  reader.unblockLatest(undefined);
  activeSubscriptions.push(await pending);

  expect(close).toHaveBeenCalledWith('slow-client');
  expect(reader.subscriptions.size).toBe(0);
});

it('counts the generation-qualified SSE id when enforcing the buffered byte bound', async () => {
  const reader = new FakeReader();
  reader.holdLatest();
  const { hub, sink, close } = setup(reader);
  const pending = hub.subscribe(key, undefined, sink);
  const sub = [...reader.subscriptions][0]!;
  const entries = Array.from({ length: 20 }, (_, index) => ({
    id: `9-${index + 1}`,
    generation: 1,
    event: textDelta('x'.repeat(3_000)),
  }));
  const initialBytes = entries.reduce(
    (total, entry) => total + wireBytes(entry),
    0,
  );
  const finalId = '9-21';
  const emptyFinal = {
    id: finalId,
    generation: 1,
    event: textDelta(''),
  };
  const finalDelta = 'x'.repeat(65_537 - initialBytes - wireBytes(emptyFinal));
  const finalEntry = { ...emptyFinal, event: textDelta(finalDelta) };
  entries.push(finalEntry);
  expect(
    entries.every((entry) => Buffer.byteLength(entry.event, 'utf8') <= 4_096),
  ).toBe(true);
  expect(entries.reduce((total, entry) => total + wireBytes(entry), 0)).toBe(
    65_537,
  );
  expect(
    entries.reduce((total, entry) => total + wireBytes(entry, false), 0),
  ).toBeLessThanOrEqual(65_536);
  for (const entry of entries) sub.receive(entry);
  reader.unblockLatest(undefined);
  activeSubscriptions.push(await pending);

  expect(close).toHaveBeenCalledWith('slow-client');
  expect(reader.subscriptions.size).toBe(0);
});

it('counts buffered UTF-8 wire bytes for entries that have no SSE ID', async () => {
  const reader = new FakeReader();
  reader.holdLatest();
  const { hub, sink, close } = setup(reader);
  const pending = hub.subscribe(key, undefined, sink);
  const sub = [...reader.subscriptions][0]!;
  const entries = Array.from({ length: 27 }, () => ({
    id: '',
    generation: 0,
    event: textDelta('x'.repeat(2_200)),
  }));
  const emptyFinal = {
    id: '',
    generation: 0,
    event: textDelta(''),
  };
  const initialBytes = entries.reduce(
    (total, entry) =>
      total + Buffer.byteLength(`data: ${entry.event}\n\n`, 'utf8'),
    0,
  );
  const finalDelta = 'x'.repeat(
    65_537 -
      initialBytes -
      Buffer.byteLength(`data: ${emptyFinal.event}\n\n`, 'utf8'),
  );
  const finalEntry = { ...emptyFinal, event: textDelta(finalDelta) };
  entries.push(finalEntry);
  expect(
    entries.every((entry) => Buffer.byteLength(entry.event, 'utf8') <= 4_096),
  ).toBe(true);
  const totalBytes = entries.reduce(
    (total, entry) =>
      total + Buffer.byteLength(`data: ${entry.event}\n\n`, 'utf8'),
    0,
  );
  expect(totalBytes).toBe(65_537);

  for (const entry of entries) sub.receive(entry);
  reader.unblockLatest(undefined);
  activeSubscriptions.push(await pending);

  expect(close).toHaveBeenCalledWith('slow-client');
  expect(reader.subscriptions.size).toBe(0);
});
