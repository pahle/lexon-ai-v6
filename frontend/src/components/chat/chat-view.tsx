'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { ChatRuntime } from './chat-runtime';
import type { ChatApi, ChatTree } from '@lexon/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { MAX_PROMPT_BYTES, promptByteLength } from '@/lib/chat-limits';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeToChatInvalidations } from '@/lib/chat-title-invalidation';

export { MAX_PROMPT_BYTES, promptByteLength } from '@/lib/chat-limits';

export function ChatView({
  chatId,
  actorScope,
  displayName,
  client,
  onNavigate,
  orgId,
  userId,
}: {
  readonly chatId?: string;
  readonly actorScope: string;
  readonly displayName: string;
  readonly client: ChatApi;
  readonly orgId: string;
  readonly userId: string;
  readonly onNavigate?: (path: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tree, setTree] = useState<ChatTree | null>(null);
  const [loading, setLoading] = useState(chatId !== undefined);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState('');
  const [effort, setEffort] = useState<'high' | 'max'>('high');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const bytes = promptByteLength(text);

  useEffect(
    () => subscribeToChatInvalidations(queryClient, { orgId, userId }),
    [orgId, queryClient, userId],
  );

  useEffect(() => {
    if (!chatId) return;
    let mounted = true;
    setLoading(true);
    void client
      .get(chatId)
      .then((next) => {
        if (mounted) setTree(next);
      })
      .catch(() => {
        if (mounted) setLoadError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [chatId, client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value || bytes > MAX_PROMPT_BYTES || sending) return;
    setSending(true);
    setSendError(false);
    try {
      if (!chatId) {
        const result = await client.create({
          chatId: crypto.randomUUID(),
          userMessageId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          text: value,
          effort,
        });
        setText('');
        setEffort('high');
        const path = `/chats/${result.chatId}`;
        if (onNavigate) onNavigate(path);
        else router.push(path);
      }
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  if (chatId && loading)
    return (
      <div
        role="status"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 p-6"
      >
        <span className="sr-only">Loading conversation</span>
        <div className="bg-muted h-9 w-2/5 animate-pulse rounded-xl motion-reduce:animate-none" />
        <div className="bg-muted h-4 w-full animate-pulse rounded motion-reduce:animate-none" />
        <div className="bg-muted h-4 w-4/5 animate-pulse rounded motion-reduce:animate-none" />
      </div>
    );
  if (chatId && loadError)
    return (
      <p role="alert" className="p-6">
        This conversation could not be opened.
      </p>
    );
  if (chatId && tree)
    return (
      <ChatRuntime
        actorScope={actorScope}
        chatId={chatId}
        tree={tree}
        effort={effort}
        onRunId={(runId) => {
          if (runId) setEffort('high');
        }}
        onStreamState={(state) => setReconnecting(state === 'reconnecting')}
      >
        <Thread
          displayName={displayName}
          effort={effort}
          reconnecting={reconnecting}
          onEffortChange={setEffort}
          onFeedback={async (messageId, rating) => {
            try {
              await client.setFeedback(chatId, messageId, { rating });
              toast.success('Thanks for your feedback.');
            } catch {
              toast.error('Feedback could not be saved.');
              throw new Error('Feedback could not be saved.');
            }
          }}
        />
      </ChatRuntime>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
      <div className="mb-6 w-full max-w-3xl">
        <h2 className="font-serif text-2xl font-medium">
          Welcome, {displayName}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Your legal workspace, ready when you are.
        </p>
      </div>
      <form onSubmit={submit} className="w-full max-w-3xl">
        <div className="border-border bg-muted/30 focus-within:border-ring rounded-2xl border p-3">
          <Textarea
            aria-label="Message input"
            placeholder="Ask Lexon about a contract, a regulation, or a case..."
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={3}
            className="max-h-48 min-h-20 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Deep thinking"
                aria-pressed={effort === 'max'}
                onClick={() => setEffort(effort === 'max' ? 'high' : 'max')}
                className="rounded-lg px-2 py-1 text-sm hover:bg-muted"
              >
                Deep thinking
              </button>
              <span className="text-muted-foreground text-xs">
                {MAX_PROMPT_BYTES - bytes} bytes left
              </span>
            </div>
            <Button
              type="submit"
              disabled={!text.trim() || bytes > MAX_PROMPT_BYTES || sending}
            >
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
        {bytes > MAX_PROMPT_BYTES ? (
          <p role="alert" className="text-destructive mt-2 text-sm">
            Messages can be up to 16,384 bytes.
          </p>
        ) : null}
        {sendError ? (
          <p role="alert" className="text-destructive mt-2 text-sm">
            Your message could not be sent. Please try again.
          </p>
        ) : null}
        <p className="text-muted-foreground mt-3 text-center text-xs">
          Lexon can make mistakes. Verify important legal information.
        </p>
      </form>
    </div>
  );
}
