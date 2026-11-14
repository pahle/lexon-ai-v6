import { expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  chatListQueryKey,
  chatThreadQueryKey,
  invalidateChatQueriesForEvent,
  subscribeToChatInvalidations,
} from '../src/lib/chat-title-invalidation.js';
import { IDENTITY_FALLBACK_HINT_EVENT } from '../src/lib/identity-client.js';
import { transitionTenant } from '../src/lib/tenant-queries.js';

const scope = {
  orgId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
};
const chatId = '00000000-0000-4000-8000-000000000003';

it.each(['membership_removed', 'selection_repaired'] as const)(
  'hints and retires the old subscription for cross-organization fallback %s',
  async (reason) => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const targetScope = {
      orgId: '00000000-0000-4000-8000-000000000004',
      userId: scope.userId,
    };
    const sources: Array<{
      onmessage: ((event: MessageEvent<string>) => void) | null;
      onopen: ((event: Event) => void) | null;
      onerror: ((event: Event) => void) | null;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const createSource = () => {
      const source = {
        onmessage: null,
        onopen: null,
        onerror: null,
        close: vi.fn(),
      };
      sources.push(source);
      return source;
    };
    const hints: unknown[] = [];
    const onHint = (event: Event) =>
      hints.push((event as CustomEvent<unknown>).detail);
    window.addEventListener(IDENTITY_FALLBACK_HINT_EVENT, onHint);
    const disposeOld = subscribeToChatInvalidations(queryClient, scope, () =>
      createSource(),
    );

    try {
      sources[0]!.onmessage!(
        new MessageEvent('message', {
          data: JSON.stringify({
            version: 1,
            type: 'identity-fallback',
            reason,
            orgId: targetScope.orgId,
          }),
        }),
      );
      expect.soft(hints).toEqual([{ reason }]);
      expect.soft(sources[0]!.close).toHaveBeenCalledOnce();
      expect.soft(sources[0]!.onmessage).toBeNull();
      expect.soft(invalidateQueries).not.toHaveBeenCalled();

      const disposeNew = subscribeToChatInvalidations(
        queryClient,
        targetScope,
        () => createSource(),
      );
      try {
        sources[1]!.onmessage!(
          new MessageEvent('message', {
            data: JSON.stringify({
              version: 1,
              type: 'chat.invalidated',
              chatId,
            }),
          }),
        );
        await vi.waitFor(() =>
          expect(invalidateQueries).toHaveBeenCalledTimes(2),
        );
        expect(
          invalidateQueries.mock.calls.map(([filter]) => filter?.queryKey),
        ).toEqual([
          ['tenant', targetScope.orgId, 'chat', targetScope.userId, 'list'],
          [
            'tenant',
            targetScope.orgId,
            'chat',
            targetScope.userId,
            'thread',
            chatId,
          ],
        ]);
      } finally {
        disposeNew();
      }
    } finally {
      disposeOld();
      queryClient.clear();
      window.removeEventListener(IDENTITY_FALLBACK_HINT_EVENT, onHint);
    }
  },
);

it.each([
  {
    label: 'unknown reason',
    reason: 'not-a-reason',
    orgId: '00000000-0000-4000-8000-000000000004',
  },
  {
    label: 'invalid organization ID',
    reason: 'membership_removed',
    orgId: 'not-a-uuid',
  },
  {
    label: 'extra content',
    reason: 'membership_removed',
    orgId: '00000000-0000-4000-8000-000000000004',
    title: 'must not be accepted',
  },
] as const)('ignores identity fallback with $label', async (payload) => {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const source = {
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onopen: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    close: vi.fn(),
  };
  const hints: unknown[] = [];
  const onHint = (event: Event) =>
    hints.push((event as CustomEvent<unknown>).detail);
  window.addEventListener(IDENTITY_FALLBACK_HINT_EVENT, onHint);
  const dispose = subscribeToChatInvalidations(
    queryClient,
    scope,
    () => source,
  );

  try {
    source.onmessage!(
      new MessageEvent('message', {
        data: JSON.stringify({
          version: 1,
          type: 'identity-fallback',
          ...payload,
        }),
      }),
    );
    expect(hints).toEqual([]);
    expect(source.close).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  } finally {
    dispose();
    queryClient.clear();
    window.removeEventListener(IDENTITY_FALLBACK_HINT_EVENT, onHint);
  }
});

it('hints for a same-organization fallback without closing the current subscription', () => {
  const queryClient = new QueryClient();
  const source = {
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onopen: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    close: vi.fn(),
  };
  const hints: unknown[] = [];
  const onHint = (event: Event) =>
    hints.push((event as CustomEvent<unknown>).detail);
  window.addEventListener(IDENTITY_FALLBACK_HINT_EVENT, onHint);
  const dispose = subscribeToChatInvalidations(
    queryClient,
    scope,
    () => source,
  );

  try {
    source.onmessage!(
      new MessageEvent('message', {
        data: JSON.stringify({
          version: 1,
          type: 'identity-fallback',
          reason: 'selection_repaired',
          orgId: scope.orgId,
        }),
      }),
    );
    expect(hints).toEqual([{ reason: 'selection_repaired' }]);
    expect(source.close).not.toHaveBeenCalled();
  } finally {
    dispose();
    queryClient.clear();
    window.removeEventListener(IDENTITY_FALLBACK_HINT_EVENT, onHint);
  }
});

it('subscribes with cookies and invalidates exact owner-scoped list and thread keys', async () => {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
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
    invalidateQueries.mock.calls.map(([filter]) => filter?.queryKey),
  ).toEqual([
    ['tenant', scope.orgId, 'chat', scope.userId, 'list'],
    ['tenant', scope.orgId, 'chat', scope.userId, 'thread', chatId],
  ]);
  dispose();
  expect(source!.close).toHaveBeenCalledOnce();
  queryClient.clear();
});

it('refreshes owner chat queries on EventSource open and error', async () => {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
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
  await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1));
  source!.onerror!(new Event('error'));
  await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2));
  expect(
    invalidateQueries.mock.calls.map(([filter]) => filter?.queryKey),
  ).toEqual([
    ['tenant', scope.orgId, 'chat', scope.userId],
    ['tenant', scope.orgId, 'chat', scope.userId],
  ]);
  dispose();
  expect(source!.onopen).toBeNull();
  expect(source!.onerror).toBeNull();
  queryClient.clear();
});

it('publishes an owner-title recovery signal when the EventSource first opens', () => {
  const queryClient = new QueryClient();
  let source:
    | {
        onmessage: ((event: MessageEvent<string>) => void) | null;
        onopen: ((event: Event) => void) | null;
        onerror: ((event: Event) => void) | null;
        close: ReturnType<typeof vi.fn>;
      }
    | undefined;
  const callbackNotifications: Array<string | null> = [];
  const dispose = subscribeToChatInvalidations(
    queryClient,
    scope,
    () => {
      const created = {
        onmessage: null,
        onopen: null,
        onerror: null,
        close: vi.fn(),
      };
      source = created;
      return created;
    },
    (invalidatedChatId) => callbackNotifications.push(invalidatedChatId),
  );

  try {
    source!.onopen!(new Event('open'));
    expect(callbackNotifications).toEqual([null]);
    source!.onmessage!(
      new MessageEvent('message', {
        data: JSON.stringify({
          version: 1,
          type: 'chat.invalidated',
          chatId,
        }),
      }),
    );
    expect(callbackNotifications).toEqual([null, chatId]);
  } finally {
    dispose();
    queryClient.clear();
  }
});

it('publishes coalesced reconnect recovery to the mounted title consumer', async () => {
  vi.useFakeTimers();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  let source:
    | {
        onmessage: ((event: MessageEvent<string>) => void) | null;
        onopen: ((event: Event) => void) | null;
        onerror: ((event: Event) => void) | null;
        close: ReturnType<typeof vi.fn>;
      }
    | undefined;
  const callbackNotifications: Array<string | null> = [];
  const dispose = subscribeToChatInvalidations(
    queryClient,
    scope,
    () => {
      const created = {
        onmessage: null,
        onopen: null,
        onerror: null,
        close: vi.fn(),
      };
      source = created;
      return created;
    },
    (invalidatedChatId) => callbackNotifications.push(invalidatedChatId),
  );

  try {
    source!.onopen!(new Event('open'));
    expect(callbackNotifications).toEqual([null]);
    source!.onerror!(new Event('error'));
    expect(callbackNotifications).toEqual([null, null]);
    source!.onopen!(new Event('open'));
    expect(callbackNotifications).toEqual([null, null]);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(callbackNotifications).toEqual([null, null]);
    await vi.advanceTimersByTimeAsync(1);
    expect(callbackNotifications).toEqual([null, null, null]);

    source!.onerror!(new Event('error'));
    expect(callbackNotifications).toEqual([null, null, null]);
    dispose();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(callbackNotifications).toEqual([null, null, null]);
    expect(source!.close).toHaveBeenCalledOnce();
    expect(source!.onopen).toBeNull();
    expect(source!.onerror).toBeNull();
  } finally {
    dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    queryClient.clear();
  }
});

it('refetches after reconnect when an invalidation may have been missed offline', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let serverTitle = 'Excerpt title';
  const queryFn = vi.fn(async () => serverTitle);
  const observer = new QueryObserver(queryClient, {
    queryKey: chatListQueryKey(scope),
    queryFn,
    staleTime: Infinity,
  });
  const stopObserving = observer.subscribe(() => {});
  await observer.refetch();
  expect(observer.getCurrentResult().data).toBe('Excerpt title');

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
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  source!.onerror!(new Event('error'));
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3));
  expect(observer.getCurrentResult().data).toBe('Excerpt title');

  vi.useFakeTimers();
  serverTitle = 'Updated while disconnected';
  source!.onopen!(new Event('open'));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(queryFn).toHaveBeenCalledTimes(4);
  expect(observer.getCurrentResult().data).toBe('Updated while disconnected');

  dispose();
  stopObserving();
  queryClient.clear();
  vi.useRealTimers();
});

it.each([
  { label: 'chat list', key: chatListQueryKey(scope), trigger: 'event' },
  {
    label: 'chat thread',
    key: chatThreadQueryKey(scope, chatId),
    trigger: 'event',
  },
  {
    label: 'chat thread on initial open',
    key: chatThreadQueryKey(scope, chatId),
    trigger: 'open',
  },
] as const)(
  'refreshes an initial in-flight $label after invalidation',
  async ({ key, trigger }) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const otherScope = {
      orgId: '00000000-0000-4000-8000-000000000011',
      userId: '00000000-0000-4000-8000-000000000012',
    };
    const otherKey =
      key.length === chatListQueryKey(scope).length
        ? chatListQueryKey(otherScope)
        : chatThreadQueryKey(otherScope, chatId);
    queryClient.setQueryData(otherKey, ['other tenant']);
    let serverTitle = 'Old server title';
    let resolveInitialFetch: ((title: string) => void) | undefined;
    let resolveInitialStarted: (() => void) | undefined;
    const initialStarted = new Promise<void>((resolve) => {
      resolveInitialStarted = resolve;
    });
    const initialFetch = new Promise<string>((resolve) => {
      resolveInitialFetch = resolve;
    });
    let queryCount = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: async () => {
        queryCount++;
        if (queryCount === 1) {
          resolveInitialStarted?.();
          return initialFetch;
        }
        return serverTitle;
      },
      staleTime: Infinity,
    });
    const stopObserving = observer.subscribe(() => {});
    let source:
      | {
          onmessage: ((event: MessageEvent<string>) => void) | null;
          onopen: ((event: Event) => void) | null;
          onerror: ((event: Event) => void) | null;
          close: () => void;
        }
      | undefined;
    const receivedInvalidation = vi.fn();
    const dispose = subscribeToChatInvalidations(
      queryClient,
      scope,
      () => {
        const created = {
          onmessage: null,
          onopen: null,
          onerror: null,
          close: vi.fn(),
        };
        source = created;
        return created;
      },
      receivedInvalidation,
    );

    try {
      await initialStarted;
      expect(observer.getCurrentResult().data).toBeUndefined();
      serverTitle = 'Updated server title';
      if (trigger === 'event') {
        source!.onmessage!(
          new MessageEvent('message', {
            data: JSON.stringify({
              version: 1,
              type: 'chat.invalidated',
              chatId,
            }),
          }),
        );
        expect(receivedInvalidation).toHaveBeenCalledWith(chatId);
      } else source!.onopen!(new Event('open'));

      resolveInitialFetch?.('Old server title');
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data).toBe('Updated server title'),
      );
      expect(observer.getCurrentResult().data).toBe('Updated server title');
      expect(queryCount).toBeGreaterThan(1);
      expect(queryClient.getQueryData(otherKey)).toEqual(['other tenant']);
      expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
    } finally {
      resolveInitialFetch?.('Old server title');
      dispose();
      stopObserving();
      queryClient.clear();
    }
  },
);

it('cancels a throttled reconnect refresh when the subscription is disposed', async () => {
  vi.useFakeTimers();
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
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
  expect(invalidateQueries).toHaveBeenCalledTimes(1);
  source!.onerror!(new Event('error'));
  expect(invalidateQueries).toHaveBeenCalledTimes(2);
  source!.onopen!(new Event('open'));
  expect(invalidateQueries).toHaveBeenCalledTimes(2);
  dispose();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(invalidateQueries).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
  queryClient.clear();
});

it('rejects malformed or content-bearing invalidations', async () => {
  const client = new QueryClient();
  const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
  await expect(
    invalidateChatQueriesForEvent(client, scope, {
      version: 1,
      type: 'chat.invalidated',
      chatId,
      title: 'must not be streamed',
    }),
  ).resolves.toBe(false);
  expect(invalidateQueries).not.toHaveBeenCalled();
  client.clear();
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
    client.getQueriesData({
      queryKey: ['tenant', scope.orgId, 'chat', scope.userId],
    }),
  ).toEqual([]);
});
