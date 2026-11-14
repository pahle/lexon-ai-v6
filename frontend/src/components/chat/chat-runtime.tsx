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
} from '@assistant-ui/react';
import type {
  AppendMessage,
  ExportedMessageRepository,
  ThreadMessage,
} from '@assistant-ui/react';
import type { CreateUIMessage, UIMessage } from 'ai';
import type { ChatMessage, ChatTree } from '@lexon/contracts';
import { Button } from '@/components/ui/button';
import { createChatClient } from '@/lib/chat-client';
import { LexonChatTransport, type ChatUIMessage } from '@/lib/chat-transport';

const ChatStopContext = createContext<(() => Promise<void>) | null>(null);
const ChatActiveRunContext = createContext(false);

export function useChatActiveRun(): boolean {
  return useContext(ChatActiveRunContext);
}

export interface ChatRuntimeProps {
  readonly actorScope: string;
  readonly chatId: string;
  readonly tree: ChatTree;
  readonly effort?: 'high' | 'max';
  readonly children: ReactNode;
  readonly onTreeRefresh?: () => Promise<ChatTree>;
  readonly onTreeUpdate?: (tree: ChatTree) => void;
  readonly onRunId?: (runId: string | undefined) => void;
  readonly onStreamState?: (state: 'reconnecting' | 'connected') => void;
  readonly onStopReady?: (stop: () => Promise<void>) => void;
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
  const selectedLeafIdRef = useRef(tree.viewedLeafId);
  const onRunIdRef = useRef(onRunId);
  const onStreamStateRef = useRef(onStreamState);
  const onStopReadyRef = useRef(onStopReady);
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
  const transport = useMemo(
    () =>
      new LexonChatTransport({
        baseUrl: '/api',
        chatId,
        actorScope,
        selectedLeafId: tree.viewedLeafId,
        effort,
        onStreamState: (state) => onStreamStateRef.current?.(state),
        ...(activeRun ? { initialRunId: activeRun.runId } : {}),
        onRunId: handleRunId,
      }),
    [actorScope, chatId],
  );

  const repository = useMemo(() => toMessageRepository(tree), [tree]);
  const createMessage = useCallback(toCreateChatMessage, []);

  const chat = useChat<ChatUIMessage>({
    id: chatId,
    resume: false,
    transport,
  });
  const chatStatusRef = useRef(chat.status);
  chatStatusRef.current = chat.status;
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
      selectedLeafIdRef.current = headId;
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
    transport.syncActiveRun(activeRun?.runId);
    if (activeRun) {
      setServerActiveRunId(activeRun.runId);
      setRunId(activeRun.runId);
    }
  }, [activeRun?.runId, transport]);

  useEffect(() => {
    if (!serverActiveRunId || !onTreeRefresh) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const freshTree = await onTreeRefresh();
        if (!active) return;
        const selectedLeafId = selectedLeafIdRef.current;
        const refreshedTree =
          selectedLeafId !== null &&
          freshTree.messages.some((message) => message.id === selectedLeafId)
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
          const selectedLeafBeforeStop = selectedLeafIdRef.current;
          const sdkRunIsActive =
            chatStatusRef.current === 'submitted' ||
            chatStatusRef.current === 'streaming';
          transport.invalidateActiveRunStream();
          if (sdkRunIsActive) await chat.stop();
          if (!active) return;
          const currentThreadRuntime = threadRuntimeRef.current;
          if (currentThreadRuntime) {
            const currentRepository = currentThreadRuntime.export();
            const branchChangedDuringStop =
              selectedLeafIdRef.current !== selectedLeafBeforeStop;
            currentThreadRuntime.import(
              reconcileCanonicalTerminalMessages(
                currentRepository,
                freshTree,
                branchChangedDuringStop
                  ? currentRepository.headId
                  : visibleLeafBeforeStop,
                visibleMessagesBeforeStop,
              ),
            );
          }
          setServerActiveRunId(undefined);
          setRunId(undefined);
          transport.syncActiveRun(undefined);
        }
      } catch {
        // Keep controls locked until an authoritative refresh succeeds.
      }
      if (active) timer = window.setTimeout(() => void refresh(), 1_000);
    };
    timer = window.setTimeout(() => void refresh(), 1_000);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [chat.stop, onTreeRefresh, onTreeUpdate, serverActiveRunId, transport]);

  const initialRunId = activeRun?.runId;
  const resumedRunRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialRunId || resumedRunRef.current === initialRunId) return;
    if (!chat.messages.some((message) => message.id === activeRun?.id)) return;
    resumedRunRef.current = initialRunId;
    void chat.resumeStream();
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
          {children}
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
    ],
    metadata: {
      status: message.status,
      reasoningDurationMs: message.reasoningDurationMs,
      feedback: message.feedback,
      loadedFromServer: true,
    },
  };
}

function findActiveRun(
  tree: ChatTree,
): Extract<ChatMessage, { role: 'assistant' }> | undefined {
  return tree.messages.find(
    (message): message is Extract<ChatMessage, { role: 'assistant' }> =>
      message.role === 'assistant' &&
      (message.status === 'queued' ||
        message.status === 'running' ||
        message.status === 'cancelling'),
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
        ...preservedContent,
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
