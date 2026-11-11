'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { useAISDKRuntime } from '@assistant-ui/ai-sdk';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import type { AppendMessage } from '@assistant-ui/react';
import type { CreateUIMessage, UIMessage } from 'ai';
import type { ChatMessage, ChatTree } from '@lexon/contracts';
import { createChatClient } from '@/lib/chat-client';
import { LexonChatTransport, type ChatUIMessage } from '@/lib/chat-transport';

export interface ChatRuntimeProps {
  readonly actorScope: string;
  readonly chatId: string;
  readonly tree: ChatTree;
  readonly effort?: 'high' | 'max';
  readonly children: ReactNode;
  readonly onRunId?: (runId: string | undefined) => void;
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
  onRunId,
  onStopReady,
}: ChatRuntimeProps) {
  const [runId, setRunId] = useState<string | undefined>(
    () => findActiveRun(tree)?.runId,
  );
  const onRunIdRef = useRef(onRunId);
  const onStopReadyRef = useRef(onStopReady);
  useEffect(() => {
    onRunIdRef.current = onRunId;
  }, [onRunId]);
  useEffect(() => {
    onStopReadyRef.current = onStopReady;
  }, [onStopReady]);

  const handleRunId = useCallback((nextRunId: string | undefined) => {
    setRunId(nextRunId);
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
      const persisted = client
        .setViewedLeaf(chatId, { leafId: headId })
        .then(() => undefined);
      transport.selectLeaf(headId, persisted);
    },
  });

  useEffect(() => {
    transport.setEffort(effort);
  }, [effort, transport]);

  const initialRunId = activeRun?.runId;
  const resumedRunRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialRunId || resumedRunRef.current === initialRunId) return;
    if (!chat.messages.some((message) => message.id === activeRun?.id)) return;
    resumedRunRef.current = initialRunId;
    void chat.resumeStream();
  }, [activeRun?.id, chat.messages, chat.resumeStream, initialRunId]);

  const stop = useCallback(async () => {
    await transport.stopRun();
    await chat.stop();
  }, [chat.stop, transport]);
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
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
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
    },
  };
}

function findActiveRun(
  tree: ChatTree,
): Extract<ChatMessage, { role: 'assistant' }> | undefined {
  return tree.messages.find(
    (message): message is Extract<ChatMessage, { role: 'assistant' }> =>
      message.role === 'assistant' &&
      message.id === tree.viewedLeafId &&
      (message.status === 'queued' || message.status === 'running'),
  );
}
