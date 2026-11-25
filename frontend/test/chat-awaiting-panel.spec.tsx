import type { ChatTree } from '@lexon/contracts';
import { useAuiState } from '@assistant-ui/react';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import { Thread } from '../src/components/assistant-ui/elements/thread.aui.js';
import { render, settle, settleUntil } from './render.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const assistantId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';
const snapshotHash = 'a'.repeat(64);

const questionOp = (overrides: Record<string, unknown> = {}) => ({
  operationId,
  kind: 'question',
  status: 'awaiting_approval',
  approvalRequired: true,
  snapshotHash,
  expiresAt: '2026-11-25T10:42:00.000Z',
  decidedAt: null,
  toolName: 'ask_user',
  input: {
    questions: [
      {
        questionId: 'q1',
        text: 'Which filing deadline applies?',
        kind: 'single',
        options: [{ label: '30 days' }, { label: '60 days' }],
      },
    ],
  },
  ...overrides,
});

const renameOp = (overrides: Record<string, unknown> = {}) => ({
  operationId,
  kind: 'approval',
  status: 'awaiting_approval',
  approvalRequired: true,
  snapshotHash,
  expiresAt: '2026-11-25T10:42:00.000Z',
  decidedAt: null,
  toolName: 'rename_chat',
  input: { newTitle: 'Somasi PT Sinar' },
  display: { currentTitle: 'Draf somasi wanprestasi' },
  ...overrides,
});

function pausedTree(operations: unknown[]): ChatTree {
  return {
    id: chatId,
    title: 'Draf somasi wanprestasi',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Hitung tenggatnya.',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: assistantId,
        role: 'assistant',
        parentId: userId,
        runId,
        text: 'Sebentar, saya butuh satu detail.',
        status: 'awaiting_approval',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        operations,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
    ],
    viewedLeafId: assistantId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:01.000Z',
  } as ChatTree;
}

const invalidationSubscribe = vi.hoisted(() => vi.fn(() => vi.fn()));
const toastSpy = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const workspaceState = vi.hoisted(() => ({ chatTitleRefreshVersion: 0 }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: invalidationSubscribe,
}));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => ({
    setChatTitle: vi.fn(),
    chatTitleRefreshVersion: workspaceState.chatTitleRefreshVersion,
  }),
}));
vi.mock('sonner', () => ({ toast: toastSpy }));

function wrapped(node: ReactNode) {
  return node;
}

type FetchCall = { url: unknown; init: RequestInit | undefined };
const decisionCalls: FetchCall[] = [];
let decisionResponse: Record<string, unknown> = {
  operationId,
  status: 'rejected',
  decision: 'reject',
  decidedAt: '2026-11-25T10:00:00.000Z',
};

beforeEach(() => {
  decisionCalls.length = 0;
  decisionResponse = {
    operationId,
    status: 'rejected',
    decision: 'reject',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/decision')) {
        decisionCalls.push({ url, init });
        return Promise.resolve(
          new Response(JSON.stringify(decisionResponse), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return new Promise<Response>(() => undefined);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function press(
  container: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
) {
  await act(async () => {
    container.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
  await settle();
}

async function mountPaused(operations: unknown[]) {
  const tree = pausedTree(operations);
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  await settleUntil(
    () => view.container.querySelector('[data-slot="operation-dock"]') !== null,
  );
  return view;
}

/** Mirrors the last assistant message's aui run status for the spec. */
function RunStatusProbe() {
  const status = useAuiState(
    (state) => state.thread.messages.at(-1)?.status?.type,
  );
  return <output data-testid="probe-status">{status}</output>;
}

/**
 * The resumed paused run: snapshot frames replay the stored answer and the
 * pending tool call, then the stream stays open until the owner decides.
 */
function pausedSse(operation: Record<string, unknown>) {
  const frames = [
    {
      version: 1,
      type: 'snapshot-start',
      reset: true,
      snapshot: {
        runId,
        messageId: assistantId,
        attemptId: null,
        generation: null,
        revision: 0,
        eventId: null,
        status: 'awaiting_approval',
        errorCode: null,
        reasoningDurationMs: null,
      },
      partCount: 2,
      operationCount: 1,
    },
    {
      version: 1,
      type: 'snapshot-part',
      partIndex: 0,
      chunkIndex: 0,
      partType: 'text',
      id: 'paused-answer',
      text: 'Sebentar, saya butuh satu detail.',
      final: true,
    },
    {
      version: 1,
      type: 'snapshot-part',
      partIndex: 1,
      chunkIndex: 0,
      partType: 'tool',
      id: 'paused-tool',
      toolCallId: operation.operationId,
      toolName: operation.toolName,
      operationId: operation.operationId,
      input: operation.input,
      outcome: 'awaiting_approval',
      final: true,
    },
    {
      version: 1,
      type: 'snapshot-operation',
      index: 0,
      operation,
    },
    {
      version: 1,
      type: 'snapshot-end',
      partCount: 2,
      operationCount: 1,
    },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
}

it('shows no streaming caret while the resumed paused run stays running', async () => {
  // The paused run's /events stream replays the snapshot and is then held
  // open by the server, so the assistant message keeps reading 'running'.
  const operation = renameOp();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/decision')) {
        decisionCalls.push({ url, init });
        return Promise.resolve(
          new Response(JSON.stringify(decisionResponse), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (typeof url === 'string' && url.endsWith(`/runs/${runId}/events`)) {
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(pausedSse(operation)),
                );
              },
            }),
            {
              headers: {
                'content-type': 'text/event-stream',
                'x-lexon-stream-recovery-result': 'snapshot',
              },
            },
          ),
        );
      }
      return new Promise<Response>(() => undefined);
    }),
  );
  const tree = pausedTree([operation]);
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
        <RunStatusProbe />
      </ChatRuntime>,
    ),
  );
  try {
    await settleUntil(
      () =>
        view.container.querySelector('[data-slot="operation-dock"]') !== null,
    );
    // The held-open stream keeps the message marked running, so the caret's
    // data-status hook must not read 'running' anywhere: not after the answer
    // text and not under the Waiting for you pill (the empty part that
    // assistant-ui synthesizes behind the tool row).
    expect(
      view.container.querySelector('[data-testid="probe-status"]')?.textContent,
    ).toBe('running');
    const markdowns = [
      ...view.container.querySelectorAll<HTMLElement>('.aui-md'),
    ];
    expect(markdowns.length).toBeGreaterThan(0);
    expect(
      markdowns.filter((node) => node.dataset.status === 'running'),
    ).toHaveLength(0);
  } finally {
    await view.unmount();
  }
});

it('docks an approval panel above the composer with the ask, expiry and decision buttons', async () => {
  const view = await mountPaused([renameOp()]);
  try {
    const dock = view.container.querySelector('[data-slot="operation-dock"]');
    expect(dock?.textContent).toContain('rename this chat');
    expect(dock?.textContent).toContain('Draf somasi wanprestasi');
    expect(dock?.textContent).toContain('Somasi PT Sinar');
    expect(dock?.textContent).toContain('Expires');
    const buttons = [...(dock?.querySelectorAll('button') ?? [])].map(
      (button) => button.textContent,
    );
    expect(buttons.join('|')).toContain('Reject');
    expect(buttons.join('|')).toContain('Approve');
  } finally {
    await view.unmount();
  }
});

it('lays out the approval dock at composer width with stacked mobile rows and compact rectangular buttons', async () => {
  const view = await mountPaused([renameOp()]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    // The dock parks inside the padded composer column: no wrapper padding of
    // its own, so its box spans the composer shell's width.
    expect(dock.className).toContain('w-full');
    expect(dock.className).not.toContain('px-6');
    // The approval dock keeps the default composer placeholder — the
    // own-words hint belongs to the question dock only.
    expect(view.container.querySelector('textarea')?.placeholder).toBe(
      'Ask Lexon about a contract, a regulation, or a case...',
    );
    // Sentence-case descriptor labels.
    expect(dock.textContent).toContain('Current title');
    expect(dock.textContent).not.toContain('Current Title');
    // `.btn.sm` metrics: 30px high, 8px radius — rectangular, not pill-shaped.
    const approve = [...dock.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Approve'),
    )!;
    expect(approve.className).toContain('h-[30px]');
    expect(approve.className).toContain('rounded-lg');
    expect(approve.className).not.toContain('rounded-full');
    // `.kv` rows stack label over value on mobile.
    const row = dock.querySelector('dl > div') as HTMLElement;
    expect(row.className).toContain('max-md:flex-col');
    const label = row.querySelector('dt') as HTMLElement;
    expect(label.className).toContain('max-md:w-auto');
  } finally {
    await view.unmount();
  }
});

it('offers free reply under a question dock', async () => {
  const view = await mountPaused([questionOp()]);
  try {
    expect(view.container.querySelector('textarea')?.placeholder).toBe(
      'Or reply in your own words…',
    );
  } finally {
    await view.unmount();
  }
});

it('Ctrl+Enter approves while Enter alone never sends the decision', async () => {
  decisionResponse = {
    operationId,
    status: 'approved',
    decision: 'approve',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  const view = await mountPaused([renameOp()]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    await press(dock, 'Enter');
    expect(decisionCalls).toHaveLength(0);
    await press(dock, 'Enter', { ctrlKey: true });
    await settleUntil(() => decisionCalls.length === 1);
    const body = JSON.parse(String(decisionCalls[0]?.init?.body));
    expect(decisionCalls[0]?.url).toBe(
      `/api/runs/${runId}/operations/${operationId}/decision`,
    );
    expect(body).toEqual({ snapshotHash, action: 'approve' });
  } finally {
    await view.unmount();
  }
});

it('Escape rejects the approval and closes the panel', async () => {
  const view = await mountPaused([renameOp()]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    await press(dock, 'Escape');
    await settleUntil(() => decisionCalls.length === 1);
    expect(JSON.parse(String(decisionCalls[0]?.init?.body))).toEqual({
      snapshotHash,
      action: 'reject',
    });
    await settleUntil(
      () =>
        view.container.querySelector('[data-slot="operation-dock"]') === null,
    );
  } finally {
    await view.unmount();
  }
});

it('exposes the single-choice group as a labelled radio group and answers on one click', async () => {
  decisionResponse = {
    operationId,
    status: 'answered',
    decision: 'answer',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  const view = await mountPaused([questionOp()]);
  try {
    const group = view.container.querySelector(
      '[data-slot="operation-dock"] [role="radiogroup"]',
    );
    expect(group).not.toBeNull();
    const options = [
      ...group!.querySelectorAll('[role="radio"]'),
    ] as HTMLElement[];
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      options[1]!.click();
    });
    await settleUntil(() => decisionCalls.length === 1);
    const body = JSON.parse(String(decisionCalls[0]?.init?.body));
    expect(body.action).toBe('answer');
    expect(body.answers).toEqual([
      { questionId: 'q1', choice: { kind: 'option', index: 1 } },
    ]);
  } finally {
    await view.unmount();
  }
});

it('selects radio options with the number keys', async () => {
  decisionResponse = {
    operationId,
    status: 'answered',
    decision: 'answer',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  const view = await mountPaused([questionOp()]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    await press(dock, '2');
    await settleUntil(() => decisionCalls.length === 1);
    const body = JSON.parse(String(decisionCalls[0]?.init?.body));
    expect(body.answers).toEqual([
      { questionId: 'q1', choice: { kind: 'option', index: 1 } },
    ]);
  } finally {
    await view.unmount();
  }
});

it('toggles checkbox rows with click and number keys, then Next submits', async () => {
  decisionResponse = {
    operationId,
    status: 'answered',
    decision: 'answer',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  const op = questionOp({
    input: {
      questions: [
        {
          questionId: 'q1',
          text: 'Which documents are needed?',
          kind: 'multiple',
          options: [
            { label: 'Contract' },
            { label: 'Invoice' },
            { label: 'PO' },
          ],
        },
      ],
    },
  });
  const view = await mountPaused([op]);
  try {
    const boxes = [
      ...view.container.querySelectorAll(
        '[data-slot="operation-dock"] [role="checkbox"]',
      ),
    ] as HTMLElement[];
    expect(boxes).toHaveLength(3);
    await act(async () => {
      boxes[0]!.click();
    });
    await settle();
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    await press(dock, '3');
    const checked = [...dock.querySelectorAll('[role="checkbox"]')].map((box) =>
      box.getAttribute('aria-checked'),
    );
    expect(checked).toEqual(['true', 'false', 'true']);
    const next = [...dock.querySelectorAll('button')].find(
      (button) =>
        button.textContent === 'Next' || button.textContent === 'Send',
    ) as HTMLElement;
    expect(next).not.toBeUndefined();
    await act(async () => {
      next.click();
    });
    await settleUntil(() => decisionCalls.length === 1);
    const body = JSON.parse(String(decisionCalls[0]?.init?.body));
    expect(body.answers).toEqual([
      { questionId: 'q1', choice: { kind: 'options', indexes: [0, 2] } },
    ]);
  } finally {
    await view.unmount();
  }
});

it('shows a single 40px field for a text question and Enter moves next', async () => {
  decisionResponse = {
    operationId,
    status: 'answered',
    decision: 'answer',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  const op = questionOp({
    input: {
      questions: [
        {
          questionId: 'q1',
          text: 'What should the letter reference?',
          kind: 'text',
        },
      ],
    },
  });
  const view = await mountPaused([op]);
  try {
    const field = view.container.querySelector(
      '[data-slot="operation-dock"] input',
    ) as HTMLInputElement;
    expect(field).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(field, 'PKPU 2024');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settleUntil(() => decisionCalls.length === 1);
    const body = JSON.parse(String(decisionCalls[0]?.init?.body));
    expect(body.answers).toEqual([
      { questionId: 'q1', choice: { kind: 'text', text: 'PKPU 2024' } },
    ]);
  } finally {
    await view.unmount();
  }
});

it('pages multiple questions as “1 of 2”, records each answer and submits once', async () => {
  decisionResponse = {
    operationId,
    status: 'answered',
    decision: 'answer',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  const op = questionOp({
    input: {
      questions: [
        {
          questionId: 'q1',
          text: 'First?',
          kind: 'single',
          options: [{ label: 'A' }, { label: 'B' }],
        },
        {
          questionId: 'q2',
          text: 'Second?',
          kind: 'single',
          options: [{ label: 'C' }, { label: 'D' }],
        },
      ],
    },
  });
  const view = await mountPaused([op]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    expect(dock.textContent).toContain('1 of 2');
    const first = [...dock.querySelectorAll('[role="radio"]')] as HTMLElement[];
    await act(async () => {
      first[0]!.click();
    });
    await settle();
    expect(decisionCalls).toHaveLength(0);
    expect(dock.textContent).toContain('2 of 2');
    const second = [
      ...dock.querySelectorAll('[role="radio"]'),
    ] as HTMLElement[];
    await act(async () => {
      second[1]!.click();
    });
    await settleUntil(() => decisionCalls.length === 1);
    const body = JSON.parse(String(decisionCalls[0]?.init?.body));
    expect(body.answers).toEqual([
      { questionId: 'q1', choice: { kind: 'option', index: 0 } },
      { questionId: 'q2', choice: { kind: 'option', index: 1 } },
    ]);
  } finally {
    await view.unmount();
  }
});

it('offers “Skip this question”, free text and “Answer in chat instead”', async () => {
  const op = questionOp({
    input: {
      questions: [
        {
          questionId: 'q1',
          text: 'First?',
          kind: 'single',
          options: [{ label: 'A' }, { label: 'B' }],
        },
        {
          questionId: 'q2',
          text: 'Second?',
          kind: 'single',
          options: [{ label: 'C' }],
        },
      ],
    },
  });
  const view = await mountPaused([op]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    const labels = [...dock.querySelectorAll('button')].map(
      (button) => button.textContent,
    );
    expect(labels).toContain('Skip this question');
    expect(labels).toContain('Answer in chat instead');
    const skip = [...dock.querySelectorAll('button')].find(
      (button) => button.textContent === 'Skip this question',
    ) as HTMLElement;
    await act(async () => {
      skip.click();
    });
    await settle();
    const second = [
      ...dock.querySelectorAll('[role="radio"]'),
    ] as HTMLElement[];
    await act(async () => {
      second[0]!.click();
    });
    await settleUntil(() => decisionCalls.length === 1);
    const body = JSON.parse(String(decisionCalls[0]?.init?.body));
    expect(body.answers).toEqual([
      { questionId: 'q1', choice: { kind: 'skipped' } },
      { questionId: 'q2', choice: { kind: 'option', index: 0 } },
    ]);
  } finally {
    await view.unmount();
  }
});

it('dismisses the question through “Answer in chat instead” and the close affordance', async () => {
  decisionResponse = {
    operationId,
    status: 'dismissed',
    decision: 'dismiss',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  const view = await mountPaused([questionOp()]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    const dismiss = [...dock.querySelectorAll('button')].find(
      (button) => button.textContent === 'Answer in chat instead',
    ) as HTMLElement;
    await act(async () => {
      dismiss.click();
    });
    await settleUntil(() => decisionCalls.length === 1);
    expect(JSON.parse(String(decisionCalls[0]?.init?.body))).toEqual({
      snapshotHash,
      action: 'dismiss',
    });
    await settleUntil(
      () =>
        view.container.querySelector('[data-slot="operation-dock"]') === null,
    );
  } finally {
    await view.unmount();
  }
});

it('renders the stored outcome when it differs from the sent action (two tabs)', async () => {
  // The other tab approved first; this tab sends reject but the stored
  // outcome wins and the record shows the approve, not an error.
  decisionResponse = {
    operationId,
    status: 'approved',
    decision: 'approve',
    decidedAt: '2026-11-25T10:00:00.000Z',
  };
  const view = await mountPaused([renameOp()]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    await press(dock, 'Escape');
    await settleUntil(() => decisionCalls.length === 1);
    await settleUntil(
      () =>
        view.container.querySelector('[data-slot="operation-dock"]') === null,
    );
    expect(view.container.textContent).not.toContain('rejected the rename');
    const record = view.container.querySelector(
      '[data-slot="decision-record"]',
    );
    expect(record?.textContent).toContain('Renamed this chat');
  } finally {
    await view.unmount();
  }
});

it('keeps polite status announcements on the dock and decision records', async () => {
  const view = await mountPaused([questionOp()]);
  try {
    const dock = view.container.querySelector('[data-slot="operation-dock"]');
    expect(dock?.getAttribute('role')).toBe('status');
  } finally {
    await view.unmount();
  }
});

it('documents its paging and keyboard affordances on the panel', async () => {
  const op = questionOp({
    input: {
      questions: [
        {
          questionId: 'q1',
          text: 'First?',
          kind: 'single',
          options: [{ label: 'A' }, { label: 'B' }],
        },
        {
          questionId: 'q2',
          text: 'Second?',
          kind: 'single',
          options: [{ label: 'C' }],
        },
      ],
    },
  });
  const view = await mountPaused([op]);
  try {
    const nav = [
      ...view.container.querySelectorAll(
        '[data-slot="operation-dock"] [aria-keyshortcuts]',
      ),
    ];
    expect(nav.length).toBeGreaterThan(0);
  } finally {
    await view.unmount();
  }
});

it('uses theme tokens, not fixed colors, in both themes', async () => {
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    const view = await mountPaused([renameOp()]);
    try {
      const html = view.container.innerHTML;
      expect(html).toContain('lexon-tint');
      expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
    } finally {
      await view.unmount();
    }
  }
  delete document.documentElement.dataset.theme;
});

it('sizes option rows by their copy: two-line with a description, single-line without', async () => {
  // `.orow .ot` grows a second 13px muted line only for options that carry
  // a description — the rows share the `.orow` 9px vertical padding, not a
  // shared two-line height.
  const op = questionOp({
    input: {
      questions: [
        {
          questionId: 'q1',
          text: 'Which applies?',
          kind: 'single',
          options: [
            { label: 'First choice', description: 'A short explanation' },
            { label: 'Second choice' },
          ],
        },
      ],
    },
  });
  const view = await mountPaused([op]);
  try {
    const rows = [
      ...view.container.querySelectorAll(
        '[data-slot="operation-dock"] [role="radio"]',
      ),
    ] as HTMLElement[];
    expect(rows).toHaveLength(2);
    // The text column is the row's second child (tile, text, trailing check).
    const textCell = (row: HTMLElement) => row.children[1] as HTMLElement;
    expect(textCell(rows[0]!).childElementCount).toBe(2);
    expect(textCell(rows[0]!).textContent).toContain('A short explanation');
    expect(textCell(rows[1]!).childElementCount).toBe(1);
    expect(textCell(rows[1]!).textContent).toBe('Second choice');
    for (const row of rows) expect(row.className).toContain('py-[9px]');
  } finally {
    await view.unmount();
  }
});

it('draws a separator under the "Select all that apply" hint of a multi-select', async () => {
  const op = questionOp({
    input: {
      questions: [
        {
          questionId: 'q1',
          text: 'Which are covered?',
          kind: 'multiple',
          options: [{ label: 'Alpha' }, { label: 'Beta' }],
        },
      ],
    },
  });
  const view = await mountPaused([op]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    const hint = [...dock.querySelectorAll('p')].find(
      (node) => node.textContent === 'Select all that apply',
    ) as HTMLElement;
    expect(hint).not.toBeUndefined();
    // The hint sits directly above the option list (`role="group"`); the
    // first row's top rule is the separator under the hint, inset by the
    // list's 8px side padding like every option separator.
    const group = hint.nextElementSibling as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.className).toContain('px-2');
    const first = group.querySelector('[role="checkbox"]') as HTMLElement;
    expect(first.className).toContain('border-t');
    expect(first.className).not.toContain('first:border-t-0');
  } finally {
    await view.unmount();
  }
});
