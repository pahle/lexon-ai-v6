import type {
  StreamEntry,
  StreamSubscription,
  SseStreamReader,
} from './sse-stream-reader.js';
import { ChatSnapshotFrameSchema, type ChatSnapshot } from '@lexon/contracts';

const SUBSCRIBER_QUEUE_BYTES = 65_536;
const MAX_DEDUP_IDS = 1024;

export interface SseFrame {
  readonly id?: string;
  readonly data: string;
}

export interface SseSink {
  /** Return false when the socket is backpressured. */
  write(frame: SseFrame): boolean;
  drain(timeoutMs: number): Promise<boolean>;
  close(
    reason?: 'slow-client' | 'revoked' | 'shutdown' | 'evicted',
  ): Promise<void>;
}

export interface Subscription {
  close(): Promise<void>;
}

interface QueuedFrame {
  readonly frame: SseFrame;
  readonly bytes: number;
  readonly settle: (written: boolean) => void;
}

interface SnapshotFallback {
  readonly snapshot: ChatSnapshot;
  readonly streamGeneration: number;
  readonly reload?: () => Promise<SnapshotFallback | undefined>;
}

export class StreamHub {
  constructor(
    private readonly reader: SseStreamReader,
    private readonly heartbeatMs = 15000,
    private readonly drainTimeoutMs = 5000,
  ) {}

  async close(): Promise<void> {
    await this.reader.close();
  }

  async subscribe(
    key: string,
    lastEventId: string | undefined,
    sink: SseSink,
    fallback?: SnapshotFallback,
  ): Promise<Subscription> {
    const initialCursor = lastEventId === undefined || lastEventId === '0-0';
    let replaying = true;
    let resyncing = false;
    let lineagePending = false;
    let activeGeneration = fallback?.streamGeneration;
    const buffered: StreamEntry[] = [];
    let bufferedBytes = 0;
    const recentIds = new Set<string>();
    const recentOrder: string[] = [];
    const queue: QueuedFrame[] = [];
    let queueBytes = 0;
    let writing = false;
    let closed = false;
    const heartbeat: { timer?: ReturnType<typeof setInterval> } = {};
    let resolveDrained: (() => void) | undefined;
    const resynchronizer: { run: () => Promise<void> } = {
      run: async () => undefined,
    };
    const live: StreamSubscription = {
      key,
      cursor: '0-0',
      lineageChanged: () => {
        buffered.length = 0;
        bufferedBytes = 0;
        lineagePending = true;
        if (!replaying && !resyncing) {
          resyncing = true;
          void resynchronizer.run();
        }
      },
      receive: (entry) => {
        if (entry.generation !== undefined) {
          if (activeGeneration === undefined)
            activeGeneration = entry.generation;
          else if (entry.generation !== activeGeneration) {
            bufferedBytes += entry.event.length + entry.id.length;
            if (bufferedBytes > SUBSCRIBER_QUEUE_BYTES)
              void close('slow-client');
            else buffered.push(entry);
            if (!resyncing && !replaying) {
              resyncing = true;
              void resynchronizer.run();
            }
            return;
          }
        }
        if (replaying || resyncing) {
          bufferedBytes += entry.event.length + entry.id.length;
          if (bufferedBytes > SUBSCRIBER_QUEUE_BYTES) void close('slow-client');
          else buffered.push(entry);
        } else {
          void deliver(entry, entry.generation);
        }
      },
    };

    const close = async (
      reason?: 'slow-client' | 'revoked' | 'shutdown' | 'evicted',
    ): Promise<void> => {
      if (closed) return;
      closed = true;
      if (heartbeat.timer) clearInterval(heartbeat.timer);
      this.reader.remove(live);
      for (const item of queue) item.settle(false);
      queue.length = 0;
      queueBytes = 0;
      resolveDrained?.();
      await sink.close(reason);
    };

    const pump = async (): Promise<void> => {
      if (writing || closed) return;
      writing = true;
      try {
        while (queue.length && !closed) {
          const item = queue.shift()!;
          let written = false;
          try {
            written = sink.write(item.frame);
            if (!written) written = await sink.drain(this.drainTimeoutMs);
          } catch {
            written = false;
          }
          queueBytes -= item.bytes;
          item.settle(written);
          if (!written) {
            await close('slow-client');
            break;
          }
        }
      } finally {
        writing = false;
        if (!queue.length) resolveDrained?.();
      }
    };

    const enqueue = (frame: SseFrame): Promise<boolean> => {
      if (closed) return Promise.resolve(false);
      const bytes = Buffer.byteLength(`${frame.id ?? ''}${frame.data}`, 'utf8');
      if (queueBytes + bytes > SUBSCRIBER_QUEUE_BYTES) {
        void close('slow-client');
        return Promise.resolve(false);
      }
      queueBytes += bytes;
      const written = new Promise<boolean>((resolve) => {
        queue.push({ frame, bytes, settle: resolve });
      });
      void pump();
      return written;
    };

    const deliver = async (
      entry: StreamEntry,
      generation?: number,
    ): Promise<void> => {
      const dedupId = `${generation ?? 0}:${entry.id}`;
      if (recentIds.has(dedupId) || closed) return;
      recentIds.add(dedupId);
      recentOrder.push(dedupId);
      if (recentOrder.length > MAX_DEDUP_IDS)
        recentIds.delete(recentOrder.shift()!);
      await enqueue({
        id: generation ? `${generation}:${entry.id}` : entry.id,
        data: entry.event,
      });
    };

    const enqueueSnapshot = async (snapshot: ChatSnapshot): Promise<void> => {
      const { parts, operations, ...metadata } = snapshot;
      await enqueue({
        data: JSON.stringify(
          ChatSnapshotFrameSchema.parse({
            version: 1,
            type: 'snapshot-start',
            reset: true,
            snapshot: metadata,
            partCount: parts.length,
            operationCount: operations.length,
          }),
        ),
      });
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex]!;
        let chunk = '';
        let chunkIndex = 0;
        for (const character of part.text) {
          if (chunk && Buffer.byteLength(chunk + character, 'utf8') > 24_000) {
            await enqueue({
              data: JSON.stringify(
                ChatSnapshotFrameSchema.parse({
                  version: 1,
                  type: 'snapshot-part',
                  partIndex,
                  chunkIndex: chunkIndex++,
                  partType: part.type,
                  id: part.id,
                  text: chunk,
                  final: false,
                }),
              ),
            });
            chunk = '';
          }
          chunk += character;
        }
        await enqueue({
          data: JSON.stringify(
            ChatSnapshotFrameSchema.parse({
              version: 1,
              type: 'snapshot-part',
              partIndex,
              chunkIndex,
              partType: part.type,
              id: part.id,
              text: chunk,
              final: true,
            }),
          ),
        });
      }
      for (let index = 0; index < operations.length; index++) {
        await enqueue({
          data: JSON.stringify(
            ChatSnapshotFrameSchema.parse({
              version: 1,
              type: 'snapshot-operation',
              index,
              operation: operations[index],
            }),
          ),
        });
      }
      await enqueue({
        data: JSON.stringify(
          ChatSnapshotFrameSchema.parse({
            version: 1,
            type: 'snapshot-end',
            partCount: parts.length,
            operationCount: operations.length,
          }),
        ),
      });
    };

    resynchronizer.run = async () => {
      if (closed) return;
      let current: SnapshotFallback | undefined;
      try {
        current = await fallback?.reload?.();
      } catch {
        await close('revoked');
        return;
      }
      if (!current) {
        await close('revoked');
        return;
      }
      const currentGeneration = await this.reader.generation(key);
      const currentHighWater = await this.reader.latest(key);
      if (closed) return;
      activeGeneration = currentGeneration;
      recentIds.clear();
      recentOrder.length = 0;
      await enqueueSnapshot(current.snapshot);
      const oldest = await this.reader.oldest(key);
      const cursor = current.snapshot.eventId;
      const compatible = Boolean(
        cursor &&
        currentGeneration !== undefined &&
        current.snapshot.generation === currentGeneration &&
        current.streamGeneration === currentGeneration &&
        currentHighWater &&
        oldest &&
        compareIds(cursor, oldest) >= 0 &&
        compareIds(cursor, currentHighWater) <= 0 &&
        (await this.reader.contains(key, cursor)),
      );
      if (compatible) {
        const rows = await this.reader.range(key, cursor!, currentHighWater!);
        if (rows) for (const row of rows) await deliver(row, currentGeneration);
      }
      const highWater = currentHighWater;
      if (highWater) this.reader.advance(live, highWater);
      for (const entry of buffered
        .splice(0)
        .sort((a, b) => compareIds(a.id, b.id))) {
        if (
          entry.generation === activeGeneration &&
          (!highWater || compareIds(entry.id, highWater) > 0)
        )
          await deliver(entry, entry.generation);
      }
      bufferedBytes = 0;
      lineagePending = false;
      resyncing = false;
    };

    const waitForQueueDrain = async (): Promise<void> => {
      if (!queue.length && !writing) return;
      await new Promise<void>((resolve) => {
        resolveDrained = resolve;
      });
      resolveDrained = undefined;
    };

    // Register first, then take the high-water mark, so XREAD buffers the race.
    this.reader.add(live);
    const highWater = await this.reader.latest(key);
    const valkeyGeneration = await this.reader.generation(key);
    if (highWater) {
      const oldest = await this.reader.oldest(key);
      const parsed = parseCursor(lastEventId);
      const snapshotCursor = fallback?.snapshot.eventId ?? undefined;
      const snapshotCompatible = Boolean(
        fallback &&
        snapshotCursor &&
        fallback.snapshot.generation === valkeyGeneration &&
        fallback.streamGeneration === valkeyGeneration &&
        oldest &&
        compareIds(snapshotCursor, oldest) >= 0 &&
        compareIds(snapshotCursor, highWater) <= 0 &&
        (await this.reader.contains(key, snapshotCursor)),
      );
      const clientCursorValid = Boolean(
        parsed &&
        parsed.generation === valkeyGeneration &&
        (!fallback || parsed.generation === fallback.streamGeneration) &&
        oldest &&
        compareIds(parsed.eventId, oldest) >= 0 &&
        compareIds(parsed.eventId, highWater) <= 0 &&
        (await this.reader.contains(key, parsed.eventId)),
      );
      const resumeFrom = clientCursorValid
        ? parsed!.eventId
        : snapshotCompatible
          ? snapshotCursor!
          : fallback || (lastEventId && !initialCursor)
            ? highWater
            : '0-0';
      const useSnapshot = Boolean(fallback && !clientCursorValid);
      if (useSnapshot) await enqueueSnapshot(fallback!.snapshot);
      else if (lastEventId && !initialCursor && !clientCursorValid)
        await enqueue({
          data: JSON.stringify(
            ChatSnapshotFrameSchema.parse({
              version: 1,
              type: 'snapshot-reset',
              reason: 'cursor-gap',
            }),
          ),
        });
      const rows = await this.reader.range(key, resumeFrom, highWater);
      if (!rows) {
        if (!useSnapshot && fallback) await enqueueSnapshot(fallback.snapshot);
        else if (!useSnapshot)
          await enqueue({
            data: JSON.stringify(
              ChatSnapshotFrameSchema.parse({
                version: 1,
                type: 'snapshot-reset',
                reason: 'stream-unavailable',
              }),
            ),
          });
      } else {
        for (const row of rows) await deliver(row, valkeyGeneration);
      }
      live.cursor = highWater;
      if (highWater) this.reader.advance(live, highWater);
    } else if (fallback) {
      await enqueueSnapshot(fallback.snapshot);
    }
    replaying = false;
    activeGeneration = valkeyGeneration ?? activeGeneration;
    if (
      lineagePending ||
      buffered.some(
        (entry) =>
          entry.generation !== undefined &&
          entry.generation !== activeGeneration,
      )
    ) {
      resyncing = true;
      await resynchronizer.run();
    }
    for (const entry of buffered.sort((a, b) => compareIds(a.id, b.id))) {
      if (!highWater || compareIds(entry.id, highWater) > 0)
        await deliver(entry, entry.generation ?? valkeyGeneration);
    }
    buffered.length = 0;
    bufferedBytes = 0;
    await enqueue({ data: ': connected\n\n' });
    heartbeat.timer = setInterval(() => {
      void enqueue({ data: ': heartbeat\n\n' });
    }, this.heartbeatMs);
    heartbeat.timer.unref();
    return {
      close: async () => {
        await waitForQueueDrain();
        await close();
      },
    };
  }
}

function compareIds(left: string, right: string): number {
  const [leftMs, leftSeq] = left.split('-').map((part) => BigInt(part ?? '0'));
  const [rightMs, rightSeq] = right
    .split('-')
    .map((part) => BigInt(part ?? '0'));
  if (leftMs !== rightMs) return leftMs! < rightMs! ? -1 : 1;
  if (leftSeq !== rightSeq) return leftSeq! < rightSeq! ? -1 : 1;
  return 0;
}

function parseCursor(
  value: string | undefined,
): { generation: number; eventId: string } | undefined {
  const match = /^([1-9]\d*):([0-9]+-[0-9]+)$/.exec(value ?? '');
  if (!match) return undefined;
  const generation = Number(match[1]);
  return Number.isSafeInteger(generation)
    ? { generation, eventId: match[2]! }
    : undefined;
}
