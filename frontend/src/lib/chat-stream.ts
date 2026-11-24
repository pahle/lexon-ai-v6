import {
  ChatSnapshotFrameSchema,
  RunStreamEventSchema,
} from '@lexon/contracts';
import type { OperationStatus } from '@lexon/contracts';
import type { UIMessageChunk } from 'ai';

export type { UIMessageChunk };
import { safeChatError } from './chat-errors';

/**
 * The operation summary a wire frame carried, reported to the runtime's
 * operation store. Everything is optional but `operationId` — the §9 byte
 * cap can strip the detail fields while the store merges each update.
 */
export interface StreamOperationUpdate {
  readonly operationId: string;
  readonly toolCallId?: string | undefined;
  readonly kind?: 'approval' | 'question' | undefined;
  readonly toolName?: string | undefined;
  readonly status?: OperationStatus | undefined;
  readonly approvalRequired?: boolean | undefined;
  readonly snapshotHash?: string | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly decidedAt?: string | null | undefined;
  readonly input?: Record<string, unknown> | undefined;
  readonly display?: Record<string, unknown> | undefined;
  readonly output?: unknown;
  /** A denied output arrived keyed by toolCallId only. */
  readonly denied?: boolean | undefined;
}

export interface ChatStreamHandlers {
  readonly onCursor?: (cursor: string) => void;
  readonly onPrefix?: () => void;
  readonly isTerminalRelevant?: (runId: string) => boolean;
  readonly onTerminal?: (runId: string) => void;
  readonly onReset?: () => void;
  readonly onComplete?: () => void;
  /** An operation row's wire payload arrived; merge into the op store. */
  readonly onOperation?: (operation: StreamOperationUpdate) => void;
  /**
   * A §9-capped frame dropped the operation's detail fields; the client
   * fetches the tree for the rest (the tree payload has no event cap).
   */
  readonly onOperationSummaryMissing?: (operationId: string) => void;
}

type StreamState = {
  status?: string;
  messageId?: string;
  reasoningDurationMs?: number | null;
  terminalRunId?: string;
  /** toolCallIds whose tool part exists in the streamed message. */
  toolCalls?: Set<string>;
  /** approvalIds the stream already requested a decision for. */
  approvals?: Set<string>;
  snapshot?: {
    readonly runId: string;
    readonly generation: number | null;
    readonly eventId: string | null;
    readonly partCount: number;
    readonly operationCount: number;
    readonly parts: Map<
      number,
      {
        readonly id: string;
        readonly type: 'text' | 'reasoning' | 'tool';
        readonly complete: boolean;
      }
    >;
    readonly operations: Set<number>;
    nextPartIndex: number;
    nextOperationIndex: number;
    activePart?: {
      readonly index: number;
      readonly id: string;
      readonly type: 'text' | 'reasoning' | 'tool';
      nextChunk: number;
    };
  };
  invalidSnapshot?: boolean;
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
      const terminalRunId = state.terminalRunId;
      delete state.terminalRunId;
      if (terminalRunId) handlers.onTerminal?.(terminalRunId);
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
    if (state.snapshot) invalidateSnapshot(state);
    return [];
  }

  // B-19: dispatch on the parsed type so a delta is checked against one
  // schema only — today every event frame is probed by the snapshot union
  // first. A snapshot-looking type that fails still falls through to the
  // event schema, keeping the same rejection path for malformed frames.
  const frameType = (value as { type?: unknown } | null)?.type;
  const snapshot =
    typeof frameType === 'string' && frameType.startsWith('snapshot-')
      ? ChatSnapshotFrameSchema.safeParse(value)
      : null;
  if (snapshot?.success) {
    const frame = snapshot.data;
    if (frame.type === 'snapshot-reset') {
      delete state.snapshot;
      state.invalidSnapshot = false;
      delete state.status;
      delete state.messageId;
      delete state.reasoningDurationMs;
      state.toolCalls?.clear();
      state.approvals?.clear();
      return [];
    }
    if (frame.type === 'snapshot-start') {
      state.invalidSnapshot = false;
      state.status = frame.snapshot.status;
      state.messageId = frame.snapshot.messageId;
      state.reasoningDurationMs = frame.snapshot.reasoningDurationMs;
      state.toolCalls?.clear();
      state.approvals?.clear();
      state.snapshot = {
        runId: frame.snapshot.runId,
        generation: frame.snapshot.generation,
        eventId: frame.snapshot.eventId,
        partCount: frame.partCount,
        operationCount: frame.operationCount,
        parts: new Map(),
        operations: new Set(),
        nextPartIndex: 0,
        nextOperationIndex: 0,
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
    if (state.invalidSnapshot) return [];
    if (frame.type === 'snapshot-part') {
      const current = state.snapshot;
      if (
        !current ||
        current.nextOperationIndex !== 0 ||
        frame.partIndex >= current.partCount
      ) {
        invalidateSnapshot(state);
        return [];
      }
      let progress = current.activePart;
      if (!progress) {
        if (
          frame.partIndex !== current.nextPartIndex ||
          frame.chunkIndex !== 0
        ) {
          invalidateSnapshot(state);
          return [];
        }
        progress = {
          index: frame.partIndex,
          id: frame.id,
          type: frame.partType,
          nextChunk: 0,
        };
        current.activePart = progress;
      } else if (
        frame.partIndex !== progress.index ||
        frame.id !== progress.id ||
        frame.partType !== progress.type
      ) {
        invalidateSnapshot(state);
        return [];
      }
      if (frame.chunkIndex !== progress.nextChunk) {
        invalidateSnapshot(state);
        return [];
      }
      progress.nextChunk += 1;
      if (frame.final) {
        current.parts.set(progress.index, {
          id: progress.id,
          type: progress.type,
          complete: true,
        });
        current.nextPartIndex += 1;
        delete current.activePart;
      }
      const chunks: UIMessageChunk[] = [];
      if (frame.partType === 'tool') {
        // Tool parts replay as a single frame: rebuild the same chunk order
        // the live stream emitted so rows restore identically (§9).
        if (frame.chunkIndex === 0) {
          toolCalls(state).add(frame.toolCallId);
          chunks.push({
            type: 'tool-input-available',
            toolCallId: frame.toolCallId,
            toolName: frame.toolName,
            input: frame.input ?? {},
          });
          handlers.onOperation?.({
            operationId: frame.operationId,
            toolCallId: frame.toolCallId,
            toolName: frame.toolName,
            ...(frame.input !== undefined ? { input: frame.input } : {}),
          });
        }
        if (frame.final) {
          const outcome = frame.outcome;
          if (outcome === 'awaiting_approval') {
            approvals(state).add(frame.operationId);
            chunks.push({
              type: 'tool-approval-request',
              approvalId: frame.operationId,
              toolCallId: frame.toolCallId,
            });
          } else if (outcome !== 'pending') {
            if (
              outcome === 'rejected' ||
              outcome === 'dismissed' ||
              outcome === 'expired'
            )
              chunks.push({
                type: 'tool-output-denied',
                toolCallId: frame.toolCallId,
              });
            else
              chunks.push({
                type: 'tool-output-available',
                toolCallId: frame.toolCallId,
                output: frame.output ?? null,
              });
          }
          handlers.onOperation?.({
            operationId: frame.operationId,
            toolCallId: frame.toolCallId,
            status: outcome,
            ...(frame.output !== undefined ? { output: frame.output } : {}),
          });
          if (outcome === 'awaiting_approval' && frame.input === undefined)
            handlers.onOperationSummaryMissing?.(frame.operationId);
        }
      } else if (frame.partType === 'text') {
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
        frame.index !== current.nextOperationIndex ||
        current.nextPartIndex !== current.partCount ||
        current.activePart !== undefined
      ) {
        invalidateSnapshot(state);
        return [];
      }
      current.nextOperationIndex += 1;
      current.operations.add(frame.index);
      handlers.onOperation?.(frame.operation);
      if (
        frame.operation.input === undefined &&
        frame.operation.display === undefined &&
        frame.operation.output === undefined
      )
        handlers.onOperationSummaryMissing?.(frame.operation.operationId);
      return [];
    }
    if (frame.type === 'snapshot-end') {
      const current = state.snapshot;
      const complete =
        current !== undefined &&
        current.partCount === frame.partCount &&
        current.operationCount === frame.operationCount &&
        current.nextPartIndex === current.partCount &&
        current.activePart === undefined &&
        current.nextOperationIndex === current.operationCount &&
        current.parts.size === current.partCount &&
        current.operations.size === current.operationCount &&
        [...current.parts.values()].every((part) => part.complete);
      if (!complete || !state.messageId) {
        invalidateSnapshot(state);
        return [];
      }
      const status = state.status;
      const terminal = isTerminalStatus(status);
      if (terminal && !isTerminalRelevant(current.runId, handlers)) {
        delete state.snapshot;
        state.invalidSnapshot = false;
        delete state.status;
        delete state.messageId;
        return [];
      }
      delete state.snapshot;
      state.invalidSnapshot = false;
      const expectedCursor =
        current.generation !== null && current.eventId
          ? `${current.generation}:${current.eventId}`
          : undefined;
      if (expectedCursor && frameId === expectedCursor && isCursor(frameId)) {
        handlers.onPrefix?.();
        handlers.onCursor?.(frameId);
      }
      if (terminal) {
        state.terminalRunId = current.runId;
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
    }
    return [];
  }

  const event = RunStreamEventSchema.safeParse(value);
  if (!event.success) {
    if (state.snapshot) invalidateSnapshot(state);
    return [];
  }
  const item = event.data;
  if (state.invalidSnapshot && item.type !== 'reset') return [];
  if (state.snapshot && item.type !== 'reset') {
    invalidateSnapshot(state);
    return [];
  }
  const terminalRunId =
    item.type === 'finish' ||
    (item.type === 'status' && isTerminalStatus(item.status))
      ? item.runId
      : undefined;
  if (terminalRunId && !isTerminalRelevant(terminalRunId, handlers)) return [];
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
      state.invalidSnapshot = false;
      delete state.messageId;
      delete state.status;
      state.reasoningDurationMs = null;
      state.toolCalls?.clear();
      state.approvals?.clear();
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
      return [
        {
          type: 'message-metadata',
          messageMetadata: { status: item.status },
        },
      ];
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
    case 'tool-input-start':
      toolCalls(state).add(item.toolCallId);
      return [
        {
          type: 'tool-input-start',
          toolCallId: item.toolCallId,
          toolName: item.toolName,
        },
      ];
    case 'tool-input-delta':
      return [
        {
          type: 'tool-input-delta',
          toolCallId: item.toolCallId,
          inputTextDelta: item.inputTextDelta,
        },
      ];
    case 'tool-input-available': {
      toolCalls(state).add(item.toolCallId);
      const operationId = item.operationId ?? item.toolCallId;
      handlers.onOperation?.({
        operationId,
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        ...(item.input !== undefined ? { input: item.input } : {}),
      });
      // §9: a dropped input means the row's detail fields live on the tree.
      if (item.input === undefined)
        handlers.onOperationSummaryMissing?.(operationId);
      return [
        {
          type: 'tool-input-available',
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          input: item.input ?? {},
        },
      ];
    }
    case 'approval-required':
    case 'question-required': {
      const toolCallId = item.operationId;
      const chunks: UIMessageChunk[] = [];
      // The lifecycle batch emits tool-input-available first; a summary-less
      // fallback frame still needs a part for the approval request to land.
      if (!toolCalls(state).has(toolCallId)) {
        toolCalls(state).add(toolCallId);
        chunks.push({
          type: 'tool-input-available',
          toolCallId,
          toolName: item.operation?.toolName ?? 'operation',
          input: item.operation?.input ?? {},
        });
      }
      approvals(state).add(item.operationId);
      const summary = item.operation;
      handlers.onOperation?.({
        ...(summary ?? {}),
        operationId: item.operationId,
        toolCallId,
        kind:
          item.kind ??
          (item.type === 'approval-required' ? 'approval' : 'question'),
        status: 'awaiting_approval',
      });
      if (!summary) handlers.onOperationSummaryMissing?.(item.operationId);
      chunks.push({
        type: 'tool-approval-request',
        approvalId: item.operationId,
        toolCallId,
        ...(summary ? { approvalDescriptor: summary } : {}),
      });
      return chunks;
    }
    case 'tool-approval-request':
      approvals(state).add(item.approvalId);
      return [
        {
          type: 'tool-approval-request',
          toolCallId: item.toolCallId,
          approvalId: item.approvalId,
        },
      ];
    case 'tool-approval-response':
      if (!approvals(state).has(item.approvalId)) return [];
      return [
        {
          type: 'tool-approval-response',
          approvalId: item.approvalId,
          approved: item.approved,
        },
      ];
    case 'operation-status': {
      handlers.onOperation?.({
        operationId: item.operationId,
        status: item.status,
      });
      const toolCallId = item.operationId;
      const chunks: UIMessageChunk[] = [];
      if (item.status === 'approved' || item.status === 'answered') {
        if (approvals(state).has(item.operationId))
          chunks.push({
            type: 'tool-approval-response',
            approvalId: item.operationId,
            approved: true,
          });
      } else if (
        item.status === 'rejected' ||
        item.status === 'dismissed' ||
        item.status === 'expired'
      ) {
        // Respond first so the terminal state stays output-denied.
        if (approvals(state).has(item.operationId))
          chunks.push({
            type: 'tool-approval-response',
            approvalId: item.operationId,
            approved: false,
          });
        if (toolCalls(state).has(toolCallId))
          chunks.push({ type: 'tool-output-denied', toolCallId });
        else handlers.onOperationSummaryMissing?.(item.operationId);
      }
      return chunks;
    }
    case 'tool-output-available': {
      const operationId = item.operationId ?? item.toolCallId;
      handlers.onOperation?.({
        operationId,
        toolCallId: item.toolCallId,
        ...(item.output !== undefined ? { output: item.output } : {}),
      });
      if (item.output === undefined)
        handlers.onOperationSummaryMissing?.(operationId);
      if (!toolCalls(state).has(item.toolCallId)) {
        // Output without a seen input (a superseded leftover op): the tree
        // rebuilds the row — emitting the chunk would crash on a missing part.
        return [];
      }
      return [
        {
          type: 'tool-output-available',
          toolCallId: item.toolCallId,
          output: item.output ?? null,
        },
      ];
    }
    case 'tool-output-denied': {
      handlers.onOperation?.({
        operationId: item.toolCallId,
        toolCallId: item.toolCallId,
        denied: true,
      });
      if (!toolCalls(state).has(item.toolCallId)) {
        handlers.onOperationSummaryMissing?.(item.toolCallId);
        return [];
      }
      return [{ type: 'tool-output-denied', toolCallId: item.toolCallId }];
    }
    case 'error':
      return [{ type: 'error', errorText: safeChatError(item.code) }];
    case 'finish':
      state.terminalRunId = item.runId;
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

function toolCalls(state: StreamState): Set<string> {
  return (state.toolCalls ??= new Set());
}

function approvals(state: StreamState): Set<string> {
  return (state.approvals ??= new Set());
}

function isTerminalRelevant(
  runId: string,
  handlers: ChatStreamHandlers,
): boolean {
  return handlers.isTerminalRelevant?.(runId) ?? true;
}

function invalidateSnapshot(state: StreamState): void {
  delete state.snapshot;
  state.invalidSnapshot = true;
}

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

function isCursor(value: string | undefined): value is string {
  return value !== undefined && /^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/.test(value);
}
