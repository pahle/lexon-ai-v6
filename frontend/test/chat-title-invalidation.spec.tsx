import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  chatListQueryKey,
  chatThreadQueryKey,
  invalidateChatQueriesForEvent,
  subscribeToChatInvalidations,
} from '../src/lib/chat-title-invalidation.js';
import { transitionTenant } from '../src/lib/tenant-queries.js';

const scope = {
  orgId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
};
const chatId = '00000000-0000-4000-8000-000000000003';

it('subscribes with cookies and invalidates exact owner-scoped list and thread keys', async () => {
  const invalidateQueries = vi.fn(
    async (filters: { queryKey: readonly unknown[] }) => filters.queryKey,
  );
  const queryClient = { invalidateQueries } as unknown as QueryClient;
  let source:
    | {
        onmessage: ((event: MessageEvent<string>) => void) | null;
        onopen: ((event: Event) => void) | null;
        onerror: ((event: Event) => void) | null;
        close: ReturnType<typeof vi.fn>;
      }
    | undefined;
  const dispose = subscribeToChatInvalidations(
    queryClient,
    scope,
    (url, options) => {
      expect(url).toBe('/api/chats/events');
      expect(options).toEqual({ withCredentials: true });
      const created = {
        onmessage: null,
        onopen: null,
        onerror: null,
        close: vi.fn(),
      };
      source = created;
      return created;
    },
  );
  source!.onmessage!(
    new MessageEvent('message', {
      data: JSON.stringify({ version: 1, type: 'chat.invalidated', chatId }),
    }),
  );
  await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2));
  expect(
    invalidateQueries.mock.calls.map(([filter]) => filter.queryKey),
  ).toEqual([
    ['tenant', scope.orgId, scope.userId, 'chats'],
    ['tenant', scope.orgId, scope.userId, 'chat', chatId],
  ]);
  dispose();
  expect(source!.close).toHaveBeenCalledOnce();
});

it('refreshes bounded owner chat queries on EventSource open and reconnect', async () => {
  const invalidateQueries = vi.fn(
    async (filters: { queryKey: readonly unknown[] }) => filters.queryKey,
  );
  const queryClient = { invalidateQueries } as unknown as QueryClient;
  let source:
    | {
        onmessage: ((event: MessageEvent<string>) => void) | null;
        onopen: ((event: Event) => void) | null;
        onerror: ((event: Event) => void) | null;
        close: ReturnType<typeof vi.fn>;
      }
    | undefined;
  const dispose = subscribeToChatInvalidations(queryClient, scope, () => {
    const created = {
      onmessage: null,
      onopen: null,
      onerror: null,
      close: vi.fn(),
    };
    source = created;
    return created;
  });
  source!.onopen!(new Event('open'));
  await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2));
  source!.onerror!(new Event('error'));
  source!.onopen!(new Event('open'));
  await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(4));
  expect(
    invalidateQueries.mock.calls.map(([filter]) => filter.queryKey),
  ).toEqual([
    chatListQueryKey(scope),
    ['tenant', scope.orgId, scope.userId, 'chat'],
    chatListQueryKey(scope),
    ['tenant', scope.orgId, scope.userId, 'chat'],
  ]);
  dispose();
  expect(source!.onopen).toBeNull();
  expect(source!.onerror).toBeNull();
});

it('rejects malformed or content-bearing invalidations', async () => {
  const invalidateQueries = vi.fn(
    async (filters: { queryKey: readonly unknown[] }) => filters.queryKey,
  );
  const client = { invalidateQueries } as unknown as QueryClient;
  await expect(
    invalidateChatQueriesForEvent(client, scope, {
      version: 1,
      type: 'chat.invalidated',
      chatId,
      title: 'must not be streamed',
    }),
  ).resolves.toBe(false);
  expect(invalidateQueries).not.toHaveBeenCalled();
});

it('tenant transition clears the owner-scoped chat cache subtree', async () => {
  const client = new QueryClient();
  client.setQueryData(chatListQueryKey(scope), ['old list']);
  client.setQueryData(chatThreadQueryKey(scope, chatId), ['old thread']);
  await transitionTenant(client, {
    version: 1,
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Next organization',
    slug: 'next-org',
    kind: 'team',
    state: 'active',
    role: 'member',
    require2fa: false,
    createdAt: '2026-11-12T00:00:00Z',
  });
  expect(
    client.getQueriesData({ queryKey: ['tenant', scope.orgId, scope.userId] }),
  ).toEqual([]);
});
