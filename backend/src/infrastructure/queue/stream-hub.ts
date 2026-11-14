import type {
  StreamEntry,
  StreamSubscription,
  SseStreamReader,
} from './sse-stream-reader.js';
import {
  ChatSnapshotFrameSchema,
  RunStreamEventSchema,
  type ChatSnapshot,
  type ChatStreamRecoveryMode,
} from '@lexon/contracts';

const SUBSCRIBER_QUEUE_BYTES = 65_536;
const SNAPSHOT_FRAME_BYTE_RESERVE = 32;
const MAX_DEDUP_IDS = 1024;
const SNAPSHOT_RESYNC_INTERVAL_MS = 1000;
const SNAPSHOT_YIELD_INTERVAL = 16_384;

export interface SseFrame {
  readonly id?: string;
  readonly data: string;
}

export interface SseSink {
  /** Return false when the socket is backpressured. */
  write(frame: SseFrame): boolean;
  /** Select recovery behavior before the first frame flushes response headers. */
  setRecoveryMode?(mode: ChatStreamRecoveryMode): void;
  drain(timeoutMs: number): Promise<boolean>;
  close(
    reason?: 'slow-client' | 'revoked' | 'shutdown' | 'evicted',
  ): Promise<void>;
}

export interface Subscription {
  close(): Promise<void>;
  /** Close immediately, dropping queued frames and bypassing socket drain. */
  revoke?(): Promise<void>;
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
    recoveryMode: ChatStreamRecoveryMode = 'incremental',
  ): Promise<Subscription> {
    const initialCursor = lastEventId === undefined || lastEventId === '0-0';
    let replaying = true;
    let resyncing = false;
    let lineagePending = false;
    let snapshotOnly = false;
    let forceSnapshot = false;
    let recoveryEpoch = 0;
    let replayBarrierHighWater: string | undefined;
    let terminalSnapshotSent = false;
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
    const resyncTimer: {
      timer: ReturnType<typeof setInterval> | undefined;
    } = { timer: undefined };
    let currentFallback = fallback;
    let lastSnapshotSignature = fallback
      ? snapshotStateSignature(fallback.snapshot)
      : undefined;
    let lastSnapshotCheckpointId: string | undefined;
    let resolveDrained: (() => void) | undefined;
    const resynchronizer: { run: () => Promise<void> } = {
      run: async () => undefined,
    };
    const queueEntry = (entry: StreamEntry): void => {
      bufferedBytes += bufferedEntryBytes(entry);
      if (bufferedBytes > SUBSCRIBER_QUEUE_BYTES) void close('slow-client');
      else buffered.push(entry);
    };
    const startResync = (force: boolean): void => {
      if (closed) return;
      snapshotOnly = true;
      forceSnapshot ||= force;
      ensureResyncTimer();
      if (!replaying && !resyncing) {
        resyncing = true;
        void resynchronizer.run();
      }
    };
    const live: StreamSubscription = {
      key,
      cursor: '0-0',
      lineageChanged: () => {
        recoveryEpoch++;
        buffered.length = 0;
        bufferedBytes = 0;
        replayBarrierHighWater = undefined;
        lineagePending = true;
        startResync(true);
      },
      receive: (entry) => {
        if (isResetEntry(entry) && fallback) {
          recoveryEpoch++;
          buffered.length = 0;
          bufferedBytes = 0;
          replayBarrierHighWater = undefined;
          startResync(true);
          return;
        }
        if (entry.generation !== undefined) {
          if (activeGeneration === undefined)
            activeGeneration = entry.generation;
          else if (entry.generation !== activeGeneration) {
            if (snapshotOnly) {
              recoveryEpoch++;
              buffered.length = 0;
              bufferedBytes = 0;
              replayBarrierHighWater = undefined;
              if (compareIds(entry.id, live.cursor) > 0) {
                live.cursor = entry.id;
                this.reader.advance(live, entry.id);
              }
              startResync(true);
            } else {
              queueEntry(entry);
              startResync(false);
            }
            return;
          }
        }
        if (snapshotOnly && !replaying) {
          if (
            replayBarrierHighWater &&
            entry.generation === activeGeneration &&
            compareIds(entry.id, replayBarrierHighWater) > 0
          ) {
            queueEntry(entry);
          } else {
            // This advances only the shared XREAD read position. The client
            // cursor remains unchanged; a later compatible PG cursor replays
            // the authoritative suffix directly with XRANGE.
            if (compareIds(entry.id, live.cursor) > 0) {
              live.cursor = entry.id;
              this.reader.advance(live, entry.id);
            }
          }
        } else if (replaying || resyncing) {
          queueEntry(entry);
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
      recoveryEpoch++;
      buffered.length = 0;
      bufferedBytes = 0;
      replayBarrierHighWater = undefined;
      if (heartbeat.timer) clearInterval(heartbeat.timer);
      if (resyncTimer.timer) clearInterval(resyncTimer.timer);
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
      const bytes = encodedFrameBytes(frame);
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

    const enqueueSnapshot = async (
      snapshot: ChatSnapshot,
      checkpointId?: string,
    ): Promise<boolean> => {
      const { parts, operations, ...metadata } = snapshot;
      if (
        !(await enqueue({
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
        }))
      )
        return false;
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex]!;
        const chunks: string[] = [];
        const frameBase = {
          version: 1 as const,
          type: 'snapshot-part' as const,
          partIndex,
          chunkIndex: 0,
          partType: part.type,
          id: part.id,
          text: '',
          final: false,
        };
        const baseBytes = encodedFrameBytes({
          data: JSON.stringify(ChatSnapshotFrameSchema.parse(frameBase)),
        });
        let chunkCharacters: string[] = [];
        let chunkRawBytes = 0;
        let chunkEscapedBytes = 0;
        let processed = 0;
        for (const character of part.text) {
          const characterRawBytes = Buffer.byteLength(character, 'utf8');
          const characterEscapedBytes =
            Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
          if (
            chunkCharacters.length > 0 &&
            (chunkRawBytes + characterRawBytes > 24_000 ||
              baseBytes + chunkEscapedBytes + characterEscapedBytes >
                SUBSCRIBER_QUEUE_BYTES - SNAPSHOT_FRAME_BYTE_RESERVE)
          ) {
            chunks.push(chunkCharacters.join(''));
            chunkCharacters = [];
            chunkRawBytes = 0;
            chunkEscapedBytes = 0;
          }
          chunkCharacters.push(character);
          chunkRawBytes += characterRawBytes;
          chunkEscapedBytes += characterEscapedBytes;
          processed++;
          if (processed % SNAPSHOT_YIELD_INTERVAL === 0)
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        chunks.push(chunkCharacters.join(''));
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          if (
            !(await enqueue({
              data: JSON.stringify(
                ChatSnapshotFrameSchema.parse({
                  ...frameBase,
                  chunkIndex,
                  text: chunks[chunkIndex]!,
                  final: chunkIndex === chunks.length - 1,
                }),
              ),
            }))
          )
            return false;
        }
      }
      for (let index = 0; index < operations.length; index++) {
        if (
          !(await enqueue({
            data: JSON.stringify(
              ChatSnapshotFrameSchema.parse({
                version: 1,
                type: 'snapshot-operation',
                index,
                operation: operations[index],
              }),
            ),
          }))
        )
          return false;
      }
      return enqueue({
        ...(checkpointId ? { id: checkpointId } : {}),
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

    const terminalSnapshot = async (snapshot: ChatSnapshot): Promise<void> => {
      const status = RunStreamEventSchema.parse({
        version: 1,
        runId: snapshot.runId,
        type: 'status',
        status: snapshot.status,
      });
      await enqueue({ data: JSON.stringify(status) });
      if (snapshot.errorCode) {
        const error = RunStreamEventSchema.parse({
          version: 1,
          runId: snapshot.runId,
          type: 'error',
          code: snapshot.errorCode,
        });
        await enqueue({ data: JSON.stringify(error) });
      }
      const finish = RunStreamEventSchema.parse({
        version: 1,
        runId: snapshot.runId,
        type: 'finish',
      });
      await enqueue({ data: JSON.stringify(finish) });
      terminalSnapshotSent = true;
      await close();
    };
    const isTerminal = (snapshot: ChatSnapshot): boolean =>
      snapshot.status === 'completed' ||
      snapshot.status === 'failed' ||
      snapshot.status === 'cancelled';
    const emitSnapshotIfChanged = async (
      snapshot: ChatSnapshot,
      force: boolean,
      checkpoint?: { readonly generation: number; readonly eventId: string },
    ): Promise<void> => {
      const signature = snapshotStateSignature(snapshot);
      const checkpointId =
        checkpoint &&
        Number.isSafeInteger(checkpoint.generation) &&
        checkpoint.generation > 0 &&
        snapshot.generation === checkpoint.generation &&
        snapshot.eventId === checkpoint.eventId &&
        /^\d{1,20}-\d{1,10}$/.test(checkpoint.eventId)
          ? `${checkpoint.generation}:${checkpoint.eventId}`
          : undefined;
      if (
        force ||
        signature !== lastSnapshotSignature ||
        (checkpointId !== undefined &&
          checkpointId !== lastSnapshotCheckpointId)
      ) {
        const complete = await enqueueSnapshot(snapshot, checkpointId);
        if (complete) {
          lastSnapshotSignature = signature;
          lastSnapshotCheckpointId = checkpointId;
        }
      }
    };

    resynchronizer.run = async () => {
      if (closed) return;
      const observedEpoch = recoveryEpoch;
      const interrupted = (): boolean => recoveryEpoch !== observedEpoch;
      // Capture the bounded live window before any recovery reads. Once a
      // compatible PG cursor and high-water mark are proven, earlier entries
      // can be discarded as included in XRANGE and only the suffix is drained.
      replayBarrierHighWater = '0-0';
      activeGeneration = undefined;
      try {
        let current: SnapshotFallback | undefined;
        try {
          current = await currentFallback?.reload?.();
        } catch {
          await close('revoked');
          return;
        }
        if (interrupted()) return;
        if (!current) {
          await close('revoked');
          return;
        }
        currentFallback = current;
        if (isTerminal(current.snapshot)) {
          await emitSnapshotIfChanged(current.snapshot, forceSnapshot);
          if (interrupted()) return;
          forceSnapshot = false;
          if (!terminalSnapshotSent) await terminalSnapshot(current.snapshot);
          return;
        }
        const currentGeneration = await this.reader.generation(key);
        if (interrupted()) return;
        activeGeneration = currentGeneration;
        const cursor = current.snapshot.eventId;
        const oldest = await this.reader.oldest(key);
        if (interrupted()) return;
        const cursorRetained = Boolean(
          cursor && (await this.reader.contains(key, cursor)),
        );
        if (interrupted()) return;
        const currentHighWater = await this.reader.latest(key);
        if (interrupted()) return;
        if (closed) return;
        const compatible = Boolean(
          cursor &&
          currentGeneration !== undefined &&
          current.snapshot.generation === currentGeneration &&
          current.streamGeneration === currentGeneration &&
          currentHighWater &&
          oldest &&
          compareIds(cursor, oldest) >= 0 &&
          compareIds(cursor, currentHighWater) <= 0 &&
          cursorRetained,
        );

        if (!compatible) {
          buffered.length = 0;
          bufferedBytes = 0;
          replayBarrierHighWater = undefined;
          await emitSnapshotIfChanged(current.snapshot, forceSnapshot);
          forceSnapshot = false;
          snapshotOnly = true;
          return;
        }

        // Establish the replay barrier without another await after this
        // high-water read. Events beyond it are held until XRANGE completes.
        replayBarrierHighWater = currentHighWater!;
        const rows = await this.reader.range(key, cursor!, currentHighWater!);
        if (interrupted()) return;
        if (!rows) {
          buffered.length = 0;
          bufferedBytes = 0;
          replayBarrierHighWater = undefined;
          await emitSnapshotIfChanged(current.snapshot, forceSnapshot);
          if (interrupted()) return;
          forceSnapshot = false;
          snapshotOnly = true;
          return;
        }
        if (rows.some(isResetEntry)) {
          buffered.length = 0;
          bufferedBytes = 0;
          replayBarrierHighWater = undefined;
          await emitSnapshotIfChanged(current.snapshot, true);
          if (interrupted()) return;
          forceSnapshot = false;
          snapshotOnly = true;
          return;
        }

        await emitSnapshotIfChanged(current.snapshot, forceSnapshot, {
          generation: currentGeneration!,
          eventId: cursor!,
        });
        if (interrupted()) return;
        forceSnapshot = false;
        recentIds.clear();
        recentOrder.length = 0;
        for (const row of rows) {
          await deliver(row, currentGeneration);
          if (interrupted()) return;
        }
        const highWater = currentHighWater!;
        live.cursor = highWater;
        this.reader.advance(live, highWater);
        while (buffered.length) {
          const suffix = buffered
            .splice(0)
            .sort((a, b) => compareIds(a.id, b.id));
          for (const entry of suffix) {
            try {
              if (interrupted()) return;
              if (
                entry.generation === activeGeneration &&
                compareIds(entry.id, highWater) > 0
              )
                await deliver(entry, entry.generation);
              if (interrupted()) return;
            } finally {
              // The recovery epoch owns this accounting. Reset/lineage signals
              // clear the whole capture, so an older drain must not subtract
              // from the new epoch's byte total.
              if (!interrupted()) bufferedBytes -= bufferedEntryBytes(entry);
            }
          }
        }
        bufferedBytes = 0;
        replayBarrierHighWater = undefined;
        lineagePending = false;
        snapshotOnly = false;
        if (resyncTimer.timer) {
          clearInterval(resyncTimer.timer);
          resyncTimer.timer = undefined;
        }
      } finally {
        resyncing = false;
        if (snapshotOnly && observedEpoch !== recoveryEpoch && !closed) {
          forceSnapshot = true;
          resyncing = true;
          setImmediate(() => void resynchronizer.run());
        }
      }
    };
    function ensureResyncTimer(): void {
      if (!fallback || resyncTimer.timer || closed) return;
      resyncTimer.timer = setInterval(() => {
        if (snapshotOnly && !resyncing && !closed) {
          resyncing = true;
          void resynchronizer.run();
        }
      }, SNAPSHOT_RESYNC_INTERVAL_MS);
      resyncTimer.timer.unref();
    }

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
        recoveryMode !== 'snapshot' &&
        parsed &&
        parsed.generation === valkeyGeneration &&
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
      const useSnapshot = Boolean(
        fallback && (recoveryMode === 'snapshot' || !clientCursorValid),
      );
      sink.setRecoveryMode?.(useSnapshot ? 'snapshot' : 'incremental');
      if (useSnapshot) {
        const checkpointId =
          snapshotCompatible && valkeyGeneration !== undefined && snapshotCursor
            ? `${valkeyGeneration}:${snapshotCursor}`
            : undefined;
        const complete = await enqueueSnapshot(
          fallback!.snapshot,
          checkpointId,
        );
        if (fallback && complete) {
          lastSnapshotSignature = snapshotStateSignature(fallback.snapshot);
          lastSnapshotCheckpointId = checkpointId;
        }
      }
      const snapshotOnlyRequired = Boolean(
        fallback && !clientCursorValid && !snapshotCompatible,
      );
      if (fallback && useSnapshot && isTerminal(fallback.snapshot)) {
        await terminalSnapshot(fallback.snapshot);
      } else if (snapshotOnlyRequired) {
        snapshotOnly = true;
      } else if (
        !useSnapshot &&
        recoveryMode !== 'snapshot' &&
        lastEventId &&
        !initialCursor &&
        !clientCursorValid
      )
        await enqueue({
          data: JSON.stringify(
            ChatSnapshotFrameSchema.parse({
              version: 1,
              type: 'snapshot-reset',
              reason: 'cursor-gap',
            }),
          ),
        });
      if (!snapshotOnly && !closed) {
        const rows = await this.reader.range(key, resumeFrom, highWater);
        if (!rows) {
          if (!useSnapshot && fallback) {
            sink.setRecoveryMode?.('snapshot');
            await enqueueSnapshot(fallback.snapshot);
            lastSnapshotSignature = snapshotStateSignature(fallback.snapshot);
            snapshotOnly = true;
          } else if (!useSnapshot)
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
          const resetIndex = rows.findIndex(isResetEntry);
          const rowsBeforeReset =
            resetIndex === -1 ? rows : rows.slice(0, resetIndex);
          for (const row of rowsBeforeReset)
            await deliver(row, valkeyGeneration);
          if (resetIndex !== -1 && fallback) {
            snapshotOnly = true;
            forceSnapshot = true;
          } else if (resetIndex !== -1) {
            await deliver(rows[resetIndex]!, valkeyGeneration);
          }
        }
        if (fallback && snapshotOnly) {
          // Keep the shared reader cursor behind unknown events until PostgreSQL
          // supplies a checkpoint cursor that proves the replay boundary.
        } else if (!closed) {
          live.cursor = highWater;
          this.reader.advance(live, highWater);
        }
      }
    } else if (fallback) {
      sink.setRecoveryMode?.('snapshot');
      await enqueueSnapshot(fallback.snapshot);
      lastSnapshotSignature = snapshotStateSignature(fallback.snapshot);
      if (isTerminal(fallback.snapshot))
        await terminalSnapshot(fallback.snapshot);
      else snapshotOnly = true;
    }
    replaying = false;
    activeGeneration = valkeyGeneration ?? activeGeneration;
    if (
      lineagePending ||
      (snapshotOnly && forceSnapshot) ||
      buffered.some(
        (entry) =>
          entry.generation !== undefined &&
          entry.generation !== activeGeneration,
      )
    ) {
      startResync(false);
    }
    if (!snapshotOnly && !resyncing) {
      for (const entry of buffered.sort((a, b) => compareIds(a.id, b.id))) {
        if (!highWater || compareIds(entry.id, highWater) > 0)
          await deliver(entry, entry.generation ?? valkeyGeneration);
      }
      buffered.length = 0;
      bufferedBytes = 0;
    }
    if (snapshotOnly && fallback) {
      ensureResyncTimer();
    }
    if (closed || terminalSnapshotSent)
      return { close: async () => close(), revoke: async () => close() };
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
      revoke: async () => close('revoked'),
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

function encodedFrameBytes(frame: SseFrame): number {
  return Buffer.byteLength(
    `${frame.id ? `id: ${frame.id}\n` : ''}data: ${frame.data}\n\n`,
    'utf8',
  );
}

function bufferedEntryBytes(entry: StreamEntry): number {
  const id = entry.generation ? `${entry.generation}:${entry.id}` : entry.id;
  return encodedFrameBytes({ id, data: entry.event });
}

function isResetEntry(entry: StreamEntry): boolean {
  try {
    const event: unknown = JSON.parse(entry.event);
    return (
      typeof event === 'object' &&
      event !== null &&
      'version' in event &&
      event.version === 1 &&
      'type' in event &&
      event.type === 'reset'
    );
  } catch {
    return false;
  }
}

function snapshotStateSignature(snapshot: ChatSnapshot): string {
  return JSON.stringify({
    attemptId: snapshot.attemptId,
    revision: snapshot.revision,
    status: snapshot.status,
    errorCode: snapshot.errorCode,
    reasoningDurationMs: snapshot.reasoningDurationMs,
    parts: snapshot.parts,
    operations: snapshot.operations,
  });
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
