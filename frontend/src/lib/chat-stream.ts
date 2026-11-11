import {
  ChatSnapshotFrameSchema,
  RunStreamEventSchema,
} from '@lexon/contracts';
import type { UIMessageChunk } from 'ai';
import { safeChatError } from './chat-errors';

export interface ChatStreamHandlers {
  readonly onCursor?: (cursor: string) => void;
  readonly onPrefix?: () => void;
  readonly onTerminal?: () => void;
  readonly onReset?: () => void;
  readonly onComplete?: () => void;
}

type StreamState = {
  status?: string;
  messageId?: string;
  reasoningDurationMs?: number | null;
  snapshot?: {
    readonly generation: number | null;
    readonly eventId: string | null;
    readonly partCount: number;
    readonly operationCount: number;
    readonly parts: Map<number, { nextChunk: number; complete: boolean }>;
    readonly operations: Set<number>;
  };
};

export function createChatUIMessageStream(
  response: Response,
  handlers: ChatStreamHandlers = {},
  signal?: AbortSignal,
): ReadableStream<UIMessageChunk> {
  if (!response.body) throw new Error('Chat stream body is unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: StreamState = {};
  const pending: UIMessageChunk[] = [];
  let buffer = '';
  let stopped = false;
  let completed = false;
  let cancellation: Promise<void> | undefined;
  const removeAbortListener = () =>
    signal?.removeEventListener('abort', cancelReader);
  const complete = () => {
    if (completed) return;
    completed = true;
    removeAbortListener();
    handlers.onComplete?.();
  };
  const cancelReader = () => {
    stopped = true;
    complete();
    cancellation ??= reader
      .cancel()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => reader.releaseLock());
    return cancellation;
  };
  const enqueueChunk = (
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    chunk: UIMessageChunk,
  ) => {
    if (chunk.type === 'finish') {
      handlers.onTerminal?.();
      controller.enqueue(chunk);
      stopped = true;
      complete();
      controller.close();
      void cancelReader();
      return true;
    }
    controller.enqueue(chunk);
    return false;
  };
  if (signal?.aborted) cancelReader();
  else signal?.addEventListener('abort', cancelReader, { once: true });

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      if (stopped) {
        complete();
        controller.close();
        return;
      }
      try {
        while (!stopped) {
          const queued = pending.shift();
          if (queued) {
            if (enqueueChunk(controller, queued)) return;
            return;
          }

          const boundary = buffer.indexOf('\n\n');
          if (boundary >= 0) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const frame = parseSseFrame(raw);
            if (!frame?.data) continue;
            const chunks = chunksFromFrame(
              frame.data,
              state,
              handlers,
              frame.id,
            );
            if (chunks.length > 0) {
              pending.push(...chunks.slice(1));
              const first = chunks[0]!;
              if (enqueueChunk(controller, first)) return;
              return;
            }
            continue;
          }

          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.length > 0) {
              const frame = parseSseFrame(buffer);
              buffer = '';
              if (frame?.data) {
                const chunks = chunksFromFrame(
                  frame.data,
                  state,
                  handlers,
                  frame.id,
                );
                if (chunks.length > 0) {
                  pending.push(...chunks.slice(1));
                  const first = chunks[0]!;
                  if (enqueueChunk(controller, first)) return;
                  return;
                }
              }
            }
            stopped = true;
            complete();
            controller.close();
            reader.releaseLock();
            return;
          }
          buffer += decoder
            .decode(value, { stream: true })
            .replace(/\r\n/g, '\n');
        }
      } catch {
        stopped = true;
        complete();
        controller.error(
          new Error('Chat stream was interrupted. Reconnect to continue.'),
        );
        void cancelReader();
      }
    },
    async cancel() {
      await cancelReader();
    },
  });
}

function parseSseFrame(raw: string): { id?: string; data?: string } | null {
  let id: string | undefined;
  const data: string[] = [];
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    if (line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value =
      separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'id' && value.length <= 256) id = value;
    if (field === 'data') data.push(value);
  }
  return data.length === 0
    ? id
      ? { id }
      : null
    : { ...(id ? { id } : {}), data: data.join('\n') };
}

function chunksFromFrame(
  data: string,
  state: StreamState,
  handlers: ChatStreamHandlers,
  frameId?: string,
): UIMessageChunk[] {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return [];
  }

  const snapshot = ChatSnapshotFrameSchema.safeParse(value);
  if (snapshot.success) {
    const frame = snapshot.data;
    if (frame.type === 'snapshot-reset') {
      delete state.snapshot;
      delete state.status;
      delete state.messageId;
      delete state.reasoningDurationMs;
      return [];
    }
    if (frame.type === 'snapshot-start') {
      state.status = frame.snapshot.status;
      state.messageId = frame.snapshot.messageId;
      state.reasoningDurationMs = frame.snapshot.reasoningDurationMs;
      state.snapshot = {
        generation: frame.snapshot.generation,
        eventId: frame.snapshot.eventId,
        partCount: frame.partCount,
        operationCount: frame.operationCount,
        parts: new Map(),
        operations: new Set(),
      };
      return [
        { type: 'reset-step' },
        {
          type: 'start',
          messageId: frame.snapshot.messageId,
          messageMetadata: {
            reasoningDurationMs: frame.snapshot.reasoningDurationMs,
            status: frame.snapshot.status,
            errorCode: frame.snapshot.errorCode,
          },
        },
      ];
    }
    if (frame.type === 'snapshot-part') {
      const current = state.snapshot;
      if (!current || frame.partIndex >= current.partCount) return [];
      const progress = current.parts.get(frame.partIndex);
      const expectedChunk = progress?.nextChunk ?? 0;
      if ((progress?.complete ?? false) || frame.chunkIndex !== expectedChunk) {
        delete state.snapshot;
        return [];
      }
      current.parts.set(frame.partIndex, {
        nextChunk: frame.chunkIndex + 1,
        complete: frame.final,
      });
      const chunks: UIMessageChunk[] = [];
      if (frame.partType === 'text') {
        if (frame.chunkIndex === 0)
          chunks.push({ type: 'text-start', id: frame.id });
        if (frame.text)
          chunks.push({ type: 'text-delta', id: frame.id, delta: frame.text });
        if (frame.final && isTerminalStatus(state.status))
          chunks.push({ type: 'text-end', id: frame.id });
      } else {
        if (frame.chunkIndex === 0)
          chunks.push({ type: 'reasoning-start', id: frame.id });
        if (frame.text)
          chunks.push({
            type: 'reasoning-delta',
            id: frame.id,
            delta: frame.text,
          });
        if (
          frame.final &&
          (isTerminalStatus(state.status) ||
            (state.reasoningDurationMs !== null &&
              state.reasoningDurationMs !== undefined))
        )
          chunks.push({ type: 'reasoning-end', id: frame.id });
      }
      return chunks;
    }
    if (frame.type === 'snapshot-operation') {
      const current = state.snapshot;
      if (
        !current ||
        frame.index >= current.operationCount ||
        current.operations.has(frame.index)
      ) {
        delete state.snapshot;
        return [];
      }
      current.operations.add(frame.index);
      return [];
    }
    if (frame.type === 'snapshot-end') {
      const current = state.snapshot;
      const complete =
        current !== undefined &&
        current.partCount === frame.partCount &&
        current.operationCount === frame.operationCount &&
        current.parts.size === current.partCount &&
        current.operations.size === current.operationCount &&
        [...current.parts.values()].every((part) => part.complete);
      if (!complete || !state.messageId) {
        delete state.snapshot;
        return [];
      }
      delete state.snapshot;
      const expectedCursor =
        current.generation !== null && current.eventId
          ? `${current.generation}:${current.eventId}`
          : undefined;
      if (expectedCursor && frameId === expectedCursor && isCursor(frameId)) {
        handlers.onPrefix?.();
        handlers.onCursor?.(frameId);
      }
      const status = state.status;
      if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled'
      )
        return [
          {
            type: 'finish',
            finishReason:
              status === 'completed'
                ? 'stop'
                : status === 'failed'
                  ? 'error'
                  : 'interrupted',
          },
        ];
    }
    return [];
  }

  const event = RunStreamEventSchema.safeParse(value);
  if (!event.success) return [];
  const item = event.data;
  if (item.type !== 'reset' && frameId && isCursor(frameId))
    handlers.onCursor?.(frameId);
  switch (item.type) {
    case 'start':
      state.messageId = item.messageId;
      delete state.snapshot;
      handlers.onPrefix?.();
      return [{ type: 'start', messageId: item.messageId }];
    case 'start-step':
      return [{ type: 'start-step' }];
    case 'finish-step':
      return [{ type: 'finish-step' }];
    case 'reset-step':
      state.reasoningDurationMs = null;
      return [
        {
          type: 'message-metadata',
          messageMetadata: { reasoningDurationMs: null },
        },
        { type: 'reset-step' },
      ];
    case 'reset':
      delete state.snapshot;
      delete state.messageId;
      delete state.status;
      state.reasoningDurationMs = null;
      handlers.onReset?.();
      return [
        {
          type: 'message-metadata',
          messageMetadata: { reasoningDurationMs: null },
        },
        { type: 'reset-step' },
      ];
    case 'status':
      state.status = item.status;
      return [];
    case 'text-start':
      return [{ type: 'text-start', id: item.id }];
    case 'text-delta':
      return [{ type: 'text-delta', id: item.id, delta: item.delta }];
    case 'text-end':
      return [{ type: 'text-end', id: item.id }];
    case 'reasoning-start':
      return [{ type: 'reasoning-start', id: item.id }];
    case 'reasoning-delta':
      return [{ type: 'reasoning-delta', id: item.id, delta: item.delta }];
    case 'reasoning-end':
      return [
        {
          type: 'reasoning-end',
          id: item.id,
        },
        {
          type: 'message-metadata',
          messageMetadata: { reasoningDurationMs: item.durationMs },
        },
      ];
    case 'error':
      return [{ type: 'error', errorText: safeChatError(item.code) }];
    case 'finish':
      return [
        {
          type: 'finish',
          finishReason:
            state.status === 'failed'
              ? 'error'
              : state.status === 'cancelled'
                ? 'interrupted'
                : 'stop',
        },
      ];
    default:
      return [];
  }
}

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

function isCursor(value: string | undefined): value is string {
  return value !== undefined && /^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/.test(value);
}
