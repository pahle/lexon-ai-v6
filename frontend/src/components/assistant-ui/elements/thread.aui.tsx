'use client';

import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AssistantState,
  useAuiState,
} from '@assistant-ui/react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from 'lucide-react';
import type { ClipboardEvent, DragEvent, FC } from 'react';

export type ThreadProps = { displayName: string };

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

export const Thread: FC<ThreadProps> = ({ displayName }) => {
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

          <div
            data-slot="aui_message-group"
            className="mb-14 flex flex-col gap-y-6 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
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
            <Composer />
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

const ThreadMessage: FC = () => {
  const role = useAuiState((state) => state.message.role);
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
      <MessagePrimitive.Parts />
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

const Composer: FC = () => (
  <ComposerPrimitive.Root
    className="aui-composer-root relative flex w-full flex-col"
    onDrop={preventFileDrop}
    onDragOver={preventFileDrop}
    onPaste={preventFilePaste}
    onSubmit={(event) => {
      event.preventDefault();
      event.stopPropagation();
    }}
  >
    <div
      data-slot="aui_composer-shell"
      className="border-foreground/10 focus-within:border-foreground/25 flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color]"
    >
      <ComposerPrimitive.Input
        placeholder="Ask Lexon about a contract, a regulation, or a case..."
        className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
        rows={1}
        submitMode="none"
        addAttachmentOnPaste={false}
        enterKeyHint="send"
        aria-label="Message input"
      />
      <div className="aui-composer-action-wrapper relative flex items-center justify-between">
        <TooltipIconButton
          tooltip="Chat is coming soon"
          type="button"
          variant="ghost"
          size="icon"
          className="aui-composer-add-attachment text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-7 rounded-full motion-reduce:transition-none"
          aria-label="Add Attachment"
          aria-disabled="true"
          disabled
          focusableWhenDisabled
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <PlusIcon className="aui-attachment-add-icon size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Chat is coming soon"
          side="bottom"
          type="button"
          variant="default"
          size="icon"
          className="aui-composer-send size-7 rounded-full"
          aria-label="Send message"
          aria-disabled="true"
          disabled
          focusableWhenDisabled
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <ArrowUpIcon className="aui-composer-send-icon size-4" />
        </TooltipIconButton>
      </div>
    </div>
  </ComposerPrimitive.Root>
);
