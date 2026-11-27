'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, PencilLine, Plus, Share2, Trash } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { createChatClient } from '@/lib/chat-client';
import { chatListQueryKey } from '@/lib/chat-queries';
import { requestRouteHeadingFocus } from '../shell/navigation-focus';
import { useWorkspace } from '../shell/workspace-provider';
import { ChatDeleteDialog } from './chat-delete-dialog';
import { finishChatRename } from './chat-history';
import { ChatRenameDialog } from './chat-rename-dialog';
import { ChatShareDialog } from './chat-share-dialog';

/**
 * `title` is null only while it cannot be known yet (render a skeleton).
 * `access`/`projectBound` ride the workspace-provider publish slot (F6 §10).
 */
export type OpenChat = {
  id: string;
  title: string | null;
  access?: 'owner' | 'reader' | undefined;
  projectBound?: boolean | undefined;
  /** Matter chip link target + label (r18 mchip); null on standalone chats. */
  projectId?: string | null | undefined;
  projectName?: string | null | undefined;
};

type ListCacheItem = { id: string; title: string; projectName?: string };
type ListCacheData =
  | { items?: ListCacheItem[] }
  | { pages: { items?: ListCacheItem[] }[] }
  | undefined;

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
  const queryClient = useQueryClient();
  const id = CHAT_THREAD_PATH.exec(pathname)?.[1];
  const orgId = identity?.organization.id;
  const userId = identity?.user.id;
  // While the thread loads, its title is already known from the chat lists
  // (Recent, All chats) in the query cache, so the header never shows the
  // generic "Chat" for a chat that has a title.
  const findListed = useCallback(() => {
    if (!id || !orgId || !userId) return undefined;
    for (const [, data] of queryClient.getQueriesData<ListCacheData>({
      queryKey: chatListQueryKey({ orgId, userId }),
    })) {
      const pages = data && 'pages' in data ? data.pages : [data];
      for (const page of pages) {
        const found = page?.items?.find((item) => item.id === id);
        if (found) return found;
      }
    }
    return undefined;
  }, [id, orgId, queryClient, userId]);
  // Snapshots stay primitive so useSyncExternalStore sees a stable value.
  const listedTitle = useSyncExternalStore(
    useCallback(
      (notify) => queryClient.getQueryCache().subscribe(notify),
      [queryClient],
    ),
    () => findListed()?.title ?? null,
    () => null,
  );
  const listedBound = useSyncExternalStore(
    useCallback(
      (notify) => queryClient.getQueryCache().subscribe(notify),
      [queryClient],
    ),
    () => findListed()?.projectName !== undefined,
    () => false,
  );
  const listedProjectName = useSyncExternalStore(
    useCallback(
      (notify) => queryClient.getQueryCache().subscribe(notify),
      [queryClient],
    ),
    () => findListed()?.projectName ?? null,
    () => null,
  );
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const published =
    !!chatTitle &&
    chatTitle.chatId === id &&
    chatTitle.actorScope === `${orgId}:${userId}`;
  // Not in the cache (the sidebar's lists are not mounted, as on mobile): ask
  // for the Recent list, the same query the sidebar uses, so it is shared.
  const needsList =
    !!id && !!orgId && !!userId && !published && listedTitle === null;
  useEffect(() => {
    if (!needsList || !orgId || !userId) return;
    void queryClient
      .fetchQuery({
        queryKey: chatListQueryKey({ orgId, userId }, 6),
        queryFn: ({ signal }) => client.list({ limit: 6 }, signal),
        staleTime: 30_000,
      })
      .catch(() => undefined);
  }, [client, needsList, orgId, queryClient, userId]);
  if (!id) return null;
  const actorScope = identity
    ? `${identity.organization.id}:${identity.user.id}`
    : '';
  const mine =
    chatTitle && chatTitle.chatId === id && chatTitle.actorScope === actorScope
      ? chatTitle
      : null;
  return {
    id,
    title: mine ? mine.title : listedTitle,
    access: mine?.access,
    projectBound: mine?.projectBound ?? listedBound,
    projectId: mine?.projectId ?? null,
    projectName: mine?.projectName ?? listedProjectName,
  };
}

// 28px round icon buttons with 16px icons (LEX-DS-001 v3.1 §5.5 Header).
/**
 * True while a status page (not found, workspace error, no access) is in the
 * document. An error boundary keeps the route's path, so the path cannot tell;
 * the prototype shows no pill on those pages.
 */
function useStatusPageShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const check = () =>
      setShown(document.querySelector('[data-slot="status-page"]') !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return shown;
}

const pillButton =
  'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 inline-flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-3 [&_svg]:size-4';

export function ChatFloatingActions({ chat: open }: { chat: OpenChat | null }) {
  // Dialogs need a string; the generic word never reaches the header.
  const chat = open
    ? {
        id: open.id,
        title: open.title ?? 'Chat',
        access: open.access ?? 'owner',
        projectBound: open.projectBound ?? false,
        projectId: open.projectId,
        projectName: open.projectName,
      }
    : null;
  const pathname = usePathname();
  const statusPageShown = useStatusPageShown();
  const { identity, setChatTitle } = useWorkspace();
  const queryClient = useQueryClient();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  const [renaming, setRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const scope = identity
    ? { orgId: identity.organization.id, userId: identity.user.id }
    : null;
  // The prototype shows the pill on the new chat and on a thread only: the
  // Chats list has none (and a status page hides it, below).
  if (pathname === '/chats' || statusPageShown) return null;
  const reader = chat?.access === 'reader';
  const canShare =
    chat !== null &&
    !chat.projectBound &&
    identity?.organization.kind === 'team';
  return (
    <div
      data-slot="chat-floating-pill"
      className="bg-background absolute top-[9px] right-3.5 z-10 flex items-center gap-0.5 rounded-full p-[3px] shadow-[0_0_0_1px_var(--border),0_4px_12px_-6px_rgba(8,6,6,.18)] max-md:top-[11px] max-md:right-2.5"
    >
      <Link
        href="/workspace"
        aria-label="New chat"
        className={pillButton}
        onNavigate={requestRouteHeadingFocus}
      >
        <Plus aria-hidden="true" />
      </Link>
      {reader ? null : (
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
              <PencilLine aria-hidden="true" data-icon="inline-start" />
              Rename
            </DropdownMenuItem>
            {canShare ? (
              <DropdownMenuItem onClick={() => setSharing(true)}>
                <Share2 aria-hidden="true" data-icon="inline-start" />
                Share
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="text-(--lexon-red-text) focus:text-(--lexon-red-text)"
              onClick={() => setDeleting(true)}
            >
              <Trash aria-hidden="true" data-icon="inline-start" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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
                  {
                    access: chat.access,
                    projectBound: chat.projectBound,
                    projectId: chat.projectId ?? undefined,
                    projectName: chat.projectName ?? undefined,
                  },
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
          {canShare ? (
            <ChatShareDialog
              chat={chat}
              client={client}
              scope={scope}
              open={sharing}
              onOpenChange={setSharing}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
