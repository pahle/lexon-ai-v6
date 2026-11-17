'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { createChatClient } from '@/lib/chat-client';
import { requestRouteHeadingFocus } from '../shell/navigation-focus';
import { useWorkspace } from '../shell/workspace-provider';
import { ChatDeleteDialog } from './chat-delete-dialog';
import { ChatHistoryActions, finishChatRename } from './chat-history';
import { ChatRenameDialog } from './chat-rename-dialog';

export type OpenChat = { id: string; title: string };

const CHAT_THREAD_PATH = /^\/chats\/([0-9a-f-]{36})$/i;

/** True on the routes that use the chat page chrome (no breadcrumb header). */
export function isChatChromePath(pathname: string) {
  return (
    pathname === '/workspace' ||
    pathname === '/chats' ||
    CHAT_THREAD_PATH.test(pathname)
  );
}

/**
 * The chat open on `/chats/[chatId]`, or null elsewhere. The title is the one
 * published by the mounted thread for the current actor scope, else "Chat".
 */
export function useOpenChat(): OpenChat | null {
  const pathname = usePathname() ?? '';
  const { identity, chatTitle } = useWorkspace();
  const id = CHAT_THREAD_PATH.exec(pathname)?.[1];
  if (!id) return null;
  const actorScope = identity
    ? `${identity.organization.id}:${identity.user.id}`
    : '';
  const title =
    chatTitle && chatTitle.chatId === id && chatTitle.actorScope === actorScope
      ? chatTitle.title
      : 'Chat';
  return { id, title };
}

export function ChatFloatingActions({ chat }: { chat: OpenChat | null }) {
  const { identity, setChatTitle } = useWorkspace();
  const queryClient = useQueryClient();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const [renaming, setRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const scope = identity
    ? { orgId: identity.organization.id, userId: identity.user.id }
    : null;
  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full border bg-background p-1 shadow-sm">
      <Link
        href="/workspace"
        aria-label="New chat"
        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        onNavigate={requestRouteHeadingFocus}
      >
        <Plus aria-hidden="true" />
      </Link>
      <ChatHistoryActions
        item={chat ?? { title: '' }}
        label="Chat actions"
        triggerRef={triggerRef}
        disabled={!chat}
        onRename={() => setRenaming(true)}
        onDelete={() => setDeleting(true)}
      />
      {chat && scope ? (
        <>
          <ChatRenameDialog
            chat={chat}
            client={client}
            scope={scope}
            returnFocusRef={triggerRef}
            open={renaming}
            onOpenChange={setRenaming}
            onSaved={(title) => {
              finishChatRename(queryClient, scope, chat.id, title);
              if (identity)
                setChatTitle(
                  chat.id,
                  `${identity.organization.id}:${identity.user.id}`,
                  title,
                );
            }}
          />
          <ChatDeleteDialog
            chatId={chat.id}
            title={chat.title}
            client={client}
            scope={scope}
            open={deleting}
            onOpenChange={setDeleting}
            showTrigger={false}
          />
        </>
      ) : null}
    </div>
  );
}
