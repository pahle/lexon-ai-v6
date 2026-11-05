'use client';

import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import type { FC } from 'react';

export const ThreadList: FC = () => {
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const isLoading = useAuiState((state) => state.threads.isLoading);

  return (
    <ThreadListPrimitive.Root
      data-slot="aui_thread-list-root"
      className="flex flex-col gap-0.5"
    >
      {isLoading && threadIds.length === 0 ? (
        <p role="status" className="px-2.5 py-2 text-sm text-muted-foreground">
          Loading conversations…
        </p>
      ) : threadIds.length === 0 ? (
        <p className="break-words px-2.5 py-2 text-sm text-muted-foreground">
          No conversations yet.
        </p>
      ) : (
        threadIds.map((id, index) => (
          <ThreadListPrimitive.ItemByIndex
            key={id}
            index={index}
            components={{ ThreadListItem }}
          />
        ))
      )}
    </ThreadListPrimitive.Root>
  );
};

const ThreadListItem: FC = () => (
  <ThreadListItemPrimitive.Root
    data-slot="aui_thread-list-item"
    className="group hover:bg-muted focus-visible:bg-muted data-active:bg-muted has-focus-visible:bg-muted relative flex h-8 items-center rounded-md transition-colors focus-visible:outline-none"
  >
    <ThreadListItemPrimitive.Trigger
      data-slot="aui_thread-list-item-trigger"
      className="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center rounded-md px-2.5 text-start text-sm outline-none focus-visible:ring-1"
    >
      <span
        data-slot="aui_thread-list-item-title"
        className="min-w-0 flex-1 truncate"
      >
        <ThreadListItemPrimitive.Title fallback="New Chat" />
      </span>
    </ThreadListItemPrimitive.Trigger>
  </ThreadListItemPrimitive.Root>
);
