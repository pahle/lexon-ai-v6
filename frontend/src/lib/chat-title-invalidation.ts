import type { QueryClient } from '@tanstack/react-query';
import { ChatInvalidationEventSchema } from '@lexon/contracts';
import {
  chatListQueryKey,
  chatThreadQueriesPrefix,
  chatThreadQueryKey,
  type ChatQueryScope,
} from './chat-queries';

export type ChatInvalidationScope = ChatQueryScope;

export interface ChatInvalidationSource {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export { chatListQueryKey, chatThreadQueriesPrefix, chatThreadQueryKey };

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
  let lastRecoveryRefresh: number | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let hasOpened = false;
  let needsRecoveryRefresh = false;
  const invalidateOwnerChats = (recovery = false) => {
    const now = Date.now();
    if (recovery) {
      const elapsed =
        lastRecoveryRefresh === undefined
          ? Number.POSITIVE_INFINITY
          : now - lastRecoveryRefresh;
      if (elapsed < 15_000) {
        if (recoveryTimer === undefined) {
          recoveryTimer = setTimeout(() => {
            recoveryTimer = undefined;
            invalidateOwnerChats(true);
          }, 15_000 - elapsed);
        }
        return;
      }
      lastRecoveryRefresh = now;
    }
    void queryClient
      .invalidateQueries({ queryKey: chatThreadQueriesPrefix(scope) })
      .catch(() => undefined);
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
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    source.onmessage = null;
    source.onopen = null;
    source.onerror = null;
    source.close();
  };
}
