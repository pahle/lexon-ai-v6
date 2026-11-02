'use client';

import { ThreadListPrimitive } from '@assistant-ui/react';
import { ThreadListItemPrimitive } from '@assistant-ui/react';

export function ThreadList() {
  return (
    <ThreadListPrimitive.Root
      aria-label="Conversations"
      className="min-w-0 max-w-full overflow-hidden"
    >
      <ThreadListPrimitive.Items>
        {({ threadListItem }) => (
          <ThreadListItemPrimitive.Root
            key={threadListItem.id}
            className="min-w-0"
          >
            <ThreadListItemPrimitive.Trigger className="min-h-11 w-full truncate px-2 text-start text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <ThreadListItemPrimitive.Title fallback="Conversation" />
            </ThreadListItemPrimitive.Trigger>
          </ThreadListItemPrimitive.Root>
        )}
      </ThreadListPrimitive.Items>
      <p className="min-w-0 max-w-full break-words px-2 py-1 text-sm text-muted-foreground">
        No conversations yet.
      </p>
    </ThreadListPrimitive.Root>
  );
}
