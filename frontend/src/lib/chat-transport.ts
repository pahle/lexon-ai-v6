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

const CURSOR_PATTERN = /^[1-9]\d{0,8}:\d{1,20}-\d{1,10}$/;
const STORAGE_PREFIX = 'lexon-chat-recovery:';
const STORAGE_TTL_MS = 60 * 60 * 1000;

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
  readonly reasoningDurationMs?: number | null;
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
    return this.openStream(result.runId, headers, request.abortSignal);
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
    return this.openStream(runId, headers, request.abortSignal, generation);
  }

  async stopRun(): Promise<void> {
    const runId = this.runId;
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
      throw new ChatClientError('AI_PROVIDER_UNAVAILABLE', 503);
    }
    if (!response.ok) {
      releaseRequest();
      throw await chatClientError(response);
    }
    if (expectedGeneration !== this.generation || this.closed) {
      await response.body?.cancel().catch(() => {});
      releaseRequest();
      throw new Error('This conversation is no longer active.');
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

function isCursor(value: string | null | undefined): value is string {
  return (
    value !== null &&
    value !== undefined &&
    value.length <= 64 &&
    CURSOR_PATTERN.test(value)
  );
}
