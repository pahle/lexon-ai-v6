import { ActionBarPrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { useAuiState } from '@assistant-ui/react';
import type { ChatTree } from '@lexon/contracts';
import { expect, it } from 'vitest';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import threadSource from '../src/components/assistant-ui/elements/thread.aui.tsx?raw';
import { render } from './render.js';

// Contract with @assistant-ui/react 0.15.x. If this file goes red after an
// upgrade, the library moved something Lexon relies on (spec F4.2 item 18).

const chatId = '11111111-1111-4111-8111-111111111111';
const u1 = '22222222-2222-4222-8222-222222222222';
const a1 = '33333333-3333-4333-8333-333333333333';
const u2 = '44444444-4444-4444-8444-444444444444';
const a2 = '55555555-5555-4555-8555-555555555555';
const runId = '66666666-6666-4666-8666-666666666666';

const user = (id: string, parentId: string | null) => ({
  id,
  role: 'user' as const,
  parentId,
  text: `Q ${id.slice(0, 2)}`,
  effort: 'high' as const,
  createdAt: '2026-11-11T00:00:00.000Z',
});
const assistant = (id: string, parentId: string) => ({
  id,
  role: 'assistant' as const,
  parentId,
  runId,
  text: `A ${id.slice(0, 2)}`,
  status: 'completed' as const,
  reasoningSummary: null,
  reasoningDurationMs: null,
  feedback: null,
  operations: [],
  createdAt: '2026-11-11T00:00:01.000Z',
});
const tree = (messages: ChatTree['messages'], viewedLeafId: string) =>
  ({ id: chatId, title: 'Contract', messages, viewedLeafId }) as ChatTree;

const beforeEdit = tree([user(u1, null), assistant(a1, u1)], a1);
// The edit is a sibling user message under the same parent (null).
const editedBothBranches = tree(
  [user(u1, null), assistant(a1, u1), user(u2, null), assistant(a2, u2)],
  a2,
);
const editedPruned = tree([user(u2, null), assistant(a2, u2)], a2);

function Row() {
  const id = useAuiState((s) => s.message.id);
  const branchCount = useAuiState((s) => s.message.branchCount);
  const parentId = useAuiState((s) => s.message.parentId);
  return (
    <div
      data-row={id}
      data-branches={branchCount}
      data-parent={parentId ?? 'root'}
    />
  );
}
function Session(props: { readonly tree: ChatTree }) {
  return (
    <ChatRuntime actorScope="tenant-1:user-1" chatId={chatId} tree={props.tree}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages>{() => <Row />}</ThreadPrimitive.Messages>
      </ThreadPrimitive.Root>
    </ChatRuntime>
  );
}
function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-row]')].map(
    (el) => ({
      id: el.dataset.row,
      branches: Number(el.dataset.branches),
      parent: el.dataset.parent,
    }),
  );
}

it('the Regenerate fix imports from @assistant-ui/react', () => {
  const source = threadSource;
  const imported =
    /import \{[^}]*\bActionBarPrimitive\b[^}]*\} from '([^']+)'/s.exec(source);
  expect(imported?.[1]).toBe('@assistant-ui/react');
  expect(source).toContain('<ActionBarPrimitive.Reload');
  expect(typeof ActionBarPrimitive.Reload).toBe('object');
});

it('editing a message prunes the old branch', async () => {
  const view = await render(<Session tree={editedBothBranches} />);
  try {
    // Two sibling roots: the visible user message reports two branches.
    const both = rows(view.container);
    expect(both.map((row) => row.id)).toEqual([u2, a2]);
    expect(both[0]).toMatchObject({ branches: 2, parent: 'root' });
  } finally {
    await view.unmount();
  }
  const pruned = await render(<Session tree={editedPruned} />);
  try {
    const after = rows(pruned.container);
    expect(after.map((row) => row.id)).toEqual([u2, a2]);
    expect(after[0]).toMatchObject({ branches: 1, parent: 'root' });
    expect(after[1]).toMatchObject({ branches: 1, parent: u2 });
  } finally {
    await pruned.unmount();
  }
});

it('message ids are stable across a reload of the same tree', async () => {
  const first = await render(<Session tree={beforeEdit} />);
  const ids1 = rows(first.container).map((row) => row.id);
  await first.unmount();
  const second = await render(<Session tree={beforeEdit} />);
  const ids2 = rows(second.container).map((row) => row.id);
  await second.unmount();
  expect(ids1).toEqual([u1, a1]);
  expect(ids2).toEqual(ids1);
});
