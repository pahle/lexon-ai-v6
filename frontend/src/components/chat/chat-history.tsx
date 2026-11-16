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
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
        <p role="status">Loading chats…</p>
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
        <Empty className="h-80 flex-none border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareText aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No chats yet</EmptyTitle>
            <EmptyDescription>
              Start a new chat to ask Lexon about a contract, a regulation, or a
              case.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/workspace" />}>
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
      <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-col gap-5">
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="text-muted-foreground mb-2 px-3 text-sm font-medium">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-1">
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
        <p role="status" className="px-2.5 py-2 text-sm text-muted-foreground">
          Loading recent chats…
        </p>
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
        <p className="px-2.5 py-2 text-sm text-muted-foreground">
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
    <div className="flex min-h-12 min-w-0 items-center gap-4 px-3 py-2">
      <Link
        className="min-w-0 flex-1 truncate font-medium hover:underline"
        href={`/chats/${item.id}`}
        aria-current={current ? 'page' : undefined}
      >
        {item.title}
      </Link>
      <time className="text-muted-foreground shrink-0 text-xs">
        {formatActivityDate(item.updatedAt)}
      </time>
      <ChatHistoryActions
        item={item}
        triggerRef={triggerRef}
        onRename={() => setRenaming(true)}
        onDelete={() => onDelete(item)}
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

function formatActivityDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (day.getTime() === today.getTime())
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  if (day.getTime() === yesterday.getTime()) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
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
