import { ThreadPrimitive } from '@assistant-ui/react';
import type { ChatTree } from '@lexon/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import { render } from './render.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const assistantId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const active = {
  id: chatId,
  title: 'Poll',
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
      createdAt: '2026-11-11T00:00:01.000Z',
    },
  ],
  viewedLeafId: assistantId,
} as ChatTree;

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
  const onTreeRefresh = vi.fn(async () => active);
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
