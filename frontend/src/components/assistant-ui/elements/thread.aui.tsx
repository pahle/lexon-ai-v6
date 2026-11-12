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
  Brain as BrainIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  XIcon,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FC,
  type FormEvent,
} from 'react';

const EditFocusContext = createContext<{
  readonly target: {
    sourceId: string;
    parentId: string | null;
    waitForReplacement: boolean;
  } | null;
  readonly setTarget: (
    target: {
      sourceId: string;
      parentId: string | null;
      waitForReplacement: boolean;
    } | null,
  ) => void;
}>({ target: null, setTarget: () => {} });

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
  const [editFocusTarget, setEditFocusTarget] = useState<{
    sourceId: string;
    parentId: string | null;
    waitForReplacement: boolean;
  } | null>(null);
  const editFocus = useMemo(
    () => ({ target: editFocusTarget, setTarget: setEditFocusTarget }),
    [editFocusTarget],
  );

  return (
    <EditFocusContext.Provider value={editFocus}>
      <ThreadPrimitive.Root
        className="aui-root aui-thread-root bg-background @container flex min-h-0 min-w-0 flex-1 flex-col"
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
          className="relative flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
        >
          <div
            className={cn(
              'mx-auto flex min-h-0 w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4',
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
    </EditFocusContext.Provider>
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
    const metadata = state.message.metadata as { custom?: unknown } | undefined;
    const custom = metadata?.custom;
    const value =
      custom && typeof custom === 'object'
        ? (custom as { reasoningDurationMs?: unknown }).reasoningDurationMs
        : undefined;
    return typeof value === 'number' ? value : null;
  });
  const running = useAuiState(
    (state) => state.message.status?.type === 'running',
  );
  const assistantStatus = useAuiState((state) => state.message.status);
  const editing = useAuiState((state) => state.message.composer.isEditing);
  const messagePosition = useAuiState((state) =>
    state.thread.messages.findIndex((message) => message.id === messageId),
  );
  const parentId = useAuiState((state) => state.message.parentId);
  const threadRunning = useAuiState((state) => state.thread.isRunning);
  const editFocus = useContext(EditFocusContext);
  useEffect(() => {
    if (
      editing ||
      threadRunning ||
      role !== 'user' ||
      messagePosition < 0 ||
      editFocus.target?.parentId !== parentId ||
      editFocus.target.waitForReplacement ===
        (editFocus.target.sourceId === messageId)
    )
      return;
    requestAnimationFrame(() => {
      const button = document.querySelector<HTMLButtonElement>(
        `[data-message-id="${messageId}"] [aria-label="Edit message"]`,
      );
      button?.focus();
      if (button === document.activeElement) editFocus.setTarget(null);
    });
  }, [
    editFocus,
    editing,
    messageId,
    messagePosition,
    parentId,
    role,
    threadRunning,
  ]);
  const metadata = useAuiState((state) => {
    const custom = (state.message.metadata as { custom?: unknown } | undefined)
      ?.custom;
    return custom && typeof custom === 'object'
      ? (custom as {
          status?: unknown;
          feedback?: unknown;
          loadedFromServer?: unknown;
        })
      : undefined;
  });
  const loadedFromServer = metadata?.loadedFromServer === true;
  const answerText = useAuiState((state) =>
    state.message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  );
  const announcement = useIncrementalAnnouncement(
    messageId,
    answerText,
    running,
    running && !loadedFromServer,
  );
  if (editing)
    return <ThreadEditComposer messageId={messageId} parentId={parentId} />;
  return (
    <MessagePrimitive.Root
      data-slot={`aui_${role}-message-root`}
      data-role={role}
      data-message-id={messageId}
      className={cn(
        'group/turn text-foreground px-2 leading-relaxed wrap-break-word',
        role === 'user' && 'ms-auto max-w-[80%] px-0',
      )}
    >
      {role === 'assistant' ? (
        <PersistedReasoning
          summary={summary}
          durationMs={durationMs}
          answerHasText={answerText.length > 0}
          running={running}
        />
      ) : null}
      {role === 'assistant' && running ? (
        <span role="status" aria-live="polite" className="sr-only">
          Lexon is responding.
        </span>
      ) : null}
      <div
        className={cn(role === 'user' && 'rounded-2xl bg-muted px-4 py-2.5')}
        aria-live="off"
      >
        <MessagePrimitive.Parts
          components={{ Text: MarkdownText, Reasoning: () => null }}
        />
      </div>
      {role === 'assistant' &&
      (metadata?.status === 'cancelled' ||
        (assistantStatus?.type === 'incomplete' &&
          assistantStatus.reason === 'cancelled')) ? (
        <span className="text-muted-foreground text-xs">Stopped</span>
      ) : null}
      {role === 'assistant' && metadata?.status === 'failed' ? (
        <div
          role="alert"
          className="text-destructive mt-3 rounded-lg border border-destructive/40 p-3 text-sm"
        >
          The response could not be completed.{' '}
          <ActionBarPrimitive.Reload
            aria-label="Try again"
            className="underline"
          >
            Try again
          </ActionBarPrimitive.Reload>
        </div>
      ) : null}
      <MessagePrimitive.Error>
        {metadata?.status === 'failed' ? null : (
          <div
            role="alert"
            className="text-destructive mt-3 rounded-lg border border-destructive/40 p-3 text-sm"
          >
            The response could not be completed.{' '}
            <ActionBarPrimitive.Reload
              aria-label="Try again"
              className="underline"
            >
              Try again
            </ActionBarPrimitive.Reload>
          </div>
        )}
      </MessagePrimitive.Error>
      {role === 'assistant' && announcement.active ? (
        <p className="sr-only" aria-live="polite" aria-atomic="false">
          <span key={announcement.sequence}>{announcement.text}</span>
        </p>
      ) : null}
      {role === 'assistant' ? (
        <AssistantActions
          messageId={messageId}
          feedback={
            metadata?.feedback === 'good' || metadata?.feedback === 'bad'
              ? metadata.feedback
              : null
          }
          onFeedback={onFeedback}
        />
      ) : (
        <div className="mt-1 flex items-center gap-2 opacity-100 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100 md:opacity-0 [@media(hover:none)]:opacity-100">
          <UserEditAction />
          <BranchPicker />
        </div>
      )}
      {role === 'assistant' ? (
        <div className="mt-1 flex items-center gap-2 opacity-100 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100 md:opacity-0 [@media(hover:none)]:opacity-100">
          <BranchPicker />
        </div>
      ) : null}
    </MessagePrimitive.Root>
  );
};

const announcementSegmentLength = 160;
const announcementSegmentIntervalMs = 500;

function announcementSegmentEnd(text: string, start: number) {
  const end = Math.min(start + announcementSegmentLength, text.length);
  if (end < text.length) {
    const previous = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (
      previous >= 0xd800 &&
      previous <= 0xdbff &&
      next >= 0xdc00 &&
      next <= 0xdfff
    )
      return end - 1;
  }
  return end;
}

type AnnouncementQueue = {
  messageId: string;
  cursor: number;
  latestText: string;
  running: boolean;
  sequence: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type IncrementalAnnouncement = {
  messageId: string;
  text: string;
  sequence: number;
  active: boolean;
};

export function useIncrementalAnnouncement(
  messageId: string,
  text: string,
  running: boolean,
  initialTextIsNew = false,
): IncrementalAnnouncement {
  const queueRef = useRef<AnnouncementQueue | null>(null);
  if (queueRef.current?.messageId !== messageId) {
    queueRef.current = {
      messageId,
      cursor: initialTextIsNew ? 0 : text.length,
      latestText: text,
      running,
      sequence: 0,
      timer: null,
    };
  }
  const [announcement, setAnnouncement] = useState<IncrementalAnnouncement>(
    () => ({
      messageId,
      text: '',
      sequence: 0,
      active: running,
    }),
  );

  useEffect(() => {
    const queue = queueRef.current;
    if (!queue || queue.messageId !== messageId) return;
    const contentWasReplaced =
      text.length < queue.latestText.length ||
      !text.startsWith(queue.latestText);
    if (contentWasReplaced) {
      if (queue.timer !== null) clearTimeout(queue.timer);
      queue.timer = null;
      queue.cursor = 0;
      queue.sequence += 1;
      setAnnouncement({
        messageId,
        text: '',
        sequence: queue.sequence,
        active: running,
      });
    }
    queue.latestText = text;
    queue.running = running;

    const emitNext = () => {
      if (queueRef.current !== queue) return;
      queue.timer = null;
      if (queue.cursor < queue.latestText.length) {
        const end = announcementSegmentEnd(queue.latestText, queue.cursor);
        const segment = queue.latestText.slice(queue.cursor, end);
        queue.cursor += segment.length;
        queue.sequence += 1;
        setAnnouncement({
          messageId,
          text: segment,
          sequence: queue.sequence,
          active: true,
        });
        queue.timer = setTimeout(emitNext, announcementSegmentIntervalMs);
      } else if (!queue.running) {
        setAnnouncement({
          messageId,
          text: '',
          sequence: queue.sequence,
          active: false,
        });
      }
    };

    if (queue.timer === null) {
      if (queue.cursor < queue.latestText.length) {
        emitNext();
      } else {
        setAnnouncement((current) =>
          current.messageId === messageId && current.active === running
            ? current
            : {
                messageId,
                text: '',
                sequence: queue.sequence,
                active: running,
              },
        );
      }
    }
  }, [messageId, running, text]);

  useEffect(() => {
    const queue = queueRef.current;
    return () => {
      if (queue?.timer !== null && queue?.timer !== undefined)
        clearTimeout(queue.timer);
    };
  }, [messageId]);

  return announcement.messageId === messageId
    ? announcement
    : { messageId, text: '', sequence: 0, active: running };
}

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
  feedback: 'good' | 'bad' | null;
  onFeedback?: ThreadProps['onFeedback'];
}> = ({ messageId, feedback, onFeedback }) => {
  const [rating, setRating] = useState<'good' | 'bad' | null>(feedback);
  useEffect(() => setRating(feedback), [feedback]);
  const copied = useAuiState((state) => state.message.isCopied);
  const submitFeedback = (next: 'good' | 'bad') => {
    void Promise.resolve(onFeedback?.(messageId, next))
      .then(() => setRating(next))
      .catch(() => {});
  };
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      className="text-muted-foreground mt-2 flex items-center gap-1 opacity-100 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100 md:opacity-0 [@media(hover:none)]:opacity-100"
    >
      <ActionBarPrimitive.Copy
        className="size-9 rounded-md p-2 hover:bg-muted"
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
        className="size-9 rounded-md p-2 hover:bg-muted aria-pressed:bg-accent"
      >
        <ThumbsUpIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Bad answer"
        aria-pressed={rating === 'bad'}
        onClick={() => submitFeedback('bad')}
        className="size-9 rounded-md p-2 hover:bg-muted aria-pressed:bg-accent"
      >
        <ThumbsDownIcon className="size-4" />
      </button>
      <ActionBarPrimitive.Reload
        className="size-9 rounded-md p-2 hover:bg-muted"
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
      className="size-9 rounded-md p-2 text-muted-foreground hover:bg-muted"
      aria-label="Edit message"
    >
      <PencilIcon className="size-4" />
    </ActionBarPrimitive.Edit>
  </ActionBarPrimitive.Root>
);

const BranchPicker: FC<{ className?: string }> = ({ className }) => (
  <BranchPickerPrimitive.Root
    hideWhenSingleBranch
    className={cn(
      'text-muted-foreground inline-flex items-center gap-1 text-sm',
      className,
    )}
  >
    <BranchPickerPrimitive.Previous
      aria-label="Previous branch"
      className="size-9 rounded-md p-2 hover:bg-muted"
    >
      <ChevronLeftIcon className="size-3.5" />
    </BranchPickerPrimitive.Previous>
    <span>
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
    </span>
    <BranchPickerPrimitive.Next
      aria-label="Next branch"
      className="size-9 rounded-md p-2 hover:bg-muted"
    >
      <ChevronRightIcon className="size-3.5" />
    </BranchPickerPrimitive.Next>
  </BranchPickerPrimitive.Root>
);

const ThreadEditComposer: FC<{
  messageId: string;
  parentId: string | null;
}> = ({ messageId, parentId }) => {
  const [tooLong, setTooLong] = useState(false);
  const editFocus = useContext(EditFocusContext);
  const validateAndArmEdit = (event: { preventDefault: () => void }) => {
    const input = document.querySelector<HTMLTextAreaElement>(
      '[aria-label="Edit message input"]',
    );
    const invalid = promptByteLength(input?.value ?? '') > MAX_PROMPT_BYTES;
    setTooLong(invalid);
    if (invalid) event.preventDefault();
    else
      editFocus.setTarget({
        sourceId: messageId,
        parentId,
        waitForReplacement: true,
      });
  };
  return (
    <ComposerPrimitive.Root
      className="my-2 flex flex-col gap-2"
      onSubmit={validateAndArmEdit}
    >
      <ComposerPrimitive.Input
        aria-label="Edit message input"
        autoFocus
        rows={3}
        addAttachmentOnPaste={false}
        submitMode="none"
        className="border-input bg-background focus-visible:ring-ring min-h-20 w-full resize-y rounded-lg border px-3 py-2 outline-none focus-visible:ring-2"
      />
      {tooLong ? (
        <p role="alert" className="text-destructive text-sm">
          Messages can be up to 16,384 bytes.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <ComposerPrimitive.Send
          render={
            <Button
              aria-label="Save edit"
              size="sm"
              onClick={validateAndArmEdit}
            >
              Save
            </Button>
          }
        />
        <ComposerPrimitive.Cancel
          render={
            <Button
              type="button"
              aria-label="Cancel edit"
              variant="outline"
              size="sm"
              onClick={() =>
                editFocus.setTarget({
                  sourceId: messageId,
                  parentId,
                  waitForReplacement: false,
                })
              }
            >
              <XIcon aria-hidden="true" />
              Cancel
            </Button>
          }
        />
      </div>
    </ComposerPrimitive.Root>
  );
};

const Composer: FC<Pick<ThreadProps, 'effort' | 'onEffortChange'>> = ({
  effort = 'high',
  onEffortChange,
}) => {
  const running = useAuiState((state) => state.thread.isRunning);
  const composerText = useAuiState((state) => state.composer.text);
  const tooLong = promptByteLength(composerText) > MAX_PROMPT_BYTES;
  const validatePrompt = (event: FormEvent<HTMLFormElement>) => {
    if (
      !composerText.trim() ||
      promptByteLength(composerText) > MAX_PROMPT_BYTES
    )
      event.preventDefault();
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
          placeholder={
            running
              ? 'Lexon is answering…'
              : 'Ask Lexon about a contract, a regulation, or a case...'
          }
          className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
          rows={1}
          addAttachmentOnPaste={false}
          submitMode="enter"
          enterKeyHint="send"
          aria-label="Message input"
        />
        <div className="aui-composer-action-wrapper relative flex flex-nowrap items-center justify-between gap-3">
          <Button
            type="button"
            variant={effort === 'max' ? 'secondary' : 'outline'}
            size="sm"
            className="shrink-0 whitespace-nowrap"
            aria-label="Deep thinking"
            aria-pressed={effort === 'max'}
            onClick={() => onEffortChange?.(effort === 'max' ? 'high' : 'max')}
          >
            <BrainIcon aria-hidden="true" /> Deep thinking
          </Button>
          {running ? (
            <ChatComposerCancel
              render={
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className="aui-composer-send size-7 rounded-full"
                  aria-label="Stop generating"
                >
                  <SquareIcon className="size-4" aria-hidden="true" />
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
                  disabled={tooLong || !composerText.trim()}
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
      <p className="text-muted-foreground mt-3 text-center text-xs">
        Lexon can make mistakes. Verify important legal information.
      </p>
    </ComposerPrimitive.Root>
  );
};
