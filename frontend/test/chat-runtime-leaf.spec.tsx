import { expect, it, vi } from 'vitest';
import type { ChatTree } from '@lexon/contracts';
import { createLeafStore } from '../src/components/chat/chat-runtime.js';
import { LexonChatTransport } from '../src/lib/chat-transport.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const leafA = '33333333-3333-4333-8333-333333333333';
const leafB = '44444444-4444-4444-8444-444444444444';
const newUserId = '55555555-5555-4555-8555-555555555555';
const runId = '66666666-6666-4666-8666-666666666666';

function answer(id: string, parentId: string) {
  return {
    id,
    role: 'assistant' as const,
    parentId,
    runId,
    text: id,
    status: 'completed' as const,
    reasoningSummary: null,
    reasoningDurationMs: null,
    feedback: null,
    operations: [],
    createdAt: '2026-11-11T00:00:01.000Z',
  };
}
function tree(leaves: readonly string[], viewedLeafId: string): ChatTree {
  return {
    id: chatId,
    title: 'Leaf',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Q',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      ...leaves.map((id) => answer(id, userId)),
    ],
    viewedLeafId,
  } as ChatTree;
}

it("when the viewed leaf is deleted, the selection falls back to the tree's viewedLeafId", () => {
  const store = createLeafStore(leafA);
  store.setSelectedLeafId(leafA);
  expect(store.getSelectedLeafId()).toBe(leafA);
  store.syncFromTree(tree([leafB], leafB));
  expect(store.getSelectedLeafId()).toBe(leafB);
});

it('keeps a selection that still exists in the refreshed tree', () => {
  const store = createLeafStore(leafA);
  store.syncFromTree(tree([leafA, leafB], leafB));
  expect(store.getSelectedLeafId()).toBe(leafA);
});

it("the transport reads the store's leaf", async () => {
  const store = createLeafStore(leafA);
  const bodies: { parentMessageId?: string | null }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/events'))
      return new Response('', {
        headers: { 'x-lexon-stream-recovery-result': 'snapshot' },
      });
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(
      {
        chatId,
        userMessageId: newUserId,
        assistantMessageId: leafB,
        runId,
      },
      { status: 201 },
    );
  });
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    getSelectedLeafId: store.getSelectedLeafId,
    setSelectedLeafId: store.setSelectedLeafId,
    fetch,
  });
  store.setSelectedLeafId(leafB);
  await transport
    .sendMessages({
      trigger: 'submit-message',
      chatId,
      messageId: undefined,
      messages: [
        {
          id: newUserId,
          role: 'user',
          parts: [{ type: 'text', text: 'Next' }],
        },
      ],
      abortSignal: undefined,
    })
    .catch(() => undefined);
  expect(bodies[0]?.parentMessageId).toBe(leafB);
  expect(store.getSelectedLeafId()).toBe(leafB);
});

it('a failed save rolls the selection back, and a later sync does not re-select the unsaved leaf', async () => {
  const store = createLeafStore(leafA);
  const transport = new LexonChatTransport({
    baseUrl: '/api',
    chatId,
    actorScope: 'tenant-1:user-1',
    getSelectedLeafId: store.getSelectedLeafId,
    setSelectedLeafId: store.setSelectedLeafId,
    fetch: vi.fn(),
  });
  await expect(
    transport.selectLeaf(leafB, async () => {
      throw new Error('safe failure');
    }),
  ).rejects.toThrow('safe failure');
  expect(store.getSelectedLeafId()).toBe(leafA);
  store.syncFromTree(tree([leafA, leafB], leafA));
  expect(store.getSelectedLeafId()).toBe(leafA);
});
