'use client';

import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { ChatRuntime } from './chat-runtime';
import type { ChatApi, ChatTree } from '@lexon/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { MAX_PROMPT_BYTES, promptByteLength } from '@/lib/chat-limits';
import { ArrowUpIcon, Brain as BrainIcon } from 'lucide-react';
import { consumeChatSearchHighlight } from '@/lib/chat-search-highlight';
import { ChatClientError } from '@/lib/chat-errors';
import { WorkspaceNotFound } from '@/components/states/workspace-not-found';
import { useWorkspace } from '@/components/shell/workspace-provider';

export { MAX_PROMPT_BYTES, promptByteLength } from '@/lib/chat-limits';

type ChatViewProps = {
  readonly chatId?: string;
  readonly actorScope: string;
  readonly displayName: string;
  readonly client: ChatApi;
  readonly orgId: string;
  readonly userId: string;
  readonly onNavigate?: (path: string) => void;
};

export function ChatView(props: ChatViewProps) {
  return (
    <ChatViewSession
      key={`${props.actorScope}:${props.chatId ?? 'new'}`}
      {...props}
    />
  );
}

function ChatViewSession({
  chatId,
  actorScope,
  displayName,
  client,
  onNavigate,
}: ChatViewProps) {
  const router = useRouter();
  const { setChatTitle } = useWorkspace();
  const [tree, setTree] = useState<ChatTree | null>(null);
  const [loading, setLoading] = useState(chatId !== undefined);
  const [loadError, setLoadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [text, setText] = useState('');
  const [effort, setEffort] = useState<'high' | 'max'>('high');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const bytes = promptByteLength(text);

  useEffect(() => {
    if (!chatId) return;
    let mounted = true;
    setLoading(true);
    void client
      .get(chatId)
      .then((next) => {
        if (mounted) setTree(next);
      })
      .catch((error: unknown) => {
        if (mounted && error instanceof ChatClientError && error.status === 404)
          setNotFound(true);
        else if (mounted) setLoadError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [chatId, client]);

  useEffect(() => {
    if (chatId && tree) setChatTitle(chatId, actorScope, tree.title);
  }, [actorScope, chatId, setChatTitle, tree]);

  useEffect(() => {
    if (!chatId || loading || !tree) return;
    const messageId = consumeChatSearchHighlight(chatId);
    if (!messageId) return;
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(messageId)}"]`,
      );
      if (!target) return;
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      target.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      });
      target.dataset.searchHighlight = 'true';
      target.classList.add(
        'outline',
        'outline-2',
        'outline-ring',
        'rounded-lg',
      );
      window.setTimeout(() => {
        delete target.dataset.searchHighlight;
        target.classList.remove(
          'outline',
          'outline-2',
          'outline-ring',
          'rounded-lg',
        );
      }, 2_000);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [chatId, loading, tree]);

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
  if (chatId && notFound) return <WorkspaceNotFound />;
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
            rows={1}
            className="max-h-48 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="flex flex-nowrap items-center justify-between gap-3 pt-2">
            <div className="flex min-w-0 flex-nowrap items-center gap-3">
              <Button
                type="button"
                variant={effort === 'max' ? 'secondary' : 'outline'}
                size="sm"
                className="rounded-full"
                aria-label="Deep thinking"
                aria-pressed={effort === 'max'}
                onClick={() => setEffort(effort === 'max' ? 'high' : 'max')}
              >
                <BrainIcon aria-hidden="true" /> Deep thinking
              </Button>
              {bytes >= MAX_PROMPT_BYTES - 512 && bytes <= MAX_PROMPT_BYTES ? (
                <span className="text-muted-foreground shrink-0 whitespace-nowrap text-xs">
                  {MAX_PROMPT_BYTES - bytes} bytes left
                </span>
              ) : null}
            </div>
            <TooltipIconButton
              tooltip="Send message"
              type="submit"
              disabled={!text.trim() || bytes > MAX_PROMPT_BYTES || sending}
              variant="default"
              size="icon"
              className="size-9 shrink-0 rounded-full"
              aria-label="Send message"
            >
              <ArrowUpIcon className="size-4" />
            </TooltipIconButton>
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
