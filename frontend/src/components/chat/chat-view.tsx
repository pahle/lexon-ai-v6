'use client';

import { Textarea } from '@/components/ui/textarea';
import { ChatSkeleton } from '@/components/chat/chat-skeleton';
import { PlaceholderHighlightTextarea } from '@/components/chat/placeholder-highlight-textarea';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { ChatRuntime } from './chat-runtime';
import type { ChatApi, ChatTree } from '@lexon/contracts';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { toast } from 'sonner';
import { MAX_PROMPT_BYTES, promptByteLength } from '@/lib/chat-limits';
import { ArrowUpIcon, Brain as BrainIcon } from 'lucide-react';
import { consumeChatSearchHighlight } from '@/lib/chat-search-highlight';
import { ChatClientError } from '@/lib/chat-errors';
import { WorkspaceNotFound } from '@/components/states/workspace-not-found';
import { useWorkspace } from '@/components/shell/workspace-provider';
import { chatListQueryKey } from '@/lib/chat-queries';
import { composerClasses } from '@/components/chat/composer-styles';
import { cn } from 'cn';
import { ChatGreeting } from '@/components/chat/chat-greeting';
import { StarterPills } from '@/components/chat/starter-pills';

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

type PendingCreateIdentity = {
  readonly chatId: string;
  readonly userMessageId: string;
  readonly requestId: string;
  readonly text: string;
  readonly effort: 'high' | 'max';
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
  orgId,
  userId,
  onNavigate,
}: ChatViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setChatTitle, chatTitleRefreshVersion } = useWorkspace();
  const titleRequestVersion = useRef(0);
  const observedTitleRefreshVersion = useRef(chatTitleRefreshVersion);
  const [tree, setTree] = useState<ChatTree | null>(null);
  const [loading, setLoading] = useState(chatId !== undefined);
  const [loadError, setLoadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [text, setText] = useState('');
  const [effort, setEffort] = useState<'high' | 'max'>('high');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCreateIdentity = useRef<PendingCreateIdentity | null>(null);
  const bytes = promptByteLength(text);
  const refreshActiveTree = useCallback(() => {
    if (!chatId) throw new Error('This conversation is not available.');
    return client.get(chatId);
  }, [chatId, client]);
  const updateCanonicalTree = useCallback((nextTree: ChatTree) => {
    setTree(nextTree);
  }, []);

  useEffect(() => {
    if (!chatId) return;
    let mounted = true;
    const requestVersion = ++titleRequestVersion.current;
    setLoading(true);
    void client
      .get(chatId)
      .then((next) => {
        if (mounted) {
          setTree(next);
          if (requestVersion === titleRequestVersion.current)
            setChatTitle(chatId, actorScope, next.title);
        }
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
  }, [actorScope, chatId, client, setChatTitle]);

  useEffect(() => {
    if (
      !chatId ||
      chatTitleRefreshVersion === observedTitleRefreshVersion.current
    )
      return;
    observedTitleRefreshVersion.current = chatTitleRefreshVersion;
    let current = true;
    const requestVersion = ++titleRequestVersion.current;
    void client
      .get(chatId)
      .then((next) => {
        if (current && requestVersion === titleRequestVersion.current)
          setChatTitle(chatId, actorScope, next.title);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [actorScope, chatId, chatTitleRefreshVersion, client, setChatTitle]);

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
        const pending = pendingCreateIdentity.current;
        const identity =
          pending?.text === value && pending.effort === effort
            ? pending
            : {
                chatId: crypto.randomUUID(),
                userMessageId: crypto.randomUUID(),
                requestId: crypto.randomUUID(),
                text: value,
                effort,
              };
        pendingCreateIdentity.current = identity;
        const result = await client.create({
          chatId: identity.chatId,
          userMessageId: identity.userMessageId,
          requestId: identity.requestId,
          text: value,
          effort,
        });
        if (pendingCreateIdentity.current === identity)
          pendingCreateIdentity.current = null;
        void queryClient.invalidateQueries({
          queryKey: chatListQueryKey({ orgId, userId }),
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
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-[880px] flex-1 px-6 pt-6 max-md:px-4 max-md:pt-4">
          <ChatSkeleton />
        </div>
        <div className={composerClasses.wrapper}>
          <div
            data-slot="aui_thread-fade"
            aria-hidden="true"
            className="from-background pointer-events-none absolute inset-x-0 -top-10 h-10 bg-linear-to-t to-transparent"
          />
          <div data-slot="aui_composer-shell" className={composerClasses.shell}>
            <Textarea
              aria-label="Message input"
              placeholder="Ask Lexon about a contract, a regulation, or a case..."
              disabled
              rows={1}
              className={cn(
                composerClasses.input,
                'cursor-not-allowed border-0 shadow-none focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:disabled:bg-transparent',
              )}
            />
            <div className={cn(composerClasses.toolbar)}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled
                className={cn(
                  composerClasses.deepThinking,
                  'disabled:opacity-100',
                )}
                aria-label="Deep thinking"
                aria-pressed={false}
              >
                <BrainIcon aria-hidden="true" /> Deep thinking
              </Button>
              <Button
                type="button"
                disabled
                size="icon"
                className={composerClasses.send}
                aria-label="Send message"
              >
                <ArrowUpIcon />
              </Button>
            </div>
          </div>
          <p className={composerClasses.disclaimer}>
            Lexon can make mistakes. Verify important legal information.
          </p>
        </div>
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
        onTreeRefresh={refreshActiveTree}
        onTreeUpdate={updateCanonicalTree}
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
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[22px] pb-20 max-md:pb-[79px]">
      <ChatGreeting displayName={displayName} />
      <form onSubmit={submit} className={composerClasses.wrapper}>
        <div data-slot="aui_composer-shell" className={composerClasses.shell}>
          <PlaceholderHighlightTextarea
            ref={textareaRef}
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
            className={cn(
              composerClasses.input,
              'border-0 shadow-none focus-visible:ring-0',
            )}
          />
          <div className={cn(composerClasses.toolbar)}>
            <div className="flex min-w-0 flex-nowrap items-center gap-3">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        composerClasses.deepThinking,
                        effort === 'max' && composerClasses.deepThinkingPressed,
                      )}
                      aria-label="Deep thinking"
                      aria-pressed={effort === 'max'}
                      onClick={() =>
                        setEffort(effort === 'max' ? 'high' : 'max')
                      }
                    />
                  }
                >
                  <BrainIcon aria-hidden="true" /> Deep thinking
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" sideOffset={8}>
                  Takes longer and uses more of your budget
                </TooltipContent>
              </Tooltip>
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
              className={composerClasses.send}
              aria-label="Send message"
            >
              <ArrowUpIcon />
            </TooltipIconButton>
          </div>
        </div>
        <p className={cn(composerClasses.disclaimer, 'leading-4')}>
          Lexon can make mistakes. Verify important legal information.
        </p>
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
      </form>
      <div className="mt-3.5 w-full max-w-[880px] max-md:mt-[13px]">
        <StarterPills
          textareaRef={textareaRef}
          value={text}
          onValueChange={setText}
          disabled={sending}
        />
      </div>
    </div>
  );
}
