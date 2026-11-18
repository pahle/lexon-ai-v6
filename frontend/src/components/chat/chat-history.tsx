'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode, type Ref } from 'react';
import type { ChatApi } from '@lexon/contracts';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatActivityDate } from '@/lib/date-time';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  chatListQueryKey,
  groupChatsByDate,
  renameChatSearchResults,
  type ChatListItem,
  type ChatQueryScope,
} from '@/lib/chat-queries';
import { ChatDeleteDialog } from './chat-delete-dialog';
import { ChatRenameDialog } from './chat-rename-dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

export function ChatHistory({
  client,
  scope,
  currentChatId,
}: {
  client: ChatApi;
  scope: ChatQueryScope;
  currentChatId?: string;
}) {
  const [deleteTarget, setDeleteTarget] = useState<ChatListItem | null>(null);
  const query = useInfiniteQuery({
    queryKey: chatListQueryKey(scope, 20),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.list(
        { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (page) => page.pageInfo.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const deleteDialog = deleteTarget ? (
    <ChatDeleteDialog
      chatId={deleteTarget.id}
      title={deleteTarget.title}
      client={client}
      scope={scope}
      open
      showTrigger={false}
      onOpenChange={(open) => {
        if (!open) setDeleteTarget(null);
      }}
    />
  ) : null;
  if (query.isPending)
    return (
      <div className="contents">
        <div
          role="status"
          aria-label="Loading chats"
          className="flex flex-col gap-3.5"
        >
          <div className="px-3 pt-2.5">
            <Skeleton className="w-14" />
          </div>
          {[62, 48, 70, 55, 40, 66].map((width) => (
            <div
              key={width}
              className="flex items-center justify-between gap-4 rounded-[10px] border border-transparent p-3"
            >
              <Skeleton style={{ width: `${width}%` }} />
              <Skeleton className="w-[52px]" />
            </div>
          ))}
        </div>
        {deleteDialog}
      </div>
    );
  if (query.isError)
    return (
      <div className="contents">
        <p role="alert">Chats could not be loaded. Refresh to try again.</p>
        {deleteDialog}
      </div>
    );
  if (!items.length)
    return (
      <div className="contents">
        <Empty className="flex-none gap-2 border-0 px-0 py-16 text-wrap text-muted-foreground">
          <EmptyHeader className="max-w-none gap-2">
            <EmptyMedia
              variant="icon"
              className="mb-0 size-10 rounded-[10px] [&_svg:not([class*='size-'])]:size-5"
            >
              <MessageCircle aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle className="text-base leading-[normal] font-semibold text-foreground">
              No chats yet
            </EmptyTitle>
            <EmptyDescription className="text-sm leading-[normal]">
              Start a new chat to ask Lexon about a contract, a regulation, or a
              case.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="mt-2">
            <Button nativeButton={false} render={<Link href="/workspace" />}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              New chat
            </Button>
          </EmptyContent>
        </Empty>
        {deleteDialog}
      </div>
    );
  const groups = groupChatsByDate(items);
  return (
    <div className="contents">
      <div className="flex min-h-0 w-full flex-col gap-3.5">
        {groups.map((group) => (
          <section
            key={group.label}
            aria-label={group.label}
            className="flex flex-col gap-3.5"
          >
            <h2 className="text-muted-foreground px-3 pt-2.5 text-xs leading-[normal] font-medium">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-3.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <ChatHistoryRow
                    item={item}
                    client={client}
                    scope={scope}
                    current={item.id === currentChatId}
                    onDelete={setDeleteTarget}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {query.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more chats'}
          </Button>
        ) : null}
      </div>
      {deleteDialog}
    </div>
  );
}

export function RecentChats({
  client,
  scope,
  currentChatId,
  onNavigate,
  onCloseMobile,
  viewAll,
}: {
  client: ChatApi;
  scope: ChatQueryScope;
  currentChatId?: string;
  onNavigate?: () => void;
  onCloseMobile?: () => void;
  viewAll?: ReactNode;
}) {
  const [deleteTarget, setDeleteTarget] = useState<ChatListItem | null>(null);
  const query = useQuery({
    queryKey: chatListQueryKey(scope, 6),
    queryFn: ({ signal }) => client.list({ limit: 6 }, signal),
  });
  const deleteDialog = deleteTarget ? (
    <ChatDeleteDialog
      chatId={deleteTarget.id}
      title={deleteTarget.title}
      client={client}
      scope={scope}
      open
      showTrigger={false}
      onOpenChange={(open) => {
        if (!open) setDeleteTarget(null);
      }}
    />
  ) : null;
  if (query.isPending)
    return (
      <>
        <div
          role="status"
          aria-label="Loading recent chats"
          className="flex flex-col"
        >
          {[70, 55, 80, 62].map((width) => (
            <div key={width} className="flex h-8 items-center px-2">
              <Skeleton
                className="bg-sidebar-accent"
                style={{ width: `${width}%` }}
              />
            </div>
          ))}
        </div>
        {viewAll}
        {deleteDialog}
      </>
    );
  if (query.isError)
    return (
      <>
        <p role="alert" className="px-2.5 py-2 text-sm">
          Recent chats could not be loaded.
        </p>
        {viewAll}
        {deleteDialog}
      </>
    );
  if (!query.data.items.length)
    return (
      <>
        <p className="px-2 py-1 text-[13px] text-muted-foreground">
          No chats yet.
        </p>
        {/* Keep the child slots stable so an open delete dialog survives the list emptying. */}
        {null}
        {deleteDialog}
      </>
    );
  return (
    <>
      <SidebarMenu>
        {query.data.items.map((item) => (
          <RecentChatRow
            key={item.id}
            item={item}
            client={client}
            scope={scope}
            current={item.id === currentChatId}
            {...(onNavigate ? { onNavigate } : {})}
            {...(onCloseMobile ? { onCloseMobile } : {})}
            onDelete={() => setDeleteTarget(item)}
          />
        ))}
      </SidebarMenu>
      {viewAll}
      {deleteDialog}
    </>
  );
}

function RecentChatRow({
  item,
  client,
  scope,
  current,
  onNavigate,
  onCloseMobile,
  onDelete,
}: {
  item: ChatListItem;
  client: ChatApi;
  scope: ChatQueryScope;
  current: boolean;
  onNavigate?: () => void;
  onCloseMobile?: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={current}
        aria-current={current ? 'page' : undefined}
        tooltip={item.title}
        onClick={onCloseMobile}
        render={
          <Link
            href={`/chats/${item.id}`}
            onNavigate={() => {
              if (!current) onNavigate?.();
            }}
          />
        }
      >
        <span className="truncate">{item.title}</span>
      </SidebarMenuButton>
      <ChatHistoryActions
        item={item}
        sidebar
        triggerRef={triggerRef}
        onRename={() => setRenaming(true)}
        onDelete={onDelete}
      />
      <ChatRenameDialog
        chat={item}
        client={client}
        scope={scope}
        returnFocusRef={triggerRef}
        open={renaming}
        onOpenChange={setRenaming}
        onSaved={(title) =>
          finishChatRename(queryClient, scope, item.id, title)
        }
      />
    </SidebarMenuItem>
  );
}

function ChatHistoryRow({
  item,
  client,
  scope,
  current,
  onDelete,
}: {
  item: ChatListItem;
  client: ChatApi;
  scope: ChatQueryScope;
  current: boolean;
  onDelete: (item: ChatListItem) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  return (
    <div className="group/row relative flex min-w-0 items-center justify-between gap-4 rounded-[10px] border border-transparent p-3 text-sm leading-[normal] font-medium hover:bg-muted focus-within:bg-muted">
      <Link
        className="min-w-0 flex-1 truncate after:absolute after:inset-0 after:rounded-[10px] focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
        href={`/chats/${item.id}`}
        aria-current={current ? 'page' : undefined}
      >
        {item.title}
      </Link>
      <time className="text-muted-foreground shrink-0 text-xs font-normal whitespace-nowrap group-hover/row:invisible group-focus-within/row:invisible">
        {formatActivityDate(item.updatedAt, { yesterday: true })}
      </time>
      <div className="absolute top-1/2 right-1.5 z-10 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <ChatHistoryActions
          item={item}
          triggerRef={triggerRef}
          onRename={() => setRenaming(true)}
          onDelete={() => onDelete(item)}
        />
      </div>
      <ChatRenameDialog
        chat={item}
        client={client}
        scope={scope}
        returnFocusRef={triggerRef}
        open={renaming}
        onOpenChange={setRenaming}
        onSaved={(title) =>
          finishChatRename(queryClient, scope, item.id, title)
        }
      />
    </div>
  );
}

export function finishChatRename(
  queryClient: ReturnType<typeof useQueryClient>,
  scope: ChatQueryScope,
  chatId: string,
  title: string,
) {
  renameChatSearchResults(queryClient, scope, chatId, title);
  void queryClient.invalidateQueries({ queryKey: chatListQueryKey(scope) });
}

export function ChatHistoryActions({
  item,
  onRename,
  onDelete,
  sidebar = false,
  label = `Chat actions for ${item.title}`,
  disabled = false,
  triggerRef,
}: {
  item: { title: string };
  onRename: () => void;
  onDelete: () => void;
  sidebar?: boolean;
  label?: string;
  disabled?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          sidebar ? (
            <SidebarMenuAction
              type="button"
              showOnHover
              className="size-6 peer-data-[size=default]/menu-button:top-1"
              aria-label={label}
              disabled={disabled}
              ref={triggerRef}
            />
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={label}
              disabled={disabled}
              ref={triggerRef}
            />
          )
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onRename}>
          <Pencil aria-hidden="true" data-icon="inline-start" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete}>
          <Trash2 aria-hidden="true" data-icon="inline-start" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
