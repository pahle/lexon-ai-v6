'use client';

import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MarkdownText } from '@/components/chat/markdown-text';
import {
  PersistedReasoning,
  type AnswerStatus,
} from '@/components/chat/chat-reasoning';
import { ChatGreeting } from '@/components/chat/chat-greeting';
import {
  ChatComposerCancel,
  useChatActiveRun,
} from '@/components/chat/chat-runtime';
import { composerClasses } from '@/components/chat/composer-styles';
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
  CircleAlertIcon,
  CircleStopIcon,
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
  readonly editingId: string | null;
  readonly setEditingId: (id: string | null) => void;
}>({
  target: null,
  setTarget: () => {},
  editingId: null,
  setEditingId: () => {},
});

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const editFocus = useMemo(
    () => ({
      target: editFocusTarget,
      setTarget: setEditFocusTarget,
      editingId,
      setEditingId,
    }),
    [editFocusTarget, editingId],
  );

  return (
    <EditFocusContext.Provider value={editFocus}>
      <ThreadPrimitive.Root
        className="aui-root aui-thread-root bg-background @container flex min-h-0 min-w-0 flex-1 flex-col"
        style={{
          ['--thread-max-width' as string]: '880px',
          ['--composer-radius' as string]: '20px',
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
            <div
              data-slot="aui_message-group"
              className="mb-14 flex flex-col gap-y-6 empty:hidden"
            >
              <ThreadPrimitive.Messages>
                {() => <ThreadMessage onFeedback={onFeedback} />}
              </ThreadPrimitive.Messages>
            </div>
            {reconnecting ? (
              <p
                role="status"
                aria-live="polite"
                className="text-muted-foreground mb-6 -mt-8 px-2 text-sm"
              >
                Reconnecting…
              </p>
            ) : null}
            <RunAnnouncer />

            <ThreadPrimitive.ViewportFooter
              className={cn(
                'aui-thread-viewport-footer bg-background relative flex flex-col gap-4 overflow-visible pb-4 md:pb-6',
                !isEmpty &&
                  'sticky bottom-0 mt-auto rounded-t-(--composer-radius)',
              )}
            >
              <div
                data-slot="aui_thread-fade"
                aria-hidden="true"
                className="from-background pointer-events-none absolute inset-x-0 -top-8 h-8 bg-linear-to-t to-transparent"
              />
              <ThreadScrollToBottom />
              <Composer effort={effort} onEffortChange={onEffortChange} />
            </ThreadPrimitive.ViewportFooter>
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </EditFocusContext.Provider>
  );
};

/**
 * The thread's single run announcer, mounted for the thread's lifetime. It
 * reads "Thinking" while a run is active and "Answer complete" once it ends,
 * and stays empty for a thread that only ever held completed answers.
 */
const RunAnnouncer: FC = () => {
  const active = useAuiState(
    (state) =>
      state.thread.isRunning ||
      state.thread.messages.some(
        (message) => message.status?.type === 'running',
      ),
  );
  const [text, setText] = useState('');
  const wasActive = useRef(false);
  useEffect(() => {
    if (active) setText('Thinking');
    else if (wasActive.current) setText('Answer complete');
    wasActive.current = active;
  }, [active]);
  return (
    <p
      data-slot="run-announcer"
      role="status"
      aria-live="polite"
      className="sr-only"
    >
      {text}
    </p>
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
  const serverActive = useChatActiveRun();
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
  const answerStatus: AnswerStatus = running
    ? 'running'
    : metadata?.status === 'failed' ||
        (assistantStatus?.type === 'incomplete' &&
          assistantStatus.reason === 'error')
      ? 'failed'
      : metadata?.status === 'cancelled' ||
          (assistantStatus?.type === 'incomplete' &&
            assistantStatus.reason === 'cancelled')
        ? 'stopped'
        : 'complete';
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
        role === 'assistant' &&
          parentId !== null &&
          editFocus.editingId === parentId &&
          'opacity-50',
      )}
    >
      {role === 'assistant' ? (
        <PersistedReasoning
          messageId={messageId}
          status={answerStatus}
          summary={summary}
          durationMs={durationMs}
          answerHasText={answerText.length > 0}
        />
      ) : null}
      <div
        className={cn(
          role === 'user'
            ? 'rounded-2xl bg-(--lexon-user-bubble) px-4 py-2.5'
            : 'text-base leading-[1.75]',
        )}
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
        <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
          <CircleStopIcon className="size-3.5" aria-hidden="true" />
          Stopped
        </div>
      ) : null}
      {role === 'assistant' && metadata?.status === 'failed' ? (
        <ResponseFailed disabled={serverActive} />
      ) : null}
      <MessagePrimitive.Error>
        {metadata?.status === 'failed' ? null : (
          <ResponseFailed disabled={serverActive} />
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
    </MessagePrimitive.Root>
  );
};

const ResponseFailed: FC<{ disabled: boolean }> = ({ disabled }) => (
  <Alert className="mt-3">
    <CircleAlertIcon aria-hidden="true" />
    <AlertTitle>The response could not be completed.</AlertTitle>
    <ActionBarPrimitive.Reload
      aria-label="Try again"
      disabled={disabled}
      render={
        <Button
          variant="outline"
          size="sm"
          className="col-start-2 mt-2 justify-self-start"
        />
      }
    >
      Try again
    </ActionBarPrimitive.Reload>
  </Alert>
);

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
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 left-1/2 z-10 -translate-x-1/2 rounded-full p-4 disabled:invisible"
      />
    }
  >
    <ArrowDownIcon />
  </ThreadPrimitive.ScrollToBottom>
);

const ThreadWelcome: FC<{ displayName: string }> = ({ displayName }) => (
  <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
    <ChatGreeting
      displayName={displayName}
      className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both duration-200"
    />
  </div>
);

const AssistantActions: FC<{
  messageId: string;
  feedback: 'good' | 'bad' | null;
  onFeedback?: ThreadProps['onFeedback'];
}> = ({ messageId, feedback, onFeedback }) => {
  const serverActive = useChatActiveRun();
  const [rating, setRating] = useState<'good' | 'bad' | null>(feedback);
  useEffect(() => setRating(feedback), [feedback]);
  const copied = useAuiState((state) => state.message.isCopied);
  const submitFeedback = (next: 'good' | 'bad') => {
    void Promise.resolve(onFeedback?.(messageId, next))
      .then(() => setRating(next))
      .catch(() => {});
  };
  return (
    <div
      data-slot="aui_message-actions"
      className="text-muted-foreground mt-2 flex items-center gap-1 opacity-100 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100 empty:hidden md:opacity-0 [@media(hover:none)]:opacity-100"
    >
      <ActionBarPrimitive.Root
        hideWhenRunning
        className="flex items-center gap-1"
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
          disabled={serverActive}
        >
          <RefreshCwIcon className="size-4" />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
      <BranchPicker />
    </div>
  );
};

const UserEditAction = () => {
  const serverActive = useChatActiveRun();
  return (
    <ActionBarPrimitive.Root hideWhenRunning className="mt-1">
      <ActionBarPrimitive.Edit
        className="size-9 rounded-md p-2 text-muted-foreground hover:bg-muted"
        aria-label="Edit message"
        disabled={serverActive}
      >
        <PencilIcon className="size-4" />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

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
  const serverActive = useChatActiveRun();
  const [tooLong, setTooLong] = useState(false);
  const editFocus = useContext(EditFocusContext);
  const { setEditingId } = editFocus;
  useEffect(() => {
    setEditingId(messageId);
    return () => setEditingId(null);
  }, [messageId, setEditingId]);
  const validateAndArmEdit = (event: { preventDefault: () => void }) => {
    if (serverActive) {
      event.preventDefault();
      return;
    }
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
      data-slot="aui_user-edit-bubble"
      className="my-2 ms-auto flex w-full max-w-[80%] flex-col gap-2 rounded-2xl bg-(--lexon-user-bubble) px-4 py-2.5"
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
      <div className="flex items-center justify-end gap-2">
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
        <ComposerPrimitive.Send
          render={
            <Button
              aria-label="Send edit"
              size="sm"
              disabled={serverActive}
              onClick={validateAndArmEdit}
            >
              Send
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
  const serverActive = useChatActiveRun();
  const running =
    useAuiState((state) => state.thread.isRunning) || serverActive;
  const composerText = useAuiState((state) => state.composer.text);
  const tooLong = promptByteLength(composerText) > MAX_PROMPT_BYTES;
  const validatePrompt = (event: FormEvent<HTMLFormElement>) => {
    if (serverActive) {
      event.preventDefault();
      return;
    }
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
      <div data-slot="aui_composer-shell" className={composerClasses.shell}>
        <ComposerPrimitive.Input
          placeholder={
            running
              ? 'Lexon is answering…'
              : 'Ask Lexon about a contract, a regulation, or a case...'
          }
          className={cn(
            'aui-composer-input caret-primary',
            composerClasses.input,
          )}
          rows={1}
          addAttachmentOnPaste={false}
          submitMode="enter"
          enterKeyHint="send"
          aria-label="Message input"
        />
        <div
          className={cn(
            'aui-composer-action-wrapper relative',
            composerClasses.toolbar,
          )}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    composerClasses.deepThinking,
                    effort === 'max' && composerClasses.deepThinkingPressed,
                  )}
                  aria-label="Deep thinking"
                  aria-pressed={effort === 'max'}
                  onClick={() =>
                    onEffortChange?.(effort === 'max' ? 'high' : 'max')
                  }
                />
              }
            >
              <BrainIcon aria-hidden="true" /> Deep thinking
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Deep thinking: takes longer and uses more of your budget.
            </TooltipContent>
          </Tooltip>
          {running ? (
            <ChatComposerCancel
              render={
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className={cn('aui-composer-send', composerClasses.stop)}
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
                  className={cn('aui-composer-send', composerClasses.send)}
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
