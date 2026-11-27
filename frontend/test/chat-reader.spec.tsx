import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatTree } from '@lexon/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import { Thread } from '../src/components/assistant-ui/elements/thread.aui.js';
import { render, settle } from './render.js';

// F6 §10: the recipient view is read-only — the composer, decision docks and
// per-message mutation controls never render; the read-only bar names the
// owner ("Shared by <name> · read-only" standalone, "<name>'s chat ·
// read-only" on a matter) and pending operations read "Waiting for <name>".

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
const workspaceState = vi.hoisted(() => ({ setChatTitle: vi.fn() }));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => ({
    setChatTitle: workspaceState.setChatTitle,
    chatTitleRefreshVersion: 0,
  }),
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: vi.fn(() => vi.fn()),
}));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const assistantId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const snapshotHash = 'a'.repeat(64);

function readerDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: chatId,
    title: 'Due diligence checklist',
    access: 'reader' as const,
    ownerName: 'Andi Wijaya',
    messages: [
      {
        id: userId,
        role: 'user' as const,
        parentId: null,
        text: 'Checklist please.',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: assistantId,
        role: 'assistant' as const,
        parentId: userId,
        runId,
        text: 'Here is the checklist.',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        operations: [],
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: assistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:01.000Z',
    ...overrides,
  } as ChatTree;
}

function pendingReaderDetail() {
  const detail = readerDetail();
  detail.messages[1] = {
    ...(detail.messages[1] as Record<string, unknown>),
    status: 'awaiting_approval',
    // The reader's ops are payload-stripped: only the core the "Waiting for"
    // marker needs.
    operations: [
      {
        operationId: '55555555-5555-4555-8555-555555555555',
        kind: 'approval',
        status: 'awaiting_approval',
        approvalRequired: true,
        snapshotHash,
        expiresAt: '2026-11-25T10:42:00.000Z',
        decidedAt: null,
        toolName: 'rename_chat',
      },
    ],
  } as ChatTree['messages'][number];
  return detail;
}

async function mount(detail: ChatTree) {
  const view = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatRuntime actorScope="tenant-1:user-1" chatId={chatId} tree={detail}>
        <Thread displayName="Rina" />
      </ChatRuntime>
    </QueryClientProvider>,
  );
  await settle();
  return view;
}

it('reader sees the "Shared by <name> · read-only" bar and no composer or decision controls', async () => {
  const view = await mount(readerDetail());
  try {
    expect(view.container.textContent).toContain(
      'Shared by Andi Wijaya · read-only',
    );
    expect(
      view.container.querySelector('[aria-label="Message input"]'),
    ).toBeNull();
    expect(view.container.textContent).not.toContain('Deep thinking');
    // Copy stays; every mutating action is gone.
    expect(
      view.container.querySelector('[aria-label="Good answer"]'),
    ).toBeNull();
    expect(
      view.container.querySelector('[aria-label="Bad answer"]'),
    ).toBeNull();
    expect(
      view.container.querySelector('[aria-label="Regenerate answer"]'),
    ).toBeNull();
    expect(
      view.container.querySelector('[aria-label="Edit message"]'),
    ).toBeNull();
    expect(
      [...view.container.querySelectorAll('button')].filter((b) =>
        /^(Approve|Reject|Answer)$/.test(b.textContent ?? ''),
      ),
    ).toHaveLength(0);
  } finally {
    await view.unmount();
  }
});

it('a project-bound chat reads "<name>\u2019s chat · read-only"; an unresolvable owner falls back to the generic label', async () => {
  const matter = await mount(
    readerDetail({ projectName: 'PT Sinar Abadi — wanprestasi' }),
  );
  try {
    expect(matter.container.textContent).toContain(
      'Andi Wijaya’s chat · read-only',
    );
  } finally {
    await matter.unmount();
  }
  const anonymous = await mount(readerDetail({ ownerName: undefined }));
  try {
    expect(anonymous.container.textContent).toContain('read-only');
    expect(anonymous.container.textContent).not.toContain('Shared by');
  } finally {
    await anonymous.unmount();
  }
});

it('a pending operation reads "Waiting for <owner>" for the reader', async () => {
  const view = await mount(pendingReaderDetail());
  try {
    expect(view.container.textContent).toContain('Waiting for Andi Wijaya');
    expect(view.container.textContent).not.toContain('Waiting for you');
    expect(
      [...view.container.querySelectorAll('button')].filter((b) =>
        /^(Approve|Reject)$/.test(b.textContent ?? ''),
      ),
    ).toHaveLength(0);
  } finally {
    await view.unmount();
  }
});
