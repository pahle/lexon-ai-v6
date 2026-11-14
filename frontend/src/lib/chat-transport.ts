import {
  CHAT_STREAM_RECOVERY_HEADER,
  CHAT_STREAM_RECOVERY_RESULT_HEADER,
  ChatStreamRecoveryModeSchema,
  SafeErrorMessages,
  UuidSchema,
} from '@lexon/contracts';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { createChatClient } from '@/lib/chat-client';
import { chatClientError, ChatClientError } from '@/lib/chat-errors';
import { createChatUIMessageStream } from '@/lib/chat-stream';
import { notifyIdentityFallbackHint } from '@/lib/identity-client';

const CURSOR_PATTERN = /^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/;
const STORAGE_PREFIX = 'lexon-chat-recovery:';
const STORAGE_TTL_MS = 60 * 60 * 1000;
const STREAM_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 5_000] as const;
const STREAM_INTERRUPTED_MESSAGE =
  'Chat stream was interrupted. Reconnect to continue.';

interface StreamRetryState {
  retries: number;
}

export interface LexonChatTransportOptions {
  readonly baseUrl: string;
  readonly chatId: string;
  readonly actorScope: string;
  readonly selectedLeafId?: string | null;
  readonly effort?: 'high' | 'max';
  readonly initialRunId?: string;
  readonly fetch?: typeof fetch;
  readonly onRunId?: (runId: string | undefined) => void;
  readonly onStreamState?: (state: 'reconnecting' | 'connected') => void;
}

export interface ChatMessageMetadata {
  readonly status?: string;
  readonly errorCode?: string | null;
  readonly feedback?: 'good' | 'bad' | null;
  readonly reasoningDurationMs?: number | null;
  readonly loadedFromServer?: boolean;
  readonly chatOperation?: { readonly type: 'edit'; readonly sourceId: string };
}

export type ChatUIMessage = UIMessage<ChatMessageMetadata>;

interface RecoveryRecord {
  readonly actorScope: string;
  readonly chatId: string;
  readonly runId: string;
  readonly cursor: string;
  readonly updatedAt: number;
}

export class LexonChatTransport implements ChatTransport<ChatUIMessage> {
  private readonly client: ReturnType<typeof createChatClient>;
  private readonly fetcher: typeof fetch;
  private readonly storageKey: string;
  private runId: string | undefined;
  private cursor: string | undefined;
  private prefixProven = false;
  private recoveryMode: 'snapshot' | 'incremental' = 'snapshot';
  private closed = false;
  private generation = 0;
  private readonly activeStreams = new Set<ReadableStream<UIMessageChunk>>();
  private readonly activeRequests = new Set<AbortController>();
  private readonly pendingRetryWaits = new Set<AbortController>();
  private selectedLeafId: string | null;
  private persistedLeafId: string | null;
  private selectionPersisted: Promise<void> = Promise.resolve();
  private selectionQueue: Promise<void> = Promise.resolve();
  private selectionVersion = 0;
  private effort: 'high' | 'max';

  constructor(private readonly options: LexonChatTransportOptions) {
    this.client = createChatClient({
      baseUrl: options.baseUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.fetcher = (options.fetch ?? globalThis.fetch).bind(globalThis);
    this.storageKey = `${STORAGE_PREFIX}${options.actorScope}:${options.chatId}`;
    this.effort = options.effort ?? 'high';
    this.selectedLeafId = options.selectedLeafId
      ? UuidSchema.parse(options.selectedLeafId)
      : null;
    this.persistedLeafId = this.selectedLeafId;
    this.runId = options.initialRunId
      ? UuidSchema.parse(options.initialRunId)
      : undefined;
    this.cursor = this.readRecovery()?.cursor;
  }

  get resumeStreamIsReplay(): boolean {
    return this.recoveryMode === 'snapshot';
  }

  selectLeaf(
    leafId: string | null,
    persist: () => Promise<unknown>,
  ): Promise<void> {
    const selectedLeafId = leafId === null ? null : UuidSchema.parse(leafId);
    const version = ++this.selectionVersion;
    this.selectedLeafId = selectedLeafId;
    const write = this.selectionQueue
      .catch(() => {})
      .then(() => persist())
      .then(() => {
        this.persistedLeafId = selectedLeafId;
      });
    this.selectionQueue = write.then(
      () => undefined,
      () => undefined,
    );
    this.selectionPersisted = write;
    return write.catch((error: unknown) => {
      if (version === this.selectionVersion)
        this.selectedLeafId = this.persistedLeafId;
      throw error;
    });
  }

  setEffort(effort: 'high' | 'max'): void {
    this.effort = effort;
  }

  syncActiveRun(runId: string | undefined): void {
    const nextRunId = runId ? UuidSchema.parse(runId) : undefined;
    if (this.runId === nextRunId) return;
    this.runId = nextRunId;
    this.cursor = undefined;
    this.prefixProven = false;
    this.recoveryMode = 'snapshot';
  }

  invalidateActiveRunStream(): void {
    if (this.closed) return;
    this.generation += 1;
    this.runId = undefined;
    this.cursor = undefined;
    this.prefixProven = false;
    this.recoveryMode = 'snapshot';
    this.removeRecovery();
    for (const request of this.activeRequests) request.abort();
    this.activeRequests.clear();
    for (const wait of this.pendingRetryWaits) wait.abort();
    this.pendingRetryWaits.clear();
    for (const stream of this.activeStreams)
      void stream.cancel().catch(() => {});
    this.activeStreams.clear();
  }

  syncSelectedLeaf(leafId: string | null): void {
    this.selectedLeafId = leafId === null ? null : UuidSchema.parse(leafId);
    this.persistedLeafId = this.selectedLeafId;
  }

  async sendMessages(
    request: Parameters<ChatTransport<ChatUIMessage>['sendMessages']>[0],
  ) {
    this.assertActive();
    const generation = this.generation;
    const headers = mergeHeaders(request.headers);
    let result: { runId: string };

    if (request.trigger === 'regenerate-message') {
      const selectedLeafId = await this.waitForSelection();
      const messageId = request.messageId ?? selectedLeafId;
      if (!messageId) throw new Error('The selected server answer is missing.');
      const mutation = await this.client.regenerate(request.chatId, {
        messageId: UuidSchema.parse(messageId),
        requestId: crypto.randomUUID(),
      });
      result = { runId: mutation.runId };
      this.selectedLeafId = mutation.assistantMessageId;
    } else {
      const user = [...request.messages]
        .reverse()
        .find((message) => message.role === 'user');
      if (!user) throw new Error('A user message is required.');
      const text = user.parts
        .filter(
          (
            part,
          ): part is Extract<(typeof user.parts)[number], { type: 'text' }> =>
            part.type === 'text',
        )
        .map((part) => part.text)
        .join('');
      const edit = user.metadata?.chatOperation;
      const parentMessageId = await this.waitForSelection();
      const mutation =
        edit?.type === 'edit'
          ? await this.client.edit(request.chatId, {
              messageId: UuidSchema.parse(edit.sourceId),
              newMessageId: UuidSchema.parse(user.id),
              text,
              effort: this.effort,
            })
          : await (async () => {
              return this.client.send(request.chatId, {
                userMessageId: UuidSchema.parse(user.id),
                parentMessageId,
                text,
                effort: this.effort,
              });
            })();
      result = { runId: mutation.runId };
      this.selectedLeafId = mutation.assistantMessageId;
    }

    if (generation !== this.generation)
      throw new Error(
        'This conversation changed while the request was starting.',
      );
    this.setRunId(result.runId);
    this.prefixProven = false;
    this.recoveryMode = 'snapshot';
    headers.set(CHAT_STREAM_RECOVERY_HEADER, 'snapshot');
    return this.openLogicalStream(
      result.runId,
      headers,
      request.abortSignal,
      generation,
    );
  }

  async reconnectToStream(
    request: Parameters<
      NonNullable<ChatTransport<ChatUIMessage>['reconnectToStream']>
    >[0],
  ) {
    this.assertActive();
    const runId = this.runId;
    if (!runId) return null;
    this.options.onStreamState?.('reconnecting');
    const generation = this.generation;
    const headers = mergeHeaders(request.headers);
    const suppliedCursor = headers.get('last-event-id');
    const cursor = isCursor(suppliedCursor) ? suppliedCursor : this.cursor;
    const mode = this.prefixProven ? 'incremental' : 'snapshot';
    this.recoveryMode = ChatStreamRecoveryModeSchema.parse(mode);
    headers.set(CHAT_STREAM_RECOVERY_HEADER, mode);
    if (cursor) headers.set('last-event-id', cursor);
    else headers.delete('last-event-id');
    try {
      return await this.openLogicalStream(
        runId,
        headers,
        request.abortSignal,
        generation,
      );
    } catch (error) {
      if (generation !== this.generation && !this.closed) return null;
      throw error;
    }
  }

  async stopRun(runId = this.runId): Promise<void> {
    if (!runId) return;
    await this.fetcher(
      `${this.options.baseUrl.replace(/\/$/, '')}/runs/${runId}/cancel`,
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      },
    )
      .then(async (response) => {
        if (!response.ok) throw await chatClientError(response);
      })
      .catch((error: unknown) => {
        if (error instanceof ChatClientError) throw error;
        throw new ChatClientError('AI_PROVIDER_UNAVAILABLE', 503);
      });
  }

  close(): void {
    this.closed = true;
    this.generation += 1;
    for (const request of this.activeRequests) request.abort();
    this.activeRequests.clear();
    for (const wait of this.pendingRetryWaits) wait.abort();
    this.pendingRetryWaits.clear();
    for (const stream of this.activeStreams)
      void stream.cancel().catch(() => {});
    this.activeStreams.clear();
  }

  private async openStream(
    runId: string,
    headers: Headers,
    signal?: AbortSignal,
    expectedGeneration = this.generation,
  ) {
    const requestController = new AbortController();
    const forwardAbort = () => requestController.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    this.activeRequests.add(requestController);
    const releaseRequest = () => {
      this.activeRequests.delete(requestController);
      signal?.removeEventListener('abort', forwardAbort);
    };
    if (
      expectedGeneration !== this.generation ||
      this.closed ||
      signal?.aborted
    ) {
      releaseRequest();
      throw new Error('This conversation is no longer active.');
    }
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.options.baseUrl.replace(/\/$/, '')}/runs/${runId}/events`,
        {
          method: 'GET',
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: requestController.signal,
        },
      );
    } catch {
      releaseRequest();
      if (expectedGeneration !== this.generation && !this.closed)
        return createClosedUIMessageStream();
      throw new ChatClientError('AI_PROVIDER_UNAVAILABLE', 503);
    }
    if (this.closed) {
      await response.body?.cancel().catch(() => {});
      releaseRequest();
      if (!response.ok) throw await chatClientError(response);
      throw new Error('This conversation is no longer active.');
    }
    if (expectedGeneration !== this.generation) {
      await response.body?.cancel().catch(() => {});
      releaseRequest();
      return createClosedUIMessageStream();
    }
    if (notifyIdentityFallbackHint(response)) {
      await response.body?.cancel().catch(() => {});
      releaseRequest();
      throw new ChatClientError('AI_ACCESS_REVOKED', response.status);
    }
    if (!response.ok) {
      releaseRequest();
      throw await chatClientError(response);
    }
    const selectedMode = ChatStreamRecoveryModeSchema.safeParse(
      response.headers.get(CHAT_STREAM_RECOVERY_RESULT_HEADER),
    );
    if (!selectedMode.success) {
      await response.body?.cancel().catch(() => {});
      releaseRequest();
      throw new ChatClientError('AI_INTERNAL', 503);
    }
    this.recoveryMode = selectedMode.data;
    const stream = createChatUIMessageStream(
      response,
      {
        onCursor: (cursor) => {
          if (
            expectedGeneration !== this.generation ||
            this.closed ||
            !isCursor(cursor)
          )
            return;
          this.cursor = cursor;
          this.saveRecovery(runId, cursor);
        },
        onPrefix: () => {
          if (expectedGeneration === this.generation && !this.closed)
            this.prefixProven = true;
        },
        onReset: () => {
          if (expectedGeneration !== this.generation || this.closed) return;
          this.prefixProven = false;
          this.recoveryMode = 'snapshot';
        },
        onTerminal: () => {
          this.activeStreams.delete(stream);
          if (expectedGeneration !== this.generation || this.closed) return;
          this.prefixProven = false;
          this.cursor = undefined;
          this.removeRecovery();
          this.setRunId(undefined);
        },
        onComplete: () => {
          this.activeStreams.delete(stream);
          releaseRequest();
        },
      },
      requestController.signal,
    );
    this.activeStreams.add(stream);
    this.options.onStreamState?.('connected');
    return stream;
  }

  private async openLogicalStream(
    runId: string,
    headers: Headers,
    signal: AbortSignal | undefined,
    expectedGeneration: number,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const retries: StreamRetryState = { retries: 0 };
    const initialStream = await this.openStreamWithRetries(
      runId,
      headers,
      signal,
      expectedGeneration,
      retries,
    );
    return this.createLogicalStream(
      initialStream,
      runId,
      headers,
      signal,
      expectedGeneration,
      retries,
    );
  }

  private async openStreamWithRetries(
    runId: string,
    headers: Headers,
    signal: AbortSignal | undefined,
    expectedGeneration: number,
    retries: StreamRetryState,
  ): Promise<ReadableStream<UIMessageChunk>> {
    try {
      return await this.openStream(runId, headers, signal, expectedGeneration);
    } catch (error) {
      return this.openAfterFailure(
        runId,
        headers,
        signal,
        expectedGeneration,
        retries,
        error,
      );
    }
  }

  private async openAfterFailure(
    runId: string,
    baseHeaders: Headers,
    signal: AbortSignal | undefined,
    expectedGeneration: number,
    retries: StreamRetryState,
    failure: unknown,
  ): Promise<ReadableStream<UIMessageChunk>> {
    if (
      !this.isRetryableStreamFailure(failure) ||
      retries.retries >= STREAM_RETRY_DELAYS_MS.length ||
      !this.isActiveGeneration(expectedGeneration, signal)
    )
      throw failure;

    retries.retries += 1;
    this.options.onStreamState?.('reconnecting');
    await this.waitForRetry(
      STREAM_RETRY_DELAYS_MS[retries.retries - 1]!,
      signal,
      expectedGeneration,
    );
    return this.openStreamWithRetries(
      runId,
      this.retryHeaders(baseHeaders),
      signal,
      expectedGeneration,
      retries,
    );
  }

  private createLogicalStream(
    initialStream: ReadableStream<UIMessageChunk>,
    runId: string,
    baseHeaders: Headers,
    signal: AbortSignal | undefined,
    expectedGeneration: number,
    retries: StreamRetryState,
  ): ReadableStream<UIMessageChunk> {
    const logicalAbort = new AbortController();
    const forwardAbort = () => logicalAbort.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    let outputController:
      ReadableStreamDefaultController<UIMessageChunk> | undefined;
    let activeReader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
    let cleanedUp = false;
    let outputCanceled = false;
    let outputClosed = false;
    let pullPending = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      signal?.removeEventListener('abort', forwardAbort);
      logicalAbort.signal.removeEventListener('abort', onLogicalAbort);
      this.activeStreams.delete(logicalStream);
    };
    const isInactive = () =>
      logicalAbort.signal.aborted ||
      !this.isActiveGeneration(expectedGeneration, signal);
    const closeOutput = (
      controller: ReadableStreamDefaultController<UIMessageChunk>,
    ) => {
      if (outputClosed || outputCanceled) return;
      outputClosed = true;
      cleanup();
      controller.close();
    };
    const releaseReader = (
      reader: ReadableStreamDefaultReader<UIMessageChunk>,
    ) => {
      try {
        reader.releaseLock();
      } catch {
        // A canceled reader may already have released its lock.
      }
      if (activeReader === reader) activeReader = undefined;
    };
    const cancelReader = (reason?: unknown) => {
      const reader = activeReader;
      if (!reader) return;
      void reader
        .cancel(reason)
        .catch(() => {})
        .finally(() => {
          if (!pullPending && activeReader === reader) releaseReader(reader);
        });
    };
    const onLogicalAbort = () => {
      cancelReader(logicalAbort.signal.reason);
      if (outputController) closeOutput(outputController);
    };
    logicalAbort.signal.addEventListener('abort', onLogicalAbort, {
      once: true,
    });

    let source = initialStream;
    const pullNextChunk = async (
      controller: ReadableStreamDefaultController<UIMessageChunk>,
    ) => {
      if (outputCanceled || outputClosed) return;
      if (isInactive()) {
        closeOutput(controller);
        return;
      }

      pullPending = true;
      try {
        while (true) {
          if (outputCanceled || outputClosed) return;
          if (isInactive()) {
            closeOutput(controller);
            return;
          }

          const reader = activeReader ?? (activeReader = source.getReader());
          let result: ReadableStreamReadResult<UIMessageChunk>;
          try {
            result = await reader.read();
          } catch (failure) {
            releaseReader(reader);
            if (outputCanceled || outputClosed) return;
            if (isInactive()) {
              closeOutput(controller);
              return;
            }
            source = await this.openAfterFailure(
              runId,
              baseHeaders,
              logicalAbort.signal,
              expectedGeneration,
              retries,
              failure,
            );
            continue;
          }

          if (outputCanceled || outputClosed) {
            releaseReader(reader);
            return;
          }
          if (isInactive()) {
            releaseReader(reader);
            closeOutput(controller);
            return;
          }
          if (result.done) {
            releaseReader(reader);
            source = await this.openAfterFailure(
              runId,
              baseHeaders,
              logicalAbort.signal,
              expectedGeneration,
              retries,
              new Error(STREAM_INTERRUPTED_MESSAGE),
            );
            continue;
          }

          controller.enqueue(result.value);
          if (result.value.type === 'finish') {
            releaseReader(reader);
            outputClosed = true;
            cleanup();
            controller.close();
          }
          return;
        }
      } catch (error) {
        if (outputCanceled || outputClosed) return;
        if (isInactive()) closeOutput(controller);
        else {
          outputClosed = true;
          cleanup();
          controller.error(error);
        }
      } finally {
        pullPending = false;
      }
    };

    const logicalStream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        outputController = controller;
      },
      pull(controller) {
        return pullNextChunk(controller);
      },
      async cancel(reason) {
        outputCanceled = true;
        logicalAbort.abort(reason);
        cleanup();
        const reader = activeReader;
        if (reader) await reader.cancel(reason).catch(() => {});
      },
    });
    this.activeStreams.add(logicalStream);
    if (isInactive() && outputController) closeOutput(outputController);
    return logicalStream;
  }

  private retryHeaders(baseHeaders: Headers): Headers {
    const headers = mergeHeaders(baseHeaders);
    const mode = this.prefixProven ? 'incremental' : 'snapshot';
    this.recoveryMode = ChatStreamRecoveryModeSchema.parse(mode);
    headers.set(CHAT_STREAM_RECOVERY_HEADER, mode);
    if (this.cursor) headers.set('last-event-id', this.cursor);
    else headers.delete('last-event-id');
    return headers;
  }

  private isRetryableStreamFailure(error: unknown): boolean {
    if (error instanceof ChatClientError)
      return error.code !== 'AI_ACCESS_REVOKED' && error.status >= 500;
    return (
      error instanceof Error && error.message === STREAM_INTERRUPTED_MESSAGE
    );
  }

  private isActiveGeneration(
    expectedGeneration: number,
    signal: AbortSignal | undefined,
  ): boolean {
    return (
      !this.closed &&
      expectedGeneration === this.generation &&
      signal?.aborted !== true
    );
  }

  private waitForRetry(
    delayMs: number,
    signal: AbortSignal | undefined,
    expectedGeneration: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const wait = new AbortController();
      this.pendingRetryWaits.add(wait);
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);
      const cleanup = () => {
        clearTimeout(timer);
        wait.signal.removeEventListener('abort', onWaitAbort);
        signal?.removeEventListener('abort', onSignalAbort);
        this.pendingRetryWaits.delete(wait);
      };
      const onWaitAbort = () => {
        cleanup();
        reject(
          signal?.reason ?? new Error('The chat stream retry was aborted.'),
        );
      };
      const onSignalAbort = () => wait.abort(signal?.reason);

      wait.signal.addEventListener('abort', onWaitAbort, { once: true });
      if (signal?.aborted) onSignalAbort();
      else signal?.addEventListener('abort', onSignalAbort, { once: true });

      if (!this.isActiveGeneration(expectedGeneration, signal)) {
        wait.abort();
        return;
      }
    });
  }

  private setRunId(runId: string | undefined): void {
    this.runId = runId;
    this.options.onRunId?.(runId);
  }

  private async waitForSelection(): Promise<string | null> {
    while (true) {
      const selectedLeafId = this.selectedLeafId;
      const pending = this.selectionPersisted;
      await pending;
      if (
        selectedLeafId === this.selectedLeafId &&
        pending === this.selectionPersisted
      )
        return selectedLeafId;
    }
  }

  private assertActive(): void {
    if (this.closed) throw new Error(SafeErrorMessages.AI_ACCESS_REVOKED);
  }

  private readRecovery(): RecoveryRecord | undefined {
    const storage = getSessionStorage();
    if (!storage) return undefined;
    try {
      const raw = storage.getItem(this.storageKey);
      if (!raw || raw.length > 512) return undefined;
      const record = JSON.parse(raw) as Partial<RecoveryRecord>;
      if (
        record.actorScope !== this.options.actorScope ||
        record.chatId !== this.options.chatId ||
        !UuidSchema.safeParse(record.runId).success ||
        typeof record.cursor !== 'string' ||
        !isCursor(record.cursor) ||
        typeof record.updatedAt !== 'number' ||
        Date.now() - record.updatedAt > STORAGE_TTL_MS
      ) {
        storage.removeItem(this.storageKey);
        return undefined;
      }
      if (this.runId && record.runId !== this.runId) return undefined;
      this.runId = record.runId;
      return record as RecoveryRecord;
    } catch {
      return undefined;
    }
  }

  private saveRecovery(runId: string, cursor: string): void {
    const storage = getSessionStorage();
    if (!storage) return;
    try {
      const record: RecoveryRecord = {
        actorScope: this.options.actorScope.slice(0, 128),
        chatId: this.options.chatId,
        runId,
        cursor,
        updatedAt: Date.now(),
      };
      storage.setItem(this.storageKey, JSON.stringify(record));
    } catch {
      // Recovery continues from the server snapshot if session storage is unavailable.
    }
  }

  private removeRecovery(): void {
    const storage = getSessionStorage();
    if (!storage) return;
    try {
      storage.removeItem(this.storageKey);
    } catch {
      // Terminal cleanup must not depend on browser storage availability.
    }
  }
}

function getSessionStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function mergeHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers);
}

function createClosedUIMessageStream(): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function isCursor(value: string | null | undefined): value is string {
  return (
    value !== null &&
    value !== undefined &&
    value.length <= 64 &&
    CURSOR_PATTERN.test(value)
  );
}
