'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, SquarePen, Trash2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createChatClient } from '@/lib/chat-client';
import { requestRouteHeadingFocus } from '../shell/navigation-focus';
import { useWorkspace } from '../shell/workspace-provider';
import { ChatDeleteDialog } from './chat-delete-dialog';
import { finishChatRename } from './chat-history';
import { ChatRename } from './chat-rename';

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
  const { identity } = useWorkspace();
  const queryClient = useQueryClient();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const [renaming, setRenaming] = useState(false);
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
        <SquarePen aria-hidden="true" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Chat actions"
              disabled={!chat}
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil aria-hidden="true" data-icon="inline-start" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" data-icon="inline-start" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {chat && scope ? (
        <>
          <Dialog open={renaming} onOpenChange={setRenaming}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename chat</DialogTitle>
              </DialogHeader>
              <ChatRename
                chatId={chat.id}
                title={chat.title}
                client={client}
                scope={scope}
                onCancel={() => setRenaming(false)}
                onSaved={(title) => {
                  setRenaming(false);
                  finishChatRename(queryClient, scope, chat.id, title);
                }}
              />
            </DialogContent>
          </Dialog>
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
