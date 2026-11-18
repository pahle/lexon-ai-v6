'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trash } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { createChatClient } from '@/lib/chat-client';
import { requestRouteHeadingFocus } from '../shell/navigation-focus';
import { useWorkspace } from '../shell/workspace-provider';
import { ChatDeleteDialog } from './chat-delete-dialog';
import { finishChatRename } from './chat-history';
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

// 28px round icon buttons with 16px icons (LEX-DS-001 v3.1 §5.5 Header).
const pillButton =
  'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 inline-flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-3 [&_svg]:size-4';

export function ChatFloatingActions({ chat }: { chat: OpenChat | null }) {
  const pathname = usePathname();
  const { identity, setChatTitle } = useWorkspace();
  const queryClient = useQueryClient();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const [renaming, setRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const scope = identity
    ? { orgId: identity.organization.id, userId: identity.user.id }
    : null;
  // The prototype shows the pill on the new chat and on a thread only: the
  // Chats list has none (and a status page hides it, below).
  if (pathname === '/chats') return null;
  return (
    <div
      data-slot="chat-floating-pill"
      className="bg-background [#main:has([data-slot=status-page])_&]:hidden absolute top-[9px] right-3.5 z-10 flex items-center gap-0.5 rounded-full p-[3px] shadow-[0_0_0_1px_var(--border),0_4px_12px_-6px_rgba(8,6,6,.18)] max-md:top-[11px] max-md:right-2.5"
    >
      <Link
        href="/workspace"
        aria-label="New chat"
        className={pillButton}
        onNavigate={requestRouteHeadingFocus}
      >
        <Plus aria-hidden="true" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Chat actions"
              disabled={!chat}
              ref={triggerRef}
              className={cn(
                pillButton,
                'aria-expanded:bg-accent aria-expanded:text-foreground disabled:pointer-events-none disabled:opacity-50',
              )}
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          alignOffset={-3}
          sideOffset={9}
          className="w-[180px]"
        >
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil aria-hidden="true" data-icon="inline-start" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-(--lexon-red-text) focus:text-(--lexon-red-text)"
            onClick={() => setDeleting(true)}
          >
            <Trash aria-hidden="true" data-icon="inline-start" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
