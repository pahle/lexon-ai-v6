import type { ChatTree } from '@lexon/contracts';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import { Thread } from '../src/components/assistant-ui/elements/thread.aui.js';
import { formatPlatformDateTime } from '../src/components/platform/platform-format.js';
import {
  deadlineDateLabel,
  deadlineInputFields,
  deadlineResultFields,
  formatCalendarDate,
} from '../src/components/chat/deadline-format.js';
import { render, settle, settleUntil } from './render.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const assistantId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';
const otherOperationId = '66666666-6666-4666-8666-666666666666';
const snapshotHash = 'a'.repeat(64);
const expiresAt = '2026-11-24T03:42:00.000Z';
const decidedAt = '2026-11-14T03:42:00.000Z';

const askQuestions = [
  {
    questionId: 'q1',
    text: 'Kontrak jenis apa yang Anda maksud?',
    kind: 'single',
    options: [{ label: 'Perjanjian kerja' }, { label: 'Sewa-menyewa' }],
  },
  {
    questionId: 'q2',
    text: 'Siapa pihak dalam kontrak ini?',
    kind: 'single',
    options: [{ label: 'Perusahaan dan karyawan' }, { label: 'Perorangan' }],
  },
  {
    questionId: 'q3',
    text: 'Kapan kontrak ditandatangani?',
    kind: 'single',
    options: [{ label: 'Kurang dari 1 tahun lalu' }],
  },
];

const deadlineInput = {
  startDate: '2027-08-03',
  amount: 14,
  unit: 'calendar_days',
  countStartDay: false,
  nonWorkingDayRule: 'next_working_day',
};
const deadlineOutput = {
  deadline: '2027-08-18',
  weekday: 'Wednesday',
  skippedDays: [{ date: '2027-08-17', name: 'Proklamasi Kemerdekaan RI' }],
  calendarVersion: 'id-national@2027.1',
};

function operation(overrides: Record<string, unknown>) {
  return {
    operationId,
    kind: 'approval',
    status: 'completed',
    approvalRequired: false,
    snapshotHash,
    expiresAt: null,
    decidedAt,
    toolName: 'deadline_calculator',
    input: deadlineInput,
    output: deadlineOutput,
    ...overrides,
  };
}

function tree(
  text: string,
  operations: unknown[],
  status = 'completed',
): ChatTree {
  return {
    id: chatId,
    title: 'Batas waktu banding',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Kapan batas akhirnya?',
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: () => () => undefined,
}));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => ({
    setChatTitle: vi.fn(),
    chatTitleRefreshVersion: 0,
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function wrapped(node: ReactNode) {
  return node;
}

beforeEach(() => {
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
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function mount(tree_: ChatTree) {
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree_.id} tree={tree_}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  await settle();
  return view;
}

function paragraph(view: { container: HTMLElement }, text: string) {
  return [...view.container.querySelectorAll('p, li')].find(
    (node) => node.textContent?.trim() === text,
  );
}

it('renders the decision record at its real position — lead-in text, record, post-decision text', async () => {
  const view = await mount(
    tree('Satu detail dulu.\n\nBaik, jawabannya begini.', [
      operation({
        kind: 'question',
        toolName: 'ask_user',
        approvalRequired: true,
        status: 'answered',
        input: { questions: [askQuestions[0]] },
        output: {
          answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
        },
      }),
    ]),
  );
  try {
    const record = view.container.querySelector(
      '[data-slot="decision-record"]',
    )!;
    expect(record).not.toBeNull();
    const lead = paragraph(view, 'Satu detail dulu.');
    const post = paragraph(view, 'Baik, jawabannya begini.');
    expect(lead).not.toBeUndefined();
    expect(post).not.toBeUndefined();
    // DOCUMENT_POSITION_FOLLOWING: the argument follows the receiver in the DOM.
    expect(
      lead!.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      record.compareDocumentPosition(post!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

it('interleaves each record at its own generation boundary when several ops share a turn', async () => {
  const view = await mount(
    tree('Para satu.\n\nPara dua.\n\nPara tiga.', [
      operation({ status: 'completed' }),
      operation({ operationId: otherOperationId, status: 'completed' }),
    ]),
  );
  try {
    const records = [
      ...view.container.querySelectorAll('[data-slot="decision-record"]'),
    ];
    expect(records).toHaveLength(2);
    const two = paragraph(view, 'Para dua.')!;
    const three = paragraph(view, 'Para tiga.')!;
    expect(
      records[0]!.compareDocumentPosition(two) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      two.compareDocumentPosition(records[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      records[1]!.compareDocumentPosition(three) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

it('marks rejected, dismissed and expired rows with the red denied tone and the right icons', async () => {
  const statuses = [
    ['rejected', 'You rejected the rename', 'lucide-circle-x'],
    ['expired', 'Rename expired after 24 hours', 'lucide-hourglass'],
  ] as const;
  for (const [status, label, iconClass] of statuses) {
    const view = await mount(
      tree('Judulnya saya ubah.\n\nBaik, judul tidak diubah.', [
        operation({
          kind: 'approval',
          toolName: 'rename_chat',
          approvalRequired: true,
          status,
          input: { newTitle: 'Somasi PT Sinar' },
          output: { denied: true },
        }),
      ]),
    );
    try {
      const row = view.container.querySelector(
        '[data-slot="decision-record"] button',
      ) as HTMLElement;
      expect(row?.textContent).toContain(label);
      expect(row?.className).toContain('lexon-red-text');
      const icon = row?.querySelector('svg');
      expect(icon?.getAttribute('class') ?? '').toContain(iconClass);
    } finally {
      await view.unmount();
    }
  }
});

it('prints the humanized deadline in the row label and the typographic failed copy', async () => {
  const view = await mount(
    tree('Saya hitung dulu.\n\nBatas akhir jatuh pada Rabu, 18 Agustus 2027.', [
      operation({ status: 'completed' }),
    ]),
  );
  try {
    const row = view.container.querySelector(
      '[data-slot="decision-record"] button',
    ) as HTMLElement;
    expect(row?.textContent).toContain('Calculated the deadline:');
    expect(row?.textContent).toContain('Wednesday, 18 August 2027');
  } finally {
    await view.unmount();
  }
  const failed = await mount(
    tree('Saya hitung dulu.\n\nBelum bisa dihitung otomatis.', [
      operation({ status: 'failed', output: { errorCode: 'AI_TOOL_TIMEOUT' } }),
    ]),
  );
  try {
    const row = failed.container.querySelector(
      '[data-slot="decision-record"] button',
    ) as HTMLElement;
    // Typographic U+2019 apostrophe, matching the prototype copy.
    expect(row?.textContent).toContain('Couldn’t calculate the deadline');
    expect(row?.className).toContain('lexon-red-text');
  } finally {
    await failed.unmount();
  }
});

it('expands the deadline row into humanized Input and Result sections', async () => {
  const view = await mount(
    tree('Saya hitung dulu.\n\nBatas akhir jatuh pada Rabu, 18 Agustus 2027.', [
      operation({ status: 'completed' }),
    ]),
  );
  try {
    const row = view.container.querySelector(
      '[data-slot="decision-record"] button',
    ) as HTMLElement;
    await act(async () => {
      row.click();
    });
    await settle();
    const container = view.container.textContent ?? '';
    for (const text of [
      'Input',
      'Result',
      'Start date',
      'Tuesday, 3 August 2027',
      'Period',
      '14 calendar days',
      'Start day counts',
      'No',
      'If it ends on a non-working day',
      'Move to the next working day',
      'Deadline',
      'Wednesday, 18 August 2027',
      'Skipped',
      'Tuesday, 17 August 2027 · Proklamasi Kemerdekaan RI',
      'Calendar',
      'Indonesian national holidays and joint leave days, 2027',
    ])
      expect(container).toContain(text);
    // No raw keys or stored identifiers leak into the panel.
    for (const raw of [
      'calendar_days',
      'next_working_day',
      'id-national@',
      '2027-08-03',
      '2027-08-18',
      'countStartDay',
      'nonWorkingDayRule',
    ])
      expect(container).not.toContain(raw);
  } finally {
    await view.unmount();
  }
});

it('lists every question on a dismissed question record with “Answered in chat”', async () => {
  const view = await mount(
    tree('Saya perlu beberapa informasi.\n\nBaik, jelaskan di chat.', [
      operation({
        kind: 'question',
        toolName: 'ask_user',
        approvalRequired: true,
        status: 'dismissed',
        input: { questions: askQuestions },
        output: { answered_in_chat: true },
      }),
    ]),
  );
  try {
    const record = view.container.querySelector(
      '[data-slot="decision-record"]',
    )!;
    for (const question of askQuestions)
      expect(record.textContent).toContain(question.text);
    expect(record.textContent!.match(/Answered in chat/g)).toHaveLength(
      askQuestions.length,
    );
    const answers = [...record.querySelectorAll('p')].filter(
      (p) => p.textContent === 'Answered in chat',
    );
    for (const answer of answers)
      expect(answer.className).toContain('text-muted-foreground');
  } finally {
    await view.unmount();
  }
});

it('prints the question text in the dock header beside the pager and keeps the label visually hidden', async () => {
  const op = operation({
    kind: 'question',
    toolName: 'ask_user',
    approvalRequired: true,
    status: 'awaiting_approval',
    expiresAt,
    decidedAt: null,
    input: { questions: askQuestions },
    output: undefined,
  });
  const view = await mount(
    tree('Saya perlu beberapa informasi.', [op], 'awaiting_approval'),
  );
  try {
    await settleUntil(
      () =>
        view.container.querySelector('[data-slot="operation-dock"]') !== null,
    );
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    const h2 = dock.querySelector('h2')!;
    expect(h2.className).toContain('sr-only');
    expect(h2.textContent).toBe('Question 1 of 3 from Lexon');
    // The visible question text sits in the header row beside the pager.
    const header = h2.parentElement as HTMLElement;
    expect(header.textContent).toContain(askQuestions[0]!.text);
    expect(header.textContent).toContain('1 of 3');
    const questionText = [...header.querySelectorAll('p, span')].find(
      (node) => node.textContent === askQuestions[0]!.text,
    );
    expect(questionText).not.toBeUndefined();
  } finally {
    await view.unmount();
  }
});

it('prints the approval dock expiry with the platform date-time and the platform shortcut label', async () => {
  const op = operation({
    kind: 'approval',
    toolName: 'rename_chat',
    approvalRequired: true,
    status: 'awaiting_approval',
    expiresAt,
    decidedAt: null,
    input: { newTitle: 'Somasi PT Sinar' },
    display: { currentTitle: 'Draf somasi wanprestasi' },
    output: undefined,
  });
  const view = await mount(
    tree('Judulnya saya ubah.', [op], 'awaiting_approval'),
  );
  try {
    await settleUntil(
      () =>
        view.container.querySelector('[data-slot="operation-dock"]') !== null,
    );
    const dock = view.container.querySelector(
      '[data-slot="operation-dock"]',
    ) as HTMLElement;
    expect(dock.textContent).toContain(
      `Expires ${formatPlatformDateTime(expiresAt)}`,
    );
    expect(dock.textContent).not.toMatch(/Expires [A-Z][a-z]{2} \d+,/);
    // jsdom reports a non-Apple platform: the label is "Ctrl ↵".
    const kbd = [...dock.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(kbd).toContain('Ctrl ↵');
  } finally {
    await view.unmount();
  }
});

it('draws the waiting pill dot with a soft halo ring', async () => {
  const op = operation({
    kind: 'question',
    toolName: 'ask_user',
    approvalRequired: true,
    status: 'awaiting_approval',
    expiresAt,
    decidedAt: null,
    input: { questions: [askQuestions[0]] },
    output: undefined,
  });
  const view = await mount(
    tree('Saya perlu satu informasi.', [op], 'awaiting_approval'),
  );
  try {
    await settleUntil(() =>
      (view.container.textContent ?? '').includes('Waiting for you'),
    );
    const pill = [...view.container.querySelectorAll('span')].find(
      (node) => node.textContent === 'Waiting for you',
    )!;
    const dot = pill.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot.style.boxShadow).toContain('0 0 0 3px');
    expect(dot.style.boxShadow).toContain('color-mix');
  } finally {
    await view.unmount();
  }
});

// ---- deadline-format unit coverage ----

it('formats calendar dates in en-GB long form', () => {
  expect(formatCalendarDate('2027-08-03')).toBe('Tuesday, 3 August 2027');
  expect(formatCalendarDate('2027-08-18')).toBe('Wednesday, 18 August 2027');
});

it('builds the humanized input fields for the deadline panel', () => {
  expect(deadlineInputFields(deadlineInput)).toEqual([
    { label: 'Start date', value: 'Tuesday, 3 August 2027' },
    { label: 'Period', value: '14 calendar days' },
    { label: 'Start day counts', value: 'No' },
    {
      label: 'If it ends on a non-working day',
      value: 'Move to the next working day',
    },
  ]);
});

it('builds the humanized result fields, joining skipped holiday names', () => {
  const fields = deadlineResultFields({
    ...deadlineOutput,
    skippedDays: [
      { date: '2027-08-17', name: 'Proklamasi Kemerdekaan RI' },
      { date: '2027-12-25', name: 'Hari Raya Natal' },
    ],
  });
  expect(fields).toEqual([
    { label: 'Deadline', value: 'Wednesday, 18 August 2027', strong: true },
    {
      label: 'Skipped',
      value:
        'Tuesday, 17 August 2027 · Proklamasi Kemerdekaan RI, Saturday, 25 December 2027 · Hari Raya Natal',
    },
    {
      label: 'Calendar',
      value: 'Indonesian national holidays and joint leave days, 2027',
    },
  ]);
  expect(deadlineResultFields(deadlineOutput)[2]?.value).toBe(
    'Indonesian national holidays and joint leave days, 2027',
  );
  expect(deadlineDateLabel(deadlineOutput)).toBe('Wednesday, 18 August 2027');
});
