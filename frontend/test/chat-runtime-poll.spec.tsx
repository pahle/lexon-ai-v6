import { ThreadPrimitive } from '@assistant-ui/react';
import type { ChatDetail } from '@lexon/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import { createChatClient } from '../src/lib/chat-client.js';
import { render } from './render.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const assistantId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const active = {
  id: chatId,
  title: 'Poll',
  access: 'owner',
  messages: [
    {
      id: userId,
      role: 'user',
      parentId: null,
      text: 'Q',
      effort: 'high',
      createdAt: '2026-11-11T00:00:00.000Z',
    },
    {
      id: assistantId,
      role: 'assistant',
      parentId: userId,
      runId,
      text: 'Partial',
      status: 'running',
      reasoningSummary: null,
      reasoningDurationMs: null,
      feedback: null,
      operations: [],
      createdAt: '2026-11-11T00:00:01.000Z',
    },
  ],
  viewedLeafId: assistantId,
} as ChatDetail;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reload with an active run: the first reconcile happens at 1 s, before any stream frame', async () => {
  const onTreeRefresh = vi.fn(async () => ({
    notModified: false as const,
    tree: active,
    etag: 'W/"v1.etag-1"',
  }));
  const view = await render(
    <ChatRuntime
      actorScope="tenant-1:user-1"
      chatId={chatId}
      tree={active}
      onTreeRefresh={onTreeRefresh}
    >
      <ThreadPrimitive.Root />
    </ChatRuntime>,
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(onTreeRefresh).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it('a 304 stores the tag for the next poll and updates no state', async () => {
  const onTreeUpdate = vi.fn();
  const seen: Array<string | undefined> = [];
  const onTreeRefresh = vi.fn(
    (_signal: AbortSignal, ifNoneMatch: string | undefined) => {
      seen.push(ifNoneMatch);
      return Promise.resolve({
        notModified: true as const,
        etag: 'W/"v1.unmodified"',
      });
    },
  );
  const view = await render(
    <ChatRuntime
      actorScope="tenant-1:user-1"
      chatId={chatId}
      tree={active}
      onTreeRefresh={onTreeRefresh}
      onTreeUpdate={onTreeUpdate}
    >
      <ThreadPrimitive.Root />
    </ChatRuntime>,
  );
  // First poll sends nothing, stores the tag; the second poll resends it.
  await vi.advanceTimersByTimeAsync(1_000);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(seen).toEqual([undefined, 'W/"v1.unmodified"']);
  // A 304 keeps the canonical tree object: nothing was applied.
  expect(onTreeUpdate).not.toHaveBeenCalled();
  await view.unmount();
});

it('unmounting during an in-flight poll aborts the tree fetch signal', async () => {
  const requests: { url: unknown; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown, init?: RequestInit) => {
      requests.push({ url, init });
      return new Promise<Response>(() => undefined);
    }),
  );
  const client = createChatClient({ baseUrl: '/api' });
  const view = await render(
    <ChatRuntime
      actorScope="tenant-1:user-1"
      chatId={chatId}
      tree={active}
      onTreeRefresh={(signal, ifNoneMatch) =>
        client.get(chatId, { signal, ifNoneMatch })
      }
    >
      <ThreadPrimitive.Root />
    </ChatRuntime>,
  );
  await vi.advanceTimersByTimeAsync(1_000);
  const treeRequests = requests.filter(
    (request) => request.url === `/api/chats/${chatId}`,
  );
  expect(treeRequests).toHaveLength(1);
  await view.unmount();
  expect(treeRequests[0]!.init?.signal?.aborted).toBe(true);
});
