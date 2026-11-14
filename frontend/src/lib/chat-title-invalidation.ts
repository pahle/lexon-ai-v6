import type { QueryClient } from '@tanstack/react-query';
import {
  ChatIdentityFallbackEventSchema,
  ChatInvalidationEventSchema,
} from '@lexon/contracts';
import { publishIdentityFallbackHint } from './identity-client';
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

function cancelAndInvalidate(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
): Promise<void> {
  const cancellation = queryClient.cancelQueries({ queryKey });
  const invalidation = queryClient.invalidateQueries({ queryKey });
  return Promise.all([cancellation, invalidation]).then(() => undefined);
}

export async function invalidateChatQueriesForEvent(
  queryClient: QueryClient,
  scope: ChatInvalidationScope,
  payload: unknown,
): Promise<boolean> {
  const parsed = ChatInvalidationEventSchema.safeParse(payload);
  if (!parsed.success) return false;
  const invalidations = [
    cancelAndInvalidate(queryClient, chatListQueryKey(scope)),
    cancelAndInvalidate(
      queryClient,
      parsed.data.chatId === null
        ? chatThreadQueriesPrefix(scope)
        : chatThreadQueryKey(scope, parsed.data.chatId),
    ),
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
  onChatInvalidated?: (chatId: string | null) => void,
): () => void {
  const source = createSource('/api/chats/events', { withCredentials: true });
  let lastRecoveryRefresh: number | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let hasOpened = false;
  let needsRecoveryRefresh = false;
  let disposed = false;
  const closeSource = () => {
    if (disposed) return;
    disposed = true;
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
    source.onmessage = null;
    source.onopen = null;
    source.onerror = null;
    source.close();
  };
  const invalidateOwnerChats = (recovery = false) => {
    if (disposed) return;
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
    onChatInvalidated?.(null);
    void cancelAndInvalidate(queryClient, chatThreadQueriesPrefix(scope)).catch(
      () => undefined,
    );
  };
  source.onopen = () => {
    if (disposed) return;
    if (!hasOpened) invalidateOwnerChats();
    else if (needsRecoveryRefresh) invalidateOwnerChats(true);
    hasOpened = true;
    needsRecoveryRefresh = false;
  };
  source.onerror = () => {
    if (disposed) return;
    needsRecoveryRefresh = true;
    invalidateOwnerChats(true);
  };
  source.onmessage = (event) => {
    if (disposed) return;
    let payload: unknown;
    try {
      payload = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }
    const identityFallback = ChatIdentityFallbackEventSchema.safeParse(payload);
    if (identityFallback.success) {
      publishIdentityFallbackHint(identityFallback.data.reason);
      if (identityFallback.data.orgId !== scope.orgId) closeSource();
      return;
    }
    const parsed = ChatInvalidationEventSchema.safeParse(payload);
    if (parsed.success) onChatInvalidated?.(parsed.data.chatId);
    void invalidateChatQueriesForEvent(queryClient, scope, payload).catch(
      () => undefined,
    );
  };
  return closeSource;
}
