'use client';

import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { ChatSkeleton } from '@/components/chat/chat-skeleton';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AnswerDimmedContext,
  HideAnswerPulseContext,
  MarkdownText,
} from '@/components/chat/markdown-text';
import {
  PersistedReasoning,
  showsThinkingLabel,
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
  ArrowUpIcon,
  Brain as BrainIcon,
  CheckIcon,
  CircleAlertIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  WifiIcon,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
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
          scrollToBottomOnInitialize={false}
          scrollToBottomOnThreadSwitch={false}
          data-slot="aui_thread-viewport"
          className="relative flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
        >
          <div
            className={cn(
              'mx-auto flex min-h-0 w-full max-w-(--thread-max-width) flex-1 flex-col px-6 pt-6 max-md:px-4 max-md:pt-4',
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
              className="flex flex-col gap-8 empty:hidden max-md:gap-[22px]"
            >
              <ThreadPrimitive.Messages>
                {() => (
                  <ThreadMessage
                    onFeedback={onFeedback}
                    reconnecting={reconnecting}
                  />
                )}
              </ThreadPrimitive.Messages>
            </div>
            {reconnecting ? (
              <p
                role="status"
                aria-live="polite"
                className="text-muted-foreground mt-4 flex items-center gap-2 text-base leading-[1.6] max-md:text-[15px]"
              >
                <WifiIcon className="size-[18px]" aria-hidden="true" />
                Connection lost. Reconnecting…
              </p>
            ) : null}
            <RunAnnouncer />
            <OpenAtLastUserMessage />
            {isEmpty ? null : (
              <div aria-hidden="true" className="h-10 shrink-0 max-md:h-0" />
            )}

            <ThreadPrimitive.ViewportFooter
              className={cn(
                'aui-thread-viewport-footer bg-background relative flex flex-col overflow-visible pb-3.5 max-md:-mx-0.5 max-md:pt-2.5 max-md:pb-3',
                !isEmpty &&
                  'sticky bottom-0 mt-auto rounded-t-(--composer-radius)',
              )}
            >
              <div
                data-slot="aui_thread-fade"
                aria-hidden="true"
                className="from-background pointer-events-none absolute inset-x-0 -top-10 h-10 bg-linear-to-t to-transparent"
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
 * Opening a thread places its last user message at the top of the viewport:
 * not the top of the thread and not the end of the answer (it keeps the
 * thread's top padding above it). It runs once per
 * mounted thread, when its history first has messages, and never again, so
 * live streaming and the scroll-to-bottom button keep their own behavior. A
 * short tail cannot scroll that far; the viewport then rests at its end.
 */
const OpenAtLastUserMessage: FC = () => {
  const hasMessages = useAuiState((state) => state.thread.messages.length > 0);
  const placed = useRef(false);
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!hasMessages || placed.current) return;
    const viewport = marker.current?.closest<HTMLElement>(
      '[data-slot="aui_thread-viewport"]',
    );
    if (!viewport) return;
    const users = viewport.querySelectorAll<HTMLElement>('[data-role="user"]');
    const target = users[users.length - 1];
    if (!target) return;
    placed.current = true;
    // The message rests under the thread's top padding, as it does when the
    // whole thread fits (LEX-DS-001 v3.1 §5.5), not flush with the viewport.
    const padding =
      Number.parseFloat(
        getComputedStyle(marker.current?.parentElement ?? viewport).paddingTop,
      ) || 0;
    const delta =
      target.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      padding;
    const previous = viewport.style.scrollBehavior;
    viewport.style.scrollBehavior = 'auto';
    viewport.scrollTop += delta;
    viewport.style.scrollBehavior = previous;
  }, [hasMessages]);
  return <span ref={marker} hidden />;
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
  <ChatSkeleton className="animate-in fade-in fill-mode-both [animation-delay:150ms] [animation-duration:200ms]" />
);

const ThreadMessage: FC<Pick<ThreadProps, 'onFeedback' | 'reconnecting'>> = ({
  onFeedback,
  reconnecting = false,
}) => {
  const serverActive = useChatActiveRun();
  const role = useAuiState((state) => state.message.role);
  const messageId = useAuiState((state) => state.message.id);
  const branched = useAuiState((state) => state.message.branchCount > 1);
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
  const isLast = useAuiState((state) => state.message.isLast);
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
  // The answer under an open edit reads as dimmed through the muted text
  // color (it meets WCAG contrast), not opacity or inert: the answer stays
  // readable and operable for every user while the edit is open.
  const dimmed =
    role === 'assistant' &&
    parentId !== null &&
    editFocus.editingId === parentId;
  return (
    <MessagePrimitive.Root
      data-slot={`aui_${role}-message-root`}
      data-role={role}
      data-message-id={messageId}
      className={cn(
        'group/turn wrap-break-word',
        role === 'user'
          ? 'ms-auto flex max-w-[80%] flex-col items-end gap-1 max-md:max-w-[88%]'
          : 'flex flex-col gap-3',
        dimmed ? 'text-muted-foreground' : 'text-foreground',
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
            ? 'rounded-[20px] bg-(--lexon-user-bubble) px-[18px] py-3 text-base leading-[1.6] max-md:text-[15px] [&_p]:mb-0'
            : 'flex flex-col gap-3 text-base leading-[1.75] max-md:text-[15px]',
        )}
        aria-live="off"
      >
        <AnswerDimmedContext.Provider value={dimmed}>
          <HideAnswerPulseContext.Provider
            value={
              reconnecting ||
              showsThinkingLabel(
                answerStatus,
                summary,
                durationMs,
                answerText.length > 0,
              )
            }
          >
            <MessagePrimitive.Parts
              components={{ Text: MarkdownText, Reasoning: () => null }}
            />
          </HideAnswerPulseContext.Provider>
        </AnswerDimmedContext.Provider>
      </div>
      {role === 'assistant' &&
      (metadata?.status === 'cancelled' ||
        (assistantStatus?.type === 'incomplete' &&
          assistantStatus.reason === 'cancelled')) ? (
        <p className="text-muted-foreground mt-1 text-base leading-[1.6] max-md:text-[15px]">
          You stopped this response.
        </p>
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
          alwaysVisible={isLast || answerStatus === 'stopped'}
          feedback={
            metadata?.feedback === 'good' || metadata?.feedback === 'bad'
              ? metadata.feedback
              : null
          }
          onFeedback={onFeedback}
        />
      ) : (
        <div
          className={cn(
            '-mt-1 flex min-h-7 items-center gap-0.5 opacity-100 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100',
            !branched && 'md:opacity-0',
          )}
        >
          <BranchPicker />
          <UserEditAction />
        </div>
      )}
    </MessagePrimitive.Root>
  );
};

const ResponseFailed: FC<{ disabled: boolean }> = ({ disabled }) => (
  <div
    role="alert"
    className="bg-muted border-border flex items-center gap-3 rounded-xl border py-2.5 pr-2.5 pl-3.5 text-[15px] leading-normal"
  >
    <CircleAlertIcon
      className="text-muted-foreground size-[18px] shrink-0"
      aria-hidden="true"
    />
    <span className="flex-1">The response could not be completed.</span>
    <ActionBarPrimitive.Reload
      aria-label="Try again"
      disabled={disabled}
      render={<Button variant="outline" className="shrink-0" />}
    >
      <RefreshCwIcon className="size-3.5" aria-hidden="true" />
      Try again
    </ActionBarPrimitive.Reload>
  </div>
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
        variant="ghost"
        className="aui-thread-scroll-to-bottom bg-background text-muted-foreground hover:bg-background absolute top-0 left-1/2 z-10 size-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-0 p-0 shadow-[0_0_0_1px_var(--border),0_6px_16px_-6px_rgba(8,6,6,.25)] max-md:top-[22px] disabled:invisible dark:hover:bg-background [&_svg]:size-[18px]"
      />
    }
  >
    <ChevronDownIcon />
  </ThreadPrimitive.ScrollToBottom>
);

const ThreadWelcome: FC<{ displayName: string }> = ({ displayName }) => (
  <div className="aui-thread-welcome-root mb-6 flex flex-col">
    <ChatGreeting
      displayName={displayName}
      className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both duration-200"
    />
  </div>
);

const ACTION_BUTTON =
  'size-8 rounded-lg p-0 text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent';
const ACTION_ON = 'text-(--lexon-red-text)';

const AssistantActions: FC<{
  messageId: string;
  alwaysVisible: boolean;
  feedback: 'good' | 'bad' | null;
  onFeedback?: ThreadProps['onFeedback'];
}> = ({ messageId, alwaysVisible, feedback, onFeedback }) => {
  const serverActive = useChatActiveRun();
  const [rating, setRating] = useState<'good' | 'bad' | null>(feedback);
  useEffect(() => setRating(feedback), [feedback]);
  const copied = useAuiState((state) => state.message.isCopied);
  const branched = useAuiState((state) => state.message.branchCount > 1);
  const submitFeedback = (next: 'good' | 'bad') => {
    void Promise.resolve(onFeedback?.(messageId, next))
      .then(() => setRating(next))
      .catch(() => {});
  };
  return (
    <div
      data-slot="aui_message-actions"
      className={cn(
        'text-muted-foreground -mt-1 -ml-2 flex items-center gap-0.5 opacity-100 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100 empty:hidden [@media(hover:none)]:opacity-100',
        !alwaysVisible && !branched && 'md:opacity-0',
      )}
    >
      <BranchPicker />
      <ActionBarPrimitive.Root
        hideWhenRunning
        className="flex items-center gap-0.5"
      >
        <ActionBarPrimitive.Copy
          render={
            <TooltipIconButton
              tooltip={copied ? 'Copied' : 'Copy'}
              side="top"
              sideOffset={6}
              className={cn(ACTION_BUTTON, copied && ACTION_ON)}
              aria-label={copied ? 'Copied' : 'Copy answer'}
            />
          }
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </ActionBarPrimitive.Copy>
        <TooltipIconButton
          tooltip="Good response"
          side="top"
          sideOffset={6}
          type="button"
          aria-label="Good answer"
          aria-pressed={rating === 'good'}
          onClick={() => submitFeedback('good')}
          className={cn(ACTION_BUTTON, rating === 'good' && ACTION_ON)}
        >
          <ThumbsUpIcon className={cn(rating === 'good' && 'fill-current')} />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Bad response"
          side="top"
          sideOffset={6}
          type="button"
          aria-label="Bad answer"
          aria-pressed={rating === 'bad'}
          onClick={() => submitFeedback('bad')}
          className={cn(ACTION_BUTTON, rating === 'bad' && ACTION_ON)}
        >
          <ThumbsDownIcon className={cn(rating === 'bad' && 'fill-current')} />
        </TooltipIconButton>
        <ActionBarPrimitive.Reload
          disabled={serverActive}
          render={
            <TooltipIconButton
              tooltip="Regenerate"
              side="top"
              sideOffset={6}
              className={ACTION_BUTTON}
              aria-label="Regenerate answer"
            />
          }
        >
          <RefreshCwIcon />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </div>
  );
};

const UserEditAction = () => {
  const serverActive = useChatActiveRun();
  return (
    <ActionBarPrimitive.Root hideWhenRunning>
      <ActionBarPrimitive.Edit
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md"
        aria-label="Edit message"
        disabled={serverActive}
      >
        <PencilIcon className="size-3.5" />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const BranchPicker: FC<{ className?: string }> = ({ className }) => (
  <BranchPickerPrimitive.Root
    hideWhenSingleBranch
    className={cn(
      'text-muted-foreground inline-flex items-center gap-0.5 text-xs',
      className,
    )}
  >
    <BranchPickerPrimitive.Previous
      aria-label="Previous branch"
      className="hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md disabled:opacity-40"
    >
      <ChevronLeftIcon className="size-3.5" />
    </BranchPickerPrimitive.Previous>
    <span>
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
    </span>
    <BranchPickerPrimitive.Next
      aria-label="Next branch"
      className="hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md disabled:opacity-40"
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
      className="flex flex-col gap-2.5 self-stretch"
      onSubmit={validateAndArmEdit}
    >
      <div
        data-slot="aui_user-edit-box"
        className="border-ring bg-background ring-ring/18 rounded-2xl border px-4 py-3.5 ring-3"
      >
        <ComposerPrimitive.Input
          aria-label="Edit message input"
          autoFocus
          rows={2}
          addAttachmentOnPaste={false}
          submitMode="none"
          className="box-content block min-h-[52px] w-full resize-none bg-transparent px-0.5 pt-[3px] pb-0.5 text-base leading-[1.55] outline-none max-md:box-border max-md:min-h-[100px] max-md:text-[15px]"
        />
      </div>
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
              onClick={() =>
                editFocus.setTarget({
                  sourceId: messageId,
                  parentId,
                  waitForReplacement: false,
                })
              }
            >
              Cancel
            </Button>
          }
        />
        <ComposerPrimitive.Send
          render={
            <Button
              aria-label="Save"
              disabled={serverActive}
              onClick={validateAndArmEdit}
            >
              Save
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
                  variant="ghost"
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
            <TooltipContent side="bottom" align="start" sideOffset={8}>
              Takes longer and uses more of your budget
            </TooltipContent>
          </Tooltip>
          {running ? (
            <ChatComposerCancel
              render={
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className={cn(
                    'aui-composer-send [&_svg]:size-4',
                    composerClasses.stop,
                  )}
                  aria-label="Stop generating"
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="currentColor"
                  >
                    <rect x="7" y="7" width="10" height="10" rx="1.5" />
                  </svg>
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
                  <ArrowUpIcon className="aui-composer-send-icon" />
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
      <p className={composerClasses.disclaimer}>
        Lexon can make mistakes. Verify important legal information.
      </p>
    </ComposerPrimitive.Root>
  );
};
