import type { ChatPage, ChatSearchPage } from '@lexon/contracts';
import type { QueryClient } from '@tanstack/react-query';

export interface ChatQueryScope {
  readonly orgId: string;
  readonly userId: string;
}

export function chatListQueryKey(scope: ChatQueryScope, limit?: number) {
  return limit === undefined
    ? (['tenant', scope.orgId, 'chat', scope.userId, 'list'] as const)
    : (['tenant', scope.orgId, 'chat', scope.userId, 'list', limit] as const);
}

export function chatThreadQueryKey(scope: ChatQueryScope, chatId: string) {
  return [
    'tenant',
    scope.orgId,
    'chat',
    scope.userId,
    'thread',
    chatId,
  ] as const;
}

export function chatThreadQueriesPrefix(scope: ChatQueryScope) {
  return ['tenant', scope.orgId, 'chat', scope.userId] as const;
}

export function chatSearchQueriesPrefix(scope: ChatQueryScope) {
  return [...chatThreadQueriesPrefix(scope), 'search'] as const;
}

export function chatSearchQueryKey(scope: ChatQueryScope, query: string) {
  return [...chatSearchQueriesPrefix(scope), query] as const;
}

export function renameChatSearchResults(
  queryClient: QueryClient,
  scope: ChatQueryScope,
  chatId: string,
  title: string,
) {
  updateChatSearchResults(queryClient, scope, (page) => ({
    ...page,
    items: page.items.map((item) =>
      item.chatId === chatId ? { ...item, title } : item,
    ),
  }));
}

export function removeChatSearchResults(
  queryClient: QueryClient,
  scope: ChatQueryScope,
  chatId: string,
): () => void {
  const removedByQuery = queryClient
    .getQueriesData<ChatSearchPage>({
      queryKey: chatSearchQueriesPrefix(scope),
    })
    .map(([queryKey, page]) => {
      const removed =
        page?.items.filter((item) => item.chatId === chatId) ?? [];
      if (page)
        queryClient.setQueryData(queryKey, {
          ...page,
          items: page.items.filter((item) => item.chatId !== chatId),
        });
      return { queryKey, removed };
    });
  return () => {
    for (const { queryKey, removed } of removedByQuery) {
      const current = queryClient.getQueryData<ChatSearchPage>(queryKey);
      if (!current) continue;
      const items = [...current.items];
      for (const item of removed) {
        if (items.some((currentItem) => currentItem.chatId === item.chatId))
          continue;
        items.push(item);
      }
      queryClient.setQueryData(queryKey, { ...current, items });
    }
  };
}

function updateChatSearchResults(
  queryClient: QueryClient,
  scope: ChatQueryScope,
  update: (page: ChatSearchPage) => ChatSearchPage,
) {
  for (const [queryKey, data] of queryClient.getQueriesData<ChatSearchPage>({
    queryKey: chatSearchQueriesPrefix(scope),
  })) {
    if (data) queryClient.setQueryData(queryKey, update(data));
  }
}

export type ChatListItem = ChatPage['items'][number];
export type ChatDateGroup = {
  readonly label: string;
  readonly items: ChatListItem[];
};

export function groupChatsByDate(
  items: readonly ChatListItem[],
  now = new Date(),
): ChatDateGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 7);
  const groups = new Map<string, ChatListItem[]>();
  for (const item of items) {
    const activity = new Date(item.updatedAt);
    const day = new Date(
      activity.getFullYear(),
      activity.getMonth(),
      activity.getDate(),
    );
    const label =
      day.getTime() === today.getTime()
        ? 'Today'
        : day.getTime() === yesterday.getTime()
          ? 'Yesterday'
          : day >= weekStart
            ? 'Previous 7 days'
            : new Intl.DateTimeFormat('en-US', {
                month: 'long',
                year: 'numeric',
              }).format(activity);
    const group = groups.get(label) ?? [];
    group.push(item);
    groups.set(label, group);
  }
  return [...groups].map(([label, groupItems]) => ({
    label,
    items: groupItems,
  }));
}
