'use client';

import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { MarkdownText } from '@/components/chat/markdown-text';
import { PersistedReasoning } from '@/components/chat/chat-reasoning';
import { ChatComposerCancel } from '@/components/chat/chat-runtime';
import { MAX_PROMPT_BYTES, promptByteLength } from '@/lib/chat-limits';
import { cn } from '@/lib/utils';
import {
  AuiIf,
  ComposerPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AssistantState,
  useAuiState,
} from '@assistant-ui/react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import {
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FC,
  type FormEvent,
} from 'react';

export type ThreadProps = {
  displayName: string;
  effort?: 'high' | 'max';
  onEffortChange?: ((effort: 'high' | 'max') => void) | undefined;
  onFeedback?:
    | ((messageId: string, rating: 'good' | 'bad') => Promise<void> | void)
    | undefined;
  reconnecting?: boolean | undefined;
};

const preventFileDrop = (event: DragEvent<HTMLFormElement>) => {
  if (event.dataTransfer.files.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
};

const preventFilePaste = (event: ClipboardEvent<HTMLFormElement>) => {
  const hasFiles =
    event.clipboardData.files.length > 0 ||
    Array.from(event.clipboardData.items).some((item) => item.kind === 'file');
  if (!hasFiles) return;
  event.preventDefault();
  event.stopPropagation();
};

const isNewChatView = (state: AssistantState) =>
  state.thread.messages.length === 0 &&
  (!state.thread.isLoading || state.threads.isLoading);

const isHistoryLoadingView = (state: AssistantState) =>
  state.thread.messages.length === 0 &&
  state.thread.isLoading &&
  !state.thread.isDisabled &&
  !state.threads.isLoading;

export const Thread: FC<ThreadProps> = ({
  displayName,
  effort = 'high',
  onEffortChange,
  onFeedback,
  reconnecting = false,
}) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ['--thread-max-width' as string]: '44rem',
        ['--composer-bg' as string]:
          'color-mix(in oklab, var(--color-muted) 30%, transparent)',
        ['--composer-radius' as string]: '1rem',
        ['--composer-padding' as string]: '8px',
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div
          className={cn(
            'mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4',
            isEmpty && 'justify-center',
          )}
        >
          <AuiIf condition={isNewChatView}>
            <ThreadWelcome displayName={displayName} />
          </AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <ThreadHistorySkeleton />
          </AuiIf>
          {reconnecting ? (
            <p
              role="status"
              aria-live="polite"
              className="text-muted-foreground mb-3 text-sm"
            >
              Reconnecting…
            </p>
          ) : null}

          <div
            data-slot="aui_message-group"
            className="mb-14 flex flex-col gap-y-6 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage onFeedback={onFeedback} />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              'aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-4 md:pb-6',
              !isEmpty &&
                'sticky bottom-0 mt-auto rounded-t-(--composer-radius)',
            )}
          >
            <ThreadScrollToBottom />
            <Composer effort={effort} onEffortChange={onEffortChange} />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadHistorySkeleton: FC = () => (
  <div
    data-slot="aui_thread-history-skeleton"
    role="status"
    className="animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms] [animation-duration:200ms]"
  >
    <span className="sr-only">Loading conversation</span>
    <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
    </div>
  </div>
);

const ThreadMessage: FC<Pick<ThreadProps, 'onFeedback'>> = ({ onFeedback }) => {
  const role = useAuiState((state) => state.message.role);
  const messageId = useAuiState((state) => state.message.id);
  const summary = useAuiState(
    (state) =>
      state.message.parts.find((part) => part.type === 'reasoning')?.text ??
      null,
  );
  const durationMs = useAuiState((state) => {
    const value = (
      state.message.metadata as { reasoningDurationMs?: unknown } | undefined
    )?.reasoningDurationMs;
    return typeof value === 'number' ? value : null;
  });
  const running = useAuiState(
    (state) => state.message.status?.type === 'running',
  );
  const metadata = useAuiState(
    (state) => state.message.metadata as { status?: unknown } | undefined,
  );
  return (
    <MessagePrimitive.Root
      data-slot={`aui_${role}-message-root`}
      data-role={role}
      className={cn(
        'text-foreground px-2 leading-relaxed wrap-break-word',
        role === 'user' &&
          'ms-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2.5',
      )}
    >
      {role === 'assistant' ? (
        <PersistedReasoning
          summary={summary}
          durationMs={durationMs}
          running={running && summary === null}
        />
      ) : null}
      {role === 'assistant' && running ? (
        <span role="status" aria-live="polite" className="sr-only">
          Lexon is responding.
        </span>
      ) : null}
      <div aria-live="off">
        <MessagePrimitive.Parts
          components={{ Text: MarkdownText, Reasoning: () => null }}
        />
      </div>
      {role === 'assistant' && metadata?.status === 'stopped' ? (
        <span className="text-muted-foreground text-xs">Stopped</span>
      ) : null}
      {role === 'assistant' ? (
        <AssistantActions messageId={messageId} onFeedback={onFeedback} />
      ) : (
        <UserEditAction />
      )}
      {role === 'user' ? <BranchPicker /> : null}
      <MessagePrimitive.Error>
        <div
          role="alert"
          className="text-destructive mt-3 rounded-lg border border-destructive/40 p-3 text-sm"
        >
          The response could not be completed.{' '}
          <ActionBarPrimitive.Reload className="underline">
            Try again
          </ActionBarPrimitive.Reload>
        </div>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => (
  <ThreadPrimitive.ScrollToBottom
    render={
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      />
    }
  >
    <ArrowDownIcon />
  </ThreadPrimitive.ScrollToBottom>
);

const ThreadWelcome: FC<{ displayName: string }> = ({ displayName }) => (
  <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
    <h2 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-serif text-2xl font-medium tracking-tight duration-200">
      Welcome, {displayName}
    </h2>
    <p className="text-muted-foreground mt-2 text-sm">
      Your legal workspace, ready when you are.
    </p>
  </div>
);

const AssistantActions: FC<{
  messageId: string;
  onFeedback?: ThreadProps['onFeedback'];
}> = ({ messageId, onFeedback }) => {
  const [rating, setRating] = useState<'good' | 'bad' | null>(null);
  const copied = useAuiState((state) => state.message.isCopied);
  const submitFeedback = (next: 'good' | 'bad') => {
    void Promise.resolve(onFeedback?.(messageId, next)).then(() =>
      setRating(next),
    );
  };
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      className="text-muted-foreground mt-2 flex items-center gap-1"
    >
      <ActionBarPrimitive.Copy
        className="rounded-md p-1.5 hover:bg-muted"
        aria-label="Copy answer"
      >
        {copied ? (
          <CheckIcon className="size-4" />
        ) : (
          <CopyIcon className="size-4" />
        )}
      </ActionBarPrimitive.Copy>
      <button
        type="button"
        aria-label="Good answer"
        aria-pressed={rating === 'good'}
        onClick={() => submitFeedback('good')}
        className="rounded-md p-1.5 hover:bg-muted aria-pressed:bg-accent"
      >
        <ThumbsUpIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Bad answer"
        aria-pressed={rating === 'bad'}
        onClick={() => submitFeedback('bad')}
        className="rounded-md p-1.5 hover:bg-muted aria-pressed:bg-accent"
      >
        <ThumbsDownIcon className="size-4" />
      </button>
      <ActionBarPrimitive.Reload
        className="rounded-md p-1.5 hover:bg-muted"
        aria-label="Regenerate answer"
      >
        <RefreshCwIcon className="size-4" />
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const UserEditAction = () => (
  <ActionBarPrimitive.Root hideWhenRunning className="mt-1">
    <ActionBarPrimitive.Edit
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
      aria-label="Edit message"
    >
      <PencilIcon className="size-4" />
    </ActionBarPrimitive.Edit>
  </ActionBarPrimitive.Root>
);

const BranchPicker = () => (
  <BranchPickerPrimitive.Root className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs">
    <BranchPickerPrimitive.Previous
      aria-label="Previous branch"
      className="rounded p-1 hover:bg-muted"
    >
      <ChevronLeftIcon className="size-3.5" />
    </BranchPickerPrimitive.Previous>
    <span>
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
    </span>
    <BranchPickerPrimitive.Next
      aria-label="Next branch"
      className="rounded p-1 hover:bg-muted"
    >
      <ChevronRightIcon className="size-3.5" />
    </BranchPickerPrimitive.Next>
  </BranchPickerPrimitive.Root>
);

const Composer: FC<Pick<ThreadProps, 'effort' | 'onEffortChange'>> = ({
  effort = 'high',
  onEffortChange,
}) => {
  const running = useAuiState((state) => state.thread.isRunning);
  const composerText = useAuiState((state) => state.composer.text);
  const [tooLong, setTooLong] = useState(false);
  const validatePrompt = (event: FormEvent<HTMLFormElement>) => {
    const invalid = promptByteLength(composerText) > MAX_PROMPT_BYTES;
    setTooLong(invalid);
    if (invalid) event.preventDefault();
  };
  return (
    <ComposerPrimitive.Root
      className="aui-composer-root relative flex w-full flex-col"
      onDrop={preventFileDrop}
      onDragOver={preventFileDrop}
      onPaste={preventFilePaste}
      onSubmit={validatePrompt}
    >
      <div
        data-slot="aui_composer-shell"
        className="border-foreground/10 focus-within:border-foreground/25 flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color]"
      >
        <ComposerPrimitive.Input
          placeholder="Ask Lexon about a contract, a regulation, or a case..."
          className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
          rows={1}
          addAttachmentOnPaste={false}
          submitMode="enter"
          enterKeyHint="send"
          aria-label="Message input"
        />
        <div className="aui-composer-action-wrapper relative flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Deep thinking"
            aria-pressed={effort === 'max'}
            onClick={() => onEffortChange?.(effort === 'max' ? 'high' : 'max')}
          >
            Deep thinking
          </Button>
          {running ? (
            <ChatComposerCancel
              render={
                <Button type="button" variant="outline" size="sm">
                  Stop
                </Button>
              }
            />
          ) : (
            <ComposerPrimitive.Send
              render={
                <TooltipIconButton
                  tooltip="Send message"
                  side="bottom"
                  type="button"
                  variant="default"
                  size="icon"
                  className="aui-composer-send size-7 rounded-full"
                  aria-label="Send message"
                >
                  <ArrowUpIcon className="aui-composer-send-icon size-4" />
                </TooltipIconButton>
              }
            />
          )}
        </div>
        {tooLong ? (
          <p role="alert" className="text-destructive px-2 text-sm">
            Messages can be up to 16,384 bytes.
          </p>
        ) : null}
      </div>
    </ComposerPrimitive.Root>
  );
};
