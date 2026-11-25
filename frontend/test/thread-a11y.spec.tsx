import type { ChatTree } from '@lexon/contracts';
import axe from 'axe-core';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import { Thread } from '../src/components/assistant-ui/elements/thread.aui.js';
import { render, settle, settleUntil } from './render.js';

/**
 * §15 dock a11y acceptance (task 10): the operation dock, its option groups,
 * the waiting pill and the stored decision records pass axe in both themes
 * and expose the keyboard contract — arrow paging with documented
 * `aria-keyshortcuts`, groups labelled by the question text, a labelled text
 * field, `role="status"` on the dock and every record, and no positive
 * tabindex surprises. Runs in jsdom, so `color-contrast` stays disabled —
 * the real contrast check lives in the browser axe pass
 * (chat-accessibility.spec.ts).
 */

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const assistantId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';
const snapshotHash = 'a'.repeat(64);
const expiresAt = '2026-11-25T10:42:00.000Z';

const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const questions = [
  {
    questionId: 'q1',
    text: 'Kontrak jenis apa yang Anda maksud?',
    kind: 'single',
    options: [{ label: 'Perjanjian kerja' }, { label: 'Sewa-menyewa' }],
  },
  {
    questionId: 'q2',
    text: 'Klausul mana yang perlu ditinjau?',
    kind: 'multiple',
    options: [{ label: 'Pembayaran' }, { label: 'Pengakhiran' }],
  },
  {
    questionId: 'q3',
    text: 'Untuk pihak mana surat ini?',
    kind: 'text',
  },
];

function questionOp(overrides: Record<string, unknown> = {}) {
  return {
    operationId,
    kind: 'question',
    status: 'awaiting_approval',
    approvalRequired: true,
    snapshotHash,
    expiresAt,
    decidedAt: null,
    toolName: 'ask_user',
    input: { questions: [questions[0]] },
    ...overrides,
  };
}

function renameOp(overrides: Record<string, unknown> = {}) {
  return {
    operationId,
    kind: 'approval',
    status: 'awaiting_approval',
    approvalRequired: true,
    snapshotHash,
    expiresAt,
    decidedAt: null,
    toolName: 'rename_chat',
    input: { newTitle: 'Somasi PT Sinar' },
    display: { currentTitle: 'Draf somasi wanprestasi' },
    ...overrides,
  };
}

function treeFor(
  operations: unknown[],
  status = 'awaiting_approval',
  text = 'Sebentar, saya butuh satu detail.',
): ChatTree {
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
        text,
        status,
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
    chatTitleRefreshVersion: 0,
  }),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function wrapped(node: ReactNode) {
  return node;
}

let decisionResponse: Record<string, unknown> = {
  operationId,
  status: 'answered',
  decision: 'answer',
  decidedAt: '2026-11-25T10:00:00.000Z',
};

beforeEach(() => {
  decisionResponse = {
    operationId,
    status: 'answered',
    decision: 'answer',
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
    vi.fn((url: unknown) => {
      if (typeof url === 'string' && url.includes('/decision')) {
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
  document.documentElement.classList.remove('dark');
});

async function mount(tree: ChatTree) {
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  await settleUntil(
    () =>
      view.container.querySelector(
        '[data-slot="operation-dock"], [data-slot="decision-record"], .aui-md',
      ) !== null,
  );
  return view;
}

async function mountPaused(operations: unknown[]) {
  const view = await mount(treeFor(operations));
  await settleUntil(
    () => view.container.querySelector('[data-slot="operation-dock"]') !== null,
  );
  return view;
}

/** jsdom cannot paint real styles; contrast is verified by the browser pass. */
async function axeOn(element: Element, context: string) {
  const results = await axe.run(element, {
    runOnly: { type: 'tag', values: axeTags },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .map((node) => node.target.join(' '))
          .join(', ')}`,
    ),
    context,
  ).toEqual([]);
  return results;
}

for (const theme of ['light', 'dark'] as const) {
  it(`the question dock passes axe in the ${theme} theme`, async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const view = await mountPaused([questionOp()]);
    try {
      const dock = view.container.querySelector(
        '[data-slot="operation-dock"]',
      ) as HTMLElement;
      expect(dock).not.toBeNull();
      await axeOn(dock, `${theme} question dock`);
      const pill = [...view.container.querySelectorAll('span')].find(
        (node) => node.textContent === 'Waiting for you',
      )!;
      expect(pill).not.toBeUndefined();
      await axeOn(pill, `${theme} waiting pill`);
    } finally {
      await view.unmount();
    }
  });

  it(`the approval dock passes axe in the ${theme} theme`, async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const view = await mountPaused([renameOp()]);
    try {
      const dock = view.container.querySelector(
        '[data-slot="operation-dock"]',
      ) as HTMLElement;
      await axeOn(dock, `${theme} approval dock`);
    } finally {
      await view.unmount();
    }
  });

  it(`the paged multi-kind question dock passes axe in the ${theme} theme`, async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const view = await mountPaused([questionOp({ input: { questions } })]);
    try {
      const dock = view.container.querySelector(
        '[data-slot="operation-dock"]',
      ) as HTMLElement;
      for (const page of [0, 1, 2]) {
        if (page > 0) {
          const next = [...dock.querySelectorAll('button')].find(
            (button) => button.getAttribute('aria-label') === 'Next question',
          ) as HTMLElement;
          await act(async () => {
            next.click();
          });
          await settle();
        }
        await axeOn(
          dock,
          `${theme} question dock page ${page + 1} of ${questions.length}`,
        );
      }
    } finally {
      await view.unmount();
    }
  });

  it(`decision records pass axe in the ${theme} theme`, async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const completedTree = treeFor(
      [
        {
          operationId,
          kind: 'question',
          status: 'answered',
          approvalRequired: true,
          snapshotHash,
          expiresAt: null,
          decidedAt: '2026-11-25T10:00:00.000Z',
          toolName: 'ask_user',
          input: { questions: [questions[0]] },
          output: {
            answers: [
              { questionId: 'q1', choice: { kind: 'option', index: 0 } },
            ],
          },
        },
      ],
      'completed',
    );
    const view = await mount(completedTree);
    try {
      const records = [
        ...view.container.querySelectorAll('[data-slot="decision-record"]'),
      ];
      expect(records.length).toBeGreaterThan(0);
      for (const [index, record] of records.entries())
        await axeOn(record, `${theme} decision record ${index}`);
    } finally {
      await view.unmount();
    }
    // Denied records carry the same contract in the bad tone.
    for (const [status, output] of [
      ['dismissed', { answered_in_chat: true }],
      ['expired', { unanswered: true }],
    ] as const) {
      const denied = await mount(
        treeFor(
          [
            {
              operationId,
              kind: 'question',
              status,
              approvalRequired: true,
              snapshotHash,
              expiresAt: null,
              decidedAt: '2026-11-25T10:00:00.000Z',
              toolName: 'ask_user',
              input: { questions: [questions[0]] },
              output,
            },
          ],
          'completed',
        ),
      );
      try {
        const record = denied.container.querySelector(
          '[data-slot="decision-record"]',
        )!;
        await axeOn(record, `${theme} ${status} decision record`);
      } finally {
        await denied.unmount();
      }
    }
  });
}

it('pages questions with ArrowLeft/ArrowRight and documents the shortcuts on the controls', async () => {
  const view = await mountPaused([questionOp({ input: { questions } })]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    const sectionLabel = () => dock.getAttribute('aria-label');
    expect(sectionLabel()).toBe(`Question 1 of ${questions.length} from Lexon`);
    expect(dock.textContent).toContain(`1 of ${questions.length}`);
    const previous = [...dock.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Previous question',
    ) as HTMLElement;
    const next = [...dock.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Next question',
    ) as HTMLElement;
    expect(previous.getAttribute('aria-keyshortcuts')).toBe('ArrowLeft');
    expect(next.getAttribute('aria-keyshortcuts')).toBe('ArrowRight');
    expect(previous.hasAttribute('disabled')).toBe(true);
    await act(async () => {
      next.click();
    });
    await settle();
    expect(dock.textContent).toContain(`2 of ${questions.length}`);
    expect(sectionLabel()).toBe(`Question 2 of ${questions.length} from Lexon`);
    await act(async () => {
      next.click();
    });
    await settle();
    expect(dock.textContent).toContain(`3 of ${questions.length}`);
    expect(next.hasAttribute('disabled')).toBe(true);
    await act(async () => {
      previous.click();
    });
    await settle();
    expect(dock.textContent).toContain(`2 of ${questions.length}`);
    // The same paging works from the keyboard anywhere inside the dock.
    await act(async () => {
      dock.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settle();
    expect(dock.textContent).toContain(`3 of ${questions.length}`);
    await act(async () => {
      dock.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settle();
    expect(dock.textContent).toContain(`2 of ${questions.length}`);
  } finally {
    await view.unmount();
  }
});

it('labels every answer affordance by the question text and keeps a natural focus order', async () => {
  const view = await mountPaused([questionOp({ input: { questions } })]);
  try {
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    // Page 1: the single-choice group is a radiogroup named by the question.
    const questionId = dock
      .querySelector('[role="radiogroup"]')
      ?.getAttribute('aria-labelledby');
    expect(questionId).toBeTruthy();
    expect(dock.querySelector(`#${CSS.escape(questionId!)}`)?.textContent).toBe(
      questions[0]!.text,
    );
    for (const radio of dock.querySelectorAll('[role="radio"]'))
      expect(radio.textContent).toBeTruthy();
    // No positive tabindex anywhere: the tab order is the DOM order.
    for (const element of dock.querySelectorAll('[tabindex]'))
      expect(Number(element.getAttribute('tabindex'))).toBeLessThanOrEqual(0);

    const next = [...dock.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Next question',
    ) as HTMLElement;
    await act(async () => {
      next.click();
    });
    await settle();
    // Page 2: the multi group names itself by its question; each row is a
    // labelled checkbox.
    const group = dock.querySelector('[role="group"]')!;
    const groupLabelId = group.getAttribute('aria-labelledby');
    expect(
      dock.querySelector(`#${CSS.escape(groupLabelId!)}`)?.textContent,
    ).toBe(questions[1]!.text);
    for (const box of dock.querySelectorAll('[role="checkbox"]')) {
      expect(box.getAttribute('aria-checked')).toBe('false');
      expect(box.textContent).toBeTruthy();
    }
    await act(async () => {
      next.click();
    });
    await settle();
    // Page 3: the text question's input carries the question as its label
    // and Enter commits (the dock keydown handles Enter in fields).
    const field = dock.querySelector('input') as HTMLInputElement;
    expect(field).not.toBeNull();
    expect(field.getAttribute('aria-label')).toBe(questions[2]!.text);
  } finally {
    await view.unmount();
  }
});

it('marks the dock and the stored records as polite status regions and documents Esc/Ctrl+Enter', async () => {
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
    expect(dock.getAttribute('role')).toBe('status');
    expect(dock.getAttribute('aria-label')).toBe('Approval needed');
    const reject = [...dock.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Reject'),
    ) as HTMLElement;
    const approve = [...dock.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Approve'),
    ) as HTMLElement;
    expect(reject.getAttribute('aria-keyshortcuts')).toBe('Escape');
    expect(approve.getAttribute('aria-keyshortcuts')).toBe('Control+Enter');
    // Deciding closes the panel; the stored outcome lands as a status record.
    await act(async () => {
      approve.click();
    });
    await settleUntil(
      () =>
        view.container.querySelector('[data-slot="decision-record"]') !== null,
    );
    const record = view.container.querySelector(
      '[data-slot="decision-record"]',
    ) as HTMLElement;
    expect(record.getAttribute('role')).toBe('status');
    expect(record.textContent).toContain('Renamed this chat');
  } finally {
    await view.unmount();
  }
});
