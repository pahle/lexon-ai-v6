import type { QueryClient } from '@tanstack/react-query';
import { ChatInvalidationEventSchema } from '@lexon/contracts';

export interface ChatInvalidationScope {
  readonly orgId: string;
  readonly userId: string;
}

export interface ChatInvalidationSource {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export function chatListQueryKey(scope: ChatInvalidationScope) {
  return ['tenant', scope.orgId, scope.userId, 'chats'] as const;
}

export function chatThreadQueryKey(
  scope: ChatInvalidationScope,
  chatId: string,
) {
  return ['tenant', scope.orgId, scope.userId, 'chat', chatId] as const;
}

export function chatThreadQueriesPrefix(scope: ChatInvalidationScope) {
  return ['tenant', scope.orgId, scope.userId, 'chat'] as const;
}

export async function invalidateChatQueriesForEvent(
  queryClient: QueryClient,
  scope: ChatInvalidationScope,
  payload: unknown,
): Promise<boolean> {
  const parsed = ChatInvalidationEventSchema.safeParse(payload);
  if (!parsed.success) return false;
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: chatListQueryKey(scope) }),
    queryClient.invalidateQueries({
      queryKey:
        parsed.data.chatId === null
          ? chatThreadQueriesPrefix(scope)
          : chatThreadQueryKey(scope, parsed.data.chatId),
    }),
  ];
  await Promise.all(invalidations);
  return true;
}

export function subscribeToChatInvalidations(
  queryClient: QueryClient,
  scope: ChatInvalidationScope,
  createSource: (
    url: string,
    options: EventSourceInit,
  ) => ChatInvalidationSource = (url, options) => new EventSource(url, options),
): () => void {
  const source = createSource('/api/chats/events', { withCredentials: true });
  let lastRecoveryRefresh = 0;
  let hasOpened = false;
  let needsRecoveryRefresh = false;
  const invalidateOwnerChats = (recovery = false) => {
    const now = Date.now();
    if (recovery && now - lastRecoveryRefresh < 15_000) return;
    if (recovery) lastRecoveryRefresh = now;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: chatListQueryKey(scope) }),
      queryClient.invalidateQueries({
        queryKey: chatThreadQueriesPrefix(scope),
      }),
    ]).catch(() => undefined);
  };
  source.onopen = () => {
    if (!hasOpened) invalidateOwnerChats();
    else if (needsRecoveryRefresh) invalidateOwnerChats(true);
    hasOpened = true;
    needsRecoveryRefresh = false;
  };
  source.onerror = () => {
    needsRecoveryRefresh = true;
    invalidateOwnerChats(true);
  };
  source.onmessage = (event) => {
    let payload: unknown;
    try {
      payload = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }
    void invalidateChatQueriesForEvent(queryClient, scope, payload).catch(
      () => undefined,
    );
  };
  return () => {
    source.onmessage = null;
    source.onopen = null;
    source.onerror = null;
    source.close();
  };
}
