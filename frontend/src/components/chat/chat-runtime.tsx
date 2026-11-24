'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { useAISDKRuntime } from '@assistant-ui/ai-sdk';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  bindExternalStoreMessage,
  fromThreadMessageLike,
  getExternalStoreMessages,
  useAuiState,
} from '@assistant-ui/react';
import type {
  AppendMessage,
  ExportedMessageRepository,
  ThreadMessage,
} from '@assistant-ui/react';
import type { CreateUIMessage, UIMessage } from 'ai';
import type {
  ChatGetResult,
  ChatMessage,
  ChatOperationSnapshot,
  ChatTree,
  OperationDecisionInput,
  OperationDecisionResult,
  OperationStatus,
} from '@lexon/contracts';
import { Button } from '@/components/ui/button';
import { useTreePolling } from './use-tree-polling';
import { createChatClient } from '@/lib/chat-client';
import { LexonChatTransport, type ChatUIMessage } from '@/lib/chat-transport';
import type { StreamOperationUpdate } from '@/lib/chat-stream';

const ChatStopContext = createContext<(() => Promise<void>) | null>(null);
const ChatActiveRunContext = createContext(false);

export function useChatActiveRun(): boolean {
  return useContext(ChatActiveRunContext);
}

/**
 * The merged wire/canonical view of one operation: every field optional but
 * the id — §9-capped frames keep the ids/hash core and the tree fetch fills
 * in the rest, while a decide response adds `decision`/`decidedAt`.
 */
export interface ChatOperationRecord {
  readonly operationId: string;
  readonly toolCallId?: string | undefined;
  readonly kind?: 'approval' | 'question' | undefined;
  readonly toolName?: string | undefined;
  readonly status?: OperationStatus | undefined;
  readonly approvalRequired?: boolean | undefined;
  readonly snapshotHash?: string | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly decidedAt?: string | null | undefined;
  readonly decision?: string | null | undefined;
  readonly input?: Record<string, unknown> | undefined;
  readonly display?: Record<string, unknown> | undefined;
  readonly output?: unknown;
  readonly denied?: boolean | undefined;
}

const DECIDED_STATUSES: ReadonlySet<OperationStatus> = new Set([
  'approved',
  'rejected',
  'answered',
  'dismissed',
  'expired',
  'completed',
  'failed',
  'outcome_unknown',
]);

export function isDecidedOperationStatus(
  status: OperationStatus | undefined,
): boolean {
  return status !== undefined && DECIDED_STATUSES.has(status);
}

export interface ChatAwaiting {
  /** The run is paused on a decision or question (or a pending tool part). */
  readonly paused: boolean;
  /** The paused run's id — the decide route's runId. */
  readonly runId: string | undefined;
  /** The operation id whose tool part waits for a decision, if any. */
  readonly pendingOperationId: string | undefined;
  /** Bumps when the operation store changes. */
  readonly version: number;
  getOperation(
    operationId: string | undefined,
  ): ChatOperationRecord | undefined;
  /**
   * §6.3 owner decision route: posts the decision and merges the stored
   * outcome into the operation store — even when it differs from the sent
   * action (the stored outcome wins; the panel closes without an error).
   */
  decide(
    operationId: string,
    input: OperationDecisionInput,
  ): Promise<OperationDecisionResult | null>;
  /** Fetch the tree now — a §9-capped frame dropped the detail fields. */
  refreshTree(): void;
}

const ChatAwaitingContext = createContext<ChatAwaiting | null>(null);

export function useChatAwaiting(): ChatAwaiting | null {
  return useContext(ChatAwaitingContext);
}

export interface ChatRuntimeProps {
  readonly actorScope: string;
  readonly chatId: string;
  readonly tree: ChatTree;
  readonly effort?: 'high' | 'max';
  readonly children: ReactNode;
  readonly onTreeRefresh?: (
    signal: AbortSignal,
    ifNoneMatch: string | undefined,
  ) => Promise<ChatGetResult>;
  /** The validator the latest non-poll tree write carried (the initial GET). */
  readonly treeEtag?: string | null;
  readonly onTreeUpdate?: (tree: ChatTree) => void;
  readonly onRunId?: (runId: string | undefined) => void;
  readonly onStreamState?: (state: 'reconnecting' | 'connected') => void;
  readonly onStopReady?: (stop: () => Promise<void>) => void;
}

export interface LeafStore {
  getSelectedLeafId(): string | null;
  setSelectedLeafId(leafId: string | null): void;
  /** Falls back to the server's viewed leaf when the selection vanished. */
  syncFromTree(tree: ChatTree): void;
}

/** The single owner of the selected leaf for one chat runtime. */
export function createLeafStore(initial: string | null): LeafStore {
  let selected = initial;
  return {
    getSelectedLeafId: () => selected,
    setSelectedLeafId: (leafId) => {
      selected = leafId;
    },
    syncFromTree: (tree) => {
      if (
        selected !== null &&
        tree.messages.some((message) => message.id === selected)
      )
        return;
      selected = tree.viewedLeafId;
    },
  };
}

export function ChatRuntime(props: ChatRuntimeProps) {
  return (
    <ChatRuntimeSession
      key={`${props.actorScope}:${props.chatId}`}
      {...props}
    />
  );
}

function ChatRuntimeSession({
  actorScope,
  chatId,
  tree,
  effort = 'high',
  children,
  onTreeRefresh,
  treeEtag,
  onTreeUpdate,
  onRunId,
  onStreamState,
  onStopReady,
}: ChatRuntimeProps) {
  const [runId, setRunId] = useState<string | undefined>(
    () => findActiveRun(tree)?.runId,
  );
  const [serverActiveRunId, setServerActiveRunId] = useState<
    string | undefined
  >(() => findActiveRun(tree)?.runId);
  const [selectionSaveFailed, setSelectionSaveFailed] = useState(false);
  const [leafStore] = useState(() => createLeafStore(tree.viewedLeafId));
  const onRunIdRef = useRef(onRunId);
  const onStreamStateRef = useRef(onStreamState);
  const onStopReadyRef = useRef(onStopReady);
  const streamReconnectingRef = useRef(false);
  const streamFrameSeenRef = useRef(false);
  useEffect(() => {
    onRunIdRef.current = onRunId;
  }, [onRunId]);
  useEffect(() => {
    onStreamStateRef.current = onStreamState;
  }, [onStreamState]);
  useEffect(() => {
    onStopReadyRef.current = onStopReady;
  }, [onStopReady]);

  const handleRunId = useCallback((nextRunId: string | undefined) => {
    setRunId(nextRunId);
    setServerActiveRunId(nextRunId);
    onRunIdRef.current?.(nextRunId);
  }, []);
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const activeRun = findActiveRun(tree);
  // The operation store merges wire events, snapshot/operation summaries,
  // canonical tree ops and decide results into one map keyed by operationId.
  const operationsRef = useRef(new Map<string, ChatOperationRecord>());
  const [operationsVersion, setOperationsVersion] = useState(0);
  const mergeOperation = useCallback(
    (update: StreamOperationUpdate | ChatOperationRecord) => {
      const previous = operationsRef.current.get(update.operationId);
      const next = mergeOperationRecord(previous, update);
      if (next === previous) return;
      operationsRef.current.set(update.operationId, next);
      setOperationsVersion((version) => version + 1);
    },
    [],
  );
  const getOperation = useCallback(
    (operationId: string | undefined) =>
      operationId === undefined
        ? undefined
        : operationsRef.current.get(operationId),
    [],
  );
  const refreshTreeNowRef = useRef<() => void>(() => undefined);
  const transport = useMemo(
    () =>
      new LexonChatTransport({
        baseUrl: '/api',
        chatId,
        actorScope,
        getSelectedLeafId: leafStore.getSelectedLeafId,
        setSelectedLeafId: leafStore.setSelectedLeafId,
        effort,
        onStreamState: (state) => {
          streamReconnectingRef.current = state === 'reconnecting';
          onStreamStateRef.current?.(state);
        },
        onOperation: (operation) => mergeOperation(operation),
        onOperationSummaryMissing: () => refreshTreeNowRef.current(),
        ...(activeRun ? { initialRunId: activeRun.runId } : {}),
        onRunId: handleRunId,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the transport is created once per actor and chat; effort, active run and callbacks are read through setters and refs, and recreating it would drop the open stream
    [actorScope, chatId],
  );
  // Canonical ops feed the same store; they never downgrade a decided state.
  useEffect(() => {
    for (const message of tree.messages)
      if (message.role === 'assistant')
        for (const operation of message.operations) mergeOperation(operation);
  }, [tree, mergeOperation]);

  const repository = useMemo(() => toMessageRepository(tree), [tree]);
  const createMessage = useCallback(toCreateChatMessage, []);

  const chat = useChat<ChatUIMessage>({
    id: chatId,
    resume: false,
    transport,
  });
  const chatStatusRef = useRef(chat.status);
  chatStatusRef.current = chat.status;
  // Spec item 16: poll at 1 s until the first stream frame of the active run.
  if (chat.status === 'streaming') streamFrameSeenRef.current = true;
  const threadRuntimeRef = useRef<
    ReturnType<typeof useAISDKRuntime>['thread'] | undefined
  >(undefined);
  const runtime = useAISDKRuntime(chat, {
    joinStrategy: 'none',
    messageRepository: repository,
    toCreateMessage: createMessage,
    unstable_onBranchChange: ({
      headId,
    }: {
      readonly headId: string | null;
    }) => {
      if (headId === null) return;
      leafStore.setSelectedLeafId(headId);
      setSelectionSaveFailed(false);
      void transport
        .selectLeaf(headId, () =>
          client.setViewedLeaf(chatId, { leafId: headId }),
        )
        .then(() => setSelectionSaveFailed(false))
        .catch(() => setSelectionSaveFailed(true));
    },
  });
  threadRuntimeRef.current = runtime.thread;

  useEffect(() => {
    transport.setEffort(effort);
  }, [effort, transport]);

  useEffect(() => {
    streamFrameSeenRef.current = false;
    transport.syncActiveRun(activeRun?.runId);
    if (activeRun) {
      setServerActiveRunId(activeRun.runId);
      setRunId(activeRun.runId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed to the run id only; activeRun is rebuilt from the tree each render
  }, [activeRun?.runId, transport]);

  const refreshTree = async (
    signal: AbortSignal,
    ifNoneMatch: string | undefined,
  ) => {
    if (!onTreeRefresh) return;
    try {
      const result = await onTreeRefresh(signal, ifNoneMatch);
      if (signal.aborted) return;
      // A 304 keeps the current tree object untouched: no leaf sync, no
      // onTreeUpdate, no state update.
      if (result.notModified) return { etag: result.etag };
      const freshTree = result.tree;
      leafStore.syncFromTree(freshTree);
      const selectedLeafId = leafStore.getSelectedLeafId();
      const refreshedTree =
        selectedLeafId !== null && selectedLeafId !== freshTree.viewedLeafId
          ? { ...freshTree, viewedLeafId: selectedLeafId }
          : freshTree;
      onTreeUpdate?.(refreshedTree);
      const freshRun = findActiveRun(freshTree);
      if (freshRun) {
        setServerActiveRunId(freshRun.runId);
        setRunId(freshRun.runId);
        transport.syncActiveRun(freshRun.runId);
      } else {
        const threadRuntime = threadRuntimeRef.current;
        const visibleMessagesBeforeStop = threadRuntime?.getState().messages;
        const visibleLeafBeforeStop = visibleMessagesBeforeStop?.at(-1)?.id;
        const selectedLeafBeforeStop = leafStore.getSelectedLeafId();
        const sdkRunIsActive =
          chatStatusRef.current === 'submitted' ||
          chatStatusRef.current === 'streaming';
        transport.invalidateActiveRunStream();
        if (sdkRunIsActive) await chat.stop();
        if (signal.aborted) return;
        const currentThreadRuntime = threadRuntimeRef.current;
        if (currentThreadRuntime) {
          const currentRepository = currentThreadRuntime.export();
          const branchChangedDuringStop =
            leafStore.getSelectedLeafId() !== selectedLeafBeforeStop;
          importCanonicalTerminalRepository(
            currentThreadRuntime,
            reconcileCanonicalTerminalMessages(
              currentRepository,
              freshTree,
              branchChangedDuringStop
                ? currentRepository.headId
                : visibleLeafBeforeStop,
              visibleMessagesBeforeStop,
            ),
            chat.setMessages,
          );
        }
        setServerActiveRunId(undefined);
        setRunId(undefined);
        transport.syncActiveRun(undefined);
      }
      return { etag: result.etag };
    } catch (error) {
      // Keep controls locked until an authoritative refresh succeeds; the
      // polling hook counts the failure and keeps going.
      if (signal.aborted) return;
      throw error;
    }
  };
  const { refreshNow: refreshTreeNow } = useTreePolling({
    enabled: Boolean(serverActiveRunId && onTreeRefresh),
    fetchTree: refreshTree,
    isUrgent: () =>
      streamReconnectingRef.current ||
      chatStatusRef.current === 'submitted' ||
      !streamFrameSeenRef.current,
    onFailures: () => onStreamStateRef.current?.('reconnecting'),
    resetKey: chatId,
    seedEtag: treeEtag ?? null,
  });
  refreshTreeNowRef.current = refreshTreeNow;

  const decideOperation = useCallback(
    async (operationId: string, input: OperationDecisionInput) => {
      const activeRunId = serverActiveRunId ?? runId;
      if (!activeRunId) return null;
      const result = await client.decideOperation(
        activeRunId,
        operationId,
        input,
      );
      // The stored outcome wins over the sent action (two-tab races, §6.3).
      mergeOperation({
        operationId,
        status: result.status,
        decidedAt: result.decidedAt,
        decision: result.decision,
      });
      return result;
    },
    [client, mergeOperation, runId, serverActiveRunId],
  );

  const initialRunId = activeRun?.runId;
  const resumedRunRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialRunId || resumedRunRef.current === initialRunId) return;
    if (!chat.messages.some((message) => message.id === activeRun?.id)) return;
    resumedRunRef.current = initialRunId;
    void chat.resumeStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed to the active-run message and its arrival; chat is a new object each render and would re-resume the stream
  }, [activeRun?.id, chat.messages, chat.resumeStream, initialRunId]);

  const stop = useCallback(async () => {
    await transport.stopRun(serverActiveRunId ?? runId);
    runtime.thread.cancelRun();
  }, [runId, runtime.thread, serverActiveRunId, transport]);
  const onStopReadyCallback = useCallback(() => {
    onStopReadyRef.current?.(stop);
  }, [stop]);
  useEffect(() => {
    onStopReadyCallback();
  }, [onStopReadyCallback]);
  useEffect(() => () => transport.close(), [transport]);
  useEffect(() => {
    onRunIdRef.current?.(runId);
  }, [runId]);

  return (
    <ChatStopContext.Provider value={stop}>
      <ChatActiveRunContext.Provider value={serverActiveRunId !== undefined}>
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatAwaitingBridge
            runId={serverActiveRunId ?? runId}
            version={operationsVersion}
            getOperation={getOperation}
            decide={decideOperation}
            refreshTree={() => refreshTreeNowRef.current()}
          >
            {children}
          </ChatAwaitingBridge>
          {selectionSaveFailed ? (
            <span role="alert">
              Could not save this branch selection. Reload the conversation
              before sending another message.
            </span>
          ) : null}
        </AssistantRuntimeProvider>
      </ChatActiveRunContext.Provider>
    </ChatStopContext.Provider>
  );
}

/**
 * Reads the thread's last assistant message to decide whether the run waits
 * for the user: a paused metadata status or a tool part whose approval is
 * still unanswered (and whose stored status has not already settled — the
 * stored outcome wins in two-tab races).
 */
function ChatAwaitingBridge({
  runId,
  version,
  getOperation,
  decide,
  refreshTree,
  children,
}: {
  readonly runId: string | undefined;
  readonly version: number;
  readonly getOperation: ChatAwaiting['getOperation'];
  readonly decide: ChatAwaiting['decide'];
  readonly refreshTree: () => void;
  readonly children: ReactNode;
}) {
  const pendingOperationId = useAuiState((state) => {
    const last = state.thread.messages.at(-1);
    if (last?.role !== 'assistant') return undefined;
    const part = last.parts.find(
      (part) =>
        part.type === 'tool-call' &&
        part.approval !== undefined &&
        part.approval.approved === undefined &&
        part.approval.resolution === undefined &&
        part.result === undefined,
    );
    return part?.type === 'tool-call'
      ? (part.approval as { id?: string } | undefined)?.id
      : undefined;
  });
  const metadataAwaiting = useAuiState((state) => {
    const last = state.thread.messages.at(-1);
    if (last?.role !== 'assistant') return false;
    const custom = last.metadata?.custom as { status?: unknown } | undefined;
    return custom?.status === 'awaiting_approval';
  });
  const pendingOperation = getOperation(pendingOperationId);
  const pending =
    pendingOperationId !== undefined &&
    !isDecidedOperationStatus(pendingOperation?.status)
      ? pendingOperationId
      : undefined;
  const value = useMemo<ChatAwaiting>(
    () => ({
      paused: metadataAwaiting || pending !== undefined,
      runId,
      pendingOperationId: pending,
      version,
      getOperation,
      decide,
      refreshTree,
    }),
    [
      metadataAwaiting,
      pending,
      runId,
      version,
      getOperation,
      decide,
      refreshTree,
    ],
  );
  return (
    <ChatAwaitingContext.Provider value={value}>
      {children}
    </ChatAwaitingContext.Provider>
  );
}

function mergeOperationRecord(
  previous: ChatOperationRecord | undefined,
  update: StreamOperationUpdate | ChatOperationRecord,
): ChatOperationRecord {
  if (!previous) return { ...update } as ChatOperationRecord;
  let changed = false;
  const next: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (key === 'status') continue;
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  if (update.status !== undefined && update.status !== previous.status) {
    // A stale tree or re-emitted event must not reopen a decided op.
    const downgrade =
      isDecidedOperationStatus(previous.status) &&
      (update.status === 'awaiting_approval' || update.status === 'pending');
    if (!downgrade) {
      next.status = update.status;
      changed = true;
    }
  }
  return changed ? (next as unknown as ChatOperationRecord) : previous;
}

type ChatComposerCancelProps = Omit<
  ComponentProps<typeof ComposerPrimitive.Cancel>,
  'onClick'
>;

export function ChatComposerCancel(props: ChatComposerCancelProps) {
  const stop = useContext(ChatStopContext);
  const [failed, setFailed] = useState(false);
  if (!stop)
    throw new Error('ChatComposerCancel must be used inside ChatRuntime.');
  return (
    <>
      <Button
        {...props}
        onClick={(event) => {
          event.preventDefault();
          setFailed(false);
          void stop().catch(() => setFailed(true));
        }}
      />
      {failed ? (
        <span role="alert">
          Unable to stop this response. Please try again.
        </span>
      ) : null}
    </>
  );
}

function toMessageRepository(tree: ChatTree) {
  return {
    headId: tree.viewedLeafId,
    messages: tree.messages.map((message) => ({
      parentId: message.parentId,
      message: toUIMessage(message),
    })),
  };
}

function toCreateChatMessage<UI_MESSAGE extends UIMessage = UIMessage>(
  message: AppendMessage,
): CreateUIMessage<UI_MESSAGE> {
  const textParts = message.content.filter(
    (
      part,
    ): part is Extract<(typeof message.content)[number], { type: 'text' }> =>
      part.type === 'text',
  );
  if (textParts.length !== message.content.length)
    throw new Error('Only text messages are supported in this chat.');
  const sourceId = message.sourceId;
  return {
    id: crypto.randomUUID(),
    role: 'user',
    parts: textParts.map(({ text }) => ({ type: 'text', text })),
    ...(typeof sourceId === 'string'
      ? { metadata: { chatOperation: { type: 'edit', sourceId } } }
      : {}),
  } as CreateUIMessage<UI_MESSAGE>;
}

function toUIMessage(message: ChatMessage): ChatUIMessage {
  if (message.role === 'user')
    return {
      id: message.id,
      role: 'user',
      parts: [{ type: 'text', text: message.text }],
    };
  return {
    id: message.id,
    role: 'assistant',
    parts: [
      ...(message.reasoningSummary
        ? [{ type: 'reasoning' as const, text: message.reasoningSummary }]
        : []),
      ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
      ...message.operations.map(operationToToolPart),
    ],
    metadata: {
      status: message.status,
      reasoningDurationMs: message.reasoningDurationMs,
      feedback: message.feedback,
      loadedFromServer: true,
    },
  };
}

/**
 * Canonical operations render as tool parts so a reloaded tree shows the
 * same rows the live stream built — a pending op restores its docked panel.
 */
function operationToToolPart(
  operation: ChatOperationSnapshot,
): UIMessage['parts'][number] {
  const status = operation.status;
  const denied =
    status === 'rejected' || status === 'dismissed' || status === 'expired';
  const state =
    status === 'awaiting_approval'
      ? ('approval-requested' as const)
      : status === 'approved'
        ? ('approval-responded' as const)
        : denied
          ? ('output-denied' as const)
          : status === 'pending'
            ? ('input-available' as const)
            : ('output-available' as const);
  return {
    type: 'dynamic-tool' as const,
    toolName: operation.toolName,
    toolCallId: operation.operationId,
    state,
    input: operation.input ?? {},
    ...(state === 'output-available' || state === 'output-denied'
      ? { output: operation.output ?? null }
      : {}),
    ...(state === 'approval-requested' || state === 'approval-responded'
      ? {
          approval: {
            id: operation.operationId,
            ...(state === 'approval-responded'
              ? { approved: true as const }
              : {}),
            descriptor: operation,
          },
        }
      : {}),
  } as UIMessage['parts'][number];
}

function findActiveRun(
  tree: ChatTree,
): Extract<ChatMessage, { role: 'assistant' }> | undefined {
  return tree.messages.find(
    (message): message is Extract<ChatMessage, { role: 'assistant' }> =>
      message.role === 'assistant' &&
      (message.status === 'queued' ||
        message.status === 'running' ||
        message.status === 'cancelling' ||
        message.status === 'awaiting_approval'),
  );
}

/**
 * After `import()`, assistant-ui treats the first host message update whose
 * path differs from the imported path as an import-path change; when that
 * update starts a run (Regenerate), it resets the head to the run's parent and
 * prunes the parent's children, deleting the sibling being regenerated.
 * Import with the head at the leaf's parent, then hand the leaf path back as an
 * ordinary host update, so that change is consumed while no run is starting.
 */
function importCanonicalTerminalRepository(
  thread: { import(repository: ExportedMessageRepository): void },
  repository: ExportedMessageRepository,
  setMessages: (messages: ChatUIMessage[]) => void,
): void {
  const entries = new Map(
    repository.messages.map((entry) => [entry.message.id, entry]),
  );
  const head =
    repository.headId === undefined || repository.headId === null
      ? undefined
      : entries.get(repository.headId);
  if (
    !head ||
    head.parentId === null ||
    repository.messages.some((entry) => entry.parentId === head.message.id)
  ) {
    thread.import(repository);
    return;
  }
  const path: ThreadMessage[] = [];
  for (
    let entry: (typeof repository.messages)[number] | undefined = head;
    entry;
    entry = entry.parentId === null ? undefined : entries.get(entry.parentId)
  )
    path.unshift(entry.message);
  thread.import({ ...repository, headId: head.parentId });
  setMessages(
    path.flatMap((message) => getExternalStoreMessages<ChatUIMessage>(message)),
  );
}

function reconcileCanonicalTerminalMessages(
  repository: ExportedMessageRepository,
  tree: ChatTree,
  preferredHeadId?: string | null,
  visibleMessagesBeforeStop?: readonly ThreadMessage[],
): ExportedMessageRepository {
  const canonicalMessages = new Map(
    tree.messages.map((message) => [message.id, message]),
  );
  const messages = repository.messages.map((entry) => {
    const canonical = canonicalMessages.get(entry.message.id);
    if (!canonical || canonical.role !== entry.message.role) return entry;

    if (canonical.role === 'user' && entry.message.role === 'user') {
      const message = fromThreadMessageLike(
        {
          ...entry.message,
          content: [
            { type: 'text', text: canonical.text },
            ...entry.message.content.filter((part) => part.type !== 'text'),
          ],
        },
        entry.message.id,
        { type: 'complete', reason: 'stop' },
      );
      bindExternalStoreMessage(message, toUIMessage(canonical));
      return {
        ...entry,
        message,
      };
    }

    if (canonical.role === 'assistant' && entry.message.role === 'assistant') {
      return {
        ...entry,
        message: toCanonicalAssistantMessage(entry.message, canonical),
      };
    }

    return entry;
  });
  const currentMessageIds = new Set(messages.map((entry) => entry.message.id));
  for (const visibleMessage of visibleMessagesBeforeStop ?? []) {
    const canonical = canonicalMessages.get(visibleMessage.id);
    if (
      visibleMessage.role !== 'assistant' ||
      !canonical ||
      canonical.role !== 'assistant' ||
      canonical.status === 'queued' ||
      canonical.status === 'running' ||
      canonical.status === 'cancelling' ||
      (visibleMessage.metadata.runId !== undefined &&
        visibleMessage.metadata.runId !== canonical.runId) ||
      (canonical.parentId !== null &&
        (!currentMessageIds.has(canonical.parentId) ||
          !canonicalMessages.has(canonical.parentId))) ||
      currentMessageIds.has(visibleMessage.id)
    ) {
      continue;
    }
    messages.push({
      parentId: canonical.parentId,
      message: toCanonicalAssistantMessage(visibleMessage, canonical),
    });
    currentMessageIds.add(visibleMessage.id);
  }
  const headId =
    preferredHeadId !== undefined &&
    preferredHeadId !== null &&
    currentMessageIds.has(preferredHeadId) &&
    canonicalMessages.has(preferredHeadId)
      ? preferredHeadId
      : repository.headId;
  return {
    ...repository,
    ...(headId !== undefined ? { headId } : {}),
    messages,
  };
}

function toCanonicalAssistantMessage(
  message: Extract<ThreadMessage, { role: 'assistant' }>,
  canonical: Extract<ChatMessage, { role: 'assistant' }>,
): ThreadMessage {
  const preservedContent = message.content.filter(
    (part) => part.type !== 'reasoning' && part.type !== 'text',
  );
  // Canonical ops are authoritative: rebuild tool rows from them when the
  // tree carries any, else keep whatever the stream produced.
  const operationContent =
    canonical.operations.length > 0
      ? canonical.operations.map((operation) => {
          const denied =
            operation.status === 'rejected' ||
            operation.status === 'dismissed' ||
            operation.status === 'expired';
          return {
            type: 'tool-call' as const,
            toolName: operation.toolName,
            toolCallId: operation.operationId,
            args: operation.input as never,
            argsText: JSON.stringify(operation.input ?? {}),
            ...(operation.status === 'awaiting_approval' ||
            operation.status === 'approved'
              ? {
                  approval: {
                    id: operation.operationId,
                    ...(operation.status === 'approved'
                      ? { approved: true as const }
                      : {}),
                  },
                }
              : {}),
            ...(denied
              ? {
                  result: { error: 'Tool approval denied' },
                  isError: true as const,
                }
              : operation.output !== undefined
                ? { result: operation.output }
                : {}),
          };
        })
      : preservedContent.filter((part) => part.type === 'tool-call');
  const otherContent = preservedContent.filter(
    (part) => part.type !== 'tool-call',
  );
  const status =
    canonical.status === 'cancelled'
      ? { type: 'incomplete' as const, reason: 'cancelled' as const }
      : canonical.status === 'failed'
        ? { type: 'incomplete' as const, reason: 'error' as const }
        : { type: 'complete' as const, reason: 'stop' as const };
  const reconciled = fromThreadMessageLike(
    {
      ...message,
      content: [
        ...(canonical.reasoningSummary
          ? [
              {
                type: 'reasoning' as const,
                text: canonical.reasoningSummary,
              },
            ]
          : []),
        ...(canonical.text
          ? [{ type: 'text' as const, text: canonical.text }]
          : []),
        ...operationContent,
        ...otherContent,
      ],
      status,
      metadata: {
        ...message.metadata,
        custom: {
          ...message.metadata.custom,
          status: canonical.status,
          reasoningDurationMs: canonical.reasoningDurationMs,
          feedback: canonical.feedback,
          loadedFromServer: true,
        },
      },
    },
    message.id,
    status,
  );
  bindExternalStoreMessage(reconciled, toUIMessage(canonical));
  return reconciled;
}
