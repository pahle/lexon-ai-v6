import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import type { ChatApi, ChatTree } from '@lexon/contracts';
import { expect, it, vi } from 'vitest';
import { ChatView } from '../src/components/chat/chat-view.js';
import { render, settleUntil } from './render.js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
const workspaceState = vi.hoisted(() => ({ setChatTitle: vi.fn() }));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    setChatTitle: workspaceState.setChatTitle,
    chatTitleRefreshVersion: 0,
    identity: {
      organization: { id: 'org-1' },
      user: { id: 'user-1' },
    },
  }),
}));

// B-19: the canonical tree handed to ChatRuntime is captured so an
// updateCanonicalTree call can be driven directly and the tree object
// identity observed.
const runtimeProps = vi.hoisted(() => ({
  seen: [] as Array<{
    tree: ChatTree;
    onTreeUpdate?: ((tree: ChatTree) => void) | undefined;
  }>,
}));
vi.mock('../src/components/chat/chat-runtime.js', () => ({
  ChatRuntime: (props: {
    tree: ChatTree;
    onTreeUpdate?: ((tree: ChatTree) => void) | undefined;
    children?: ReactNode;
  }) => {
    runtimeProps.seen.push(props);
    return null;
  },
}));

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const assistantId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';

const tree: ChatTree = {
  id: chatId,
  title: 'Canonical',
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
      text: 'A',
      status: 'completed',
      reasoningSummary: null,
      reasoningDurationMs: null,
      feedback: null,
      createdAt: '2026-11-11T00:00:01.000Z',
    },
  ],
  viewedLeafId: assistantId,
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:01.000Z',
};

function view() {
  const client = {
    get: vi.fn(async () => ({
      notModified: false as const,
      tree,
      etag: null,
    })),
  } as unknown as ChatApi;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatView
        chatId={chatId}
        actorScope="tenant-1:user-1"
        displayName="Ayu Wardani"
        client={client}
        orgId="o"
        userId="u"
      />
    </QueryClientProvider>,
  );
}

it('keeps the canonical tree object when a refresh returns a structurally equal tree', async () => {
  runtimeProps.seen.length = 0;
  const rendered = await view();
  try {
    await settleUntil(() => runtimeProps.seen.length > 0);
    expect(runtimeProps.seen.at(-1)!.tree).toBe(tree);
    const update = runtimeProps.seen.at(-1)!.onTreeUpdate!;
    const equalCopy = JSON.parse(JSON.stringify(tree)) as ChatTree;
    expect(equalCopy).not.toBe(tree);
    await act(async () => {
      update(equalCopy);
    });
    expect(runtimeProps.seen.at(-1)!.tree).toBe(tree);

    const changed = { ...tree, title: 'Renamed' };
    await act(async () => {
      update(changed);
    });
    expect(runtimeProps.seen.at(-1)!.tree).toBe(changed);
  } finally {
    await rendered.unmount();
  }
});
