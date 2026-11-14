'use client';

import { useEffect, useState } from 'react';
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { ChatTreeSchema, UuidSchema } from '@lexon/contracts';
import type { ChatTree } from '@lexon/contracts';
import {
  ChatComposerCancel,
  ChatRuntime,
} from '@/components/chat/chat-runtime';

export default function ChatRuntimeProofPage() {
  const [chatId, setChatId] = useState<string>();
  const [actorScope, setActorScope] = useState<string>();
  const [tree, setTree] = useState<ChatTree>();
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const parsedChatId = UuidSchema.safeParse(query.get('chatId'));
    if (!parsedChatId.success) {
      setError('A valid chat ID is required.');
      return;
    }
    setChatId(parsedChatId.data);
    void Promise.all([
      fetch('/api/identity', { credentials: 'same-origin', cache: 'no-store' }),
      fetch(`/api/chats/${parsedChatId.data}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    ])
      .then(async ([identityResponse, chatResponse]) => {
        if (!identityResponse.ok || !chatResponse.ok)
          throw new Error('Chat access failed.');
        const identity = (await identityResponse.json()) as {
          user: { id: string };
          organization: { id: string };
        };
        const parsedTree = ChatTreeSchema.safeParse(await chatResponse.json());
        if (!parsedTree.success) throw new Error('Chat data is invalid.');
        setActorScope(`${identity.organization.id}:${identity.user.id}`);
        setTree(parsedTree.data);
      })
      .catch(() => setError('Chat access failed.'));
  }, []);

  if (error) return <main role="alert">{error}</main>;
  if (!chatId || !actorScope || !tree)
    return <main role="status">Loading chat</main>;
  const selectedAssistant = tree.messages.find(
    (
      message,
    ): message is Extract<
      ChatTree['messages'][number],
      { role: 'assistant' }
    > => message.role === 'assistant' && message.id === tree.viewedLeafId,
  );

  return (
    <main
      data-testid="seed-inspection"
      data-actor-scope={actorScope}
      data-viewed-leaf-id={tree.viewedLeafId ?? ''}
      data-assistant-id={selectedAssistant?.id ?? ''}
      data-assistant-status={selectedAssistant?.status ?? ''}
    >
      <h1>Runtime proof</h1>
      <ChatRuntime
        actorScope={actorScope}
        chatId={chatId}
        tree={tree}
        onRunId={setRunId}
      >
        <ThreadPrimitive.Root>
          <output data-testid="active-run-id">{runId ?? ''}</output>
          <ThreadPrimitive.Messages>
            {() => <ProofMessage />}
          </ThreadPrimitive.Messages>
          <RuntimeProofControls />
          <ComposerPrimitive.Root onSubmit={(event) => event.preventDefault()}>
            <ComposerPrimitive.Input aria-label="Message" submitMode="none" />
            <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
            <ChatComposerCancel>Stop</ChatComposerCancel>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </ChatRuntime>
    </main>
  );
}

export function RuntimeProofControls() {
  const aui = useAui();
  const messages = useAuiState((state) => state.thread.messages);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const [editText, setEditText] = useState('Edited prompt');
  const lastUser = [...messages]
    .reverse()
    .find((message) => message.role === 'user');
  const rootUser = messages.find((message) => message.role === 'user');
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  const edit = (id: string | undefined) => {
    if (!id) return;
    const composer = aui.thread.message({ id }).composer();
    composer.beginEdit();
    composer.setText(editText);
    void composer.send();
  };
  return (
    <aside data-testid="proof-controls">
      <output data-testid="runtime-is-running">{String(isRunning)}</output>
      <output data-testid="runtime-visible-leaf">
        {messages.at(-1)?.id ?? ''}
      </output>
      <label>
        Edit prompt
        <input
          aria-label="Proof edit prompt"
          value={editText}
          onChange={(event) => setEditText(event.target.value)}
        />
      </label>
      <button
        type="button"
        data-testid="proof-edit"
        disabled={!lastUser || isRunning}
        onClick={() => edit(lastUser?.id)}
      >
        Edit last user
      </button>
      <button
        type="button"
        data-testid="proof-edit-root"
        disabled={!rootUser || isRunning}
        onClick={() => edit(rootUser?.id)}
      >
        Edit root user
      </button>
      <button
        type="button"
        data-testid="proof-regenerate"
        disabled={!lastAssistant || isRunning}
        onClick={() => {
          if (lastAssistant)
            void aui.thread.message({ id: lastAssistant.id }).reload();
        }}
      >
        Regenerate last answer
      </button>
    </aside>
  );
}

export function ProofMessage() {
  const id = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const content = useAuiState((state) => state.message.content);
  const metadata = useAuiState((state) => state.message.metadata);
  const branchNumber = useAuiState((state) => state.message.branchNumber);
  const branchCount = useAuiState((state) => state.message.branchCount);
  const reasoningDurationMs = metadata.custom.reasoningDurationMs;
  return (
    <article
      data-message-id={id}
      data-role={role}
      data-branch-number={branchNumber}
      data-branch-count={branchCount}
      data-part-state={JSON.stringify(
        content.map((part) => ({
          type: part.type,
          textLength:
            'text' in part && typeof part.text === 'string'
              ? part.text.length
              : undefined,
        })),
      )}
      data-text-content={content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')}
      data-reasoning-content={content
        .filter((part) => part.type === 'reasoning')
        .map((part) => part.text)
        .join('')}
      data-reasoning-duration-ms={
        typeof reasoningDurationMs === 'number'
          ? String(reasoningDurationMs)
          : ''
      }
    >
      <MessagePrimitive.Parts />
      {role === 'assistant' && typeof reasoningDurationMs === 'number' && (
        <output data-testid="reasoning-duration-label">
          {reasoningDurationMs} ms
        </output>
      )}
      {role === 'assistant' && (
        <>
          <ActionBarPrimitive.Reload>Try again</ActionBarPrimitive.Reload>
          <BranchPickerPrimitive.Root hideWhenSingleBranch>
            <BranchPickerPrimitive.Previous aria-label="Previous answer">
              Previous
            </BranchPickerPrimitive.Previous>
            <BranchPickerPrimitive.Count />
            <BranchPickerPrimitive.Next aria-label="Next answer">
              Next
            </BranchPickerPrimitive.Next>
          </BranchPickerPrimitive.Root>
        </>
      )}
    </article>
  );
}
