// Deterministic chat fixtures and state openers shared by the chat state
// specs and the visual capture sets. Moved unchanged from chat-visual.spec.ts.
import { resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  ChatDetailSchema,
  ChatPageSchema,
  ChatSearchMatchSchema,
  ChatSearchPageSchema,
  ChatSnapshotFrameSchema,
} from '@lexon/contracts';
import type {
  ChatDetail,
  ChatMessage,
  ChatOperationSnapshot,
  OperationStatus,
} from '@lexon/contracts';
import {
  OrganizationSummarySchema,
  SwitchResultSchema,
} from '@lexon/contracts';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';
import { freezeMorningClock } from './greeting-clock.js';
import {
  answer as prototypeAnswer,
  chatTimes,
  chatTitles,
  prototypeNow,
  question as prototypeQuestion,
  reasoningSummary,
  searchResults,
} from './prototype-fixtures.js';

// The F4 chat state list is kept as an archived record (index only).
export const indexPath = resolve(
  'docs/references/archive/f4-chat-state-index.json',
);
export const fixedNow = prototypeNow;
export const chatId = '00000000-0000-4000-8000-000000000101';
export const userMessageId = '00000000-0000-4000-8000-000000000102';
export const assistantMessageId = '00000000-0000-4000-8000-000000000103';
export const runId = '00000000-0000-4000-8000-000000000104';
// Titles, question, answer and times are the prototype's (prototype-fixtures.ts).
export const fileNames = chatTitles;
export const question = prototypeQuestion;
export const deepThinkingQuestion =
  'Bandingkan risiko PKWT dan PKWTT untuk karyawan proyek konstruksi 18 bulan, termasuk kompensasi saat kontrak berakhir.';
export const answer = prototypeAnswer;
export const reasoning = reasoningSummary;
export const timestamp = chatTimes.newChat.at;
// The partial answer of the streaming, reconnecting and stopped states, as in
// the prototype (two list items, the second cut off).
// The reconnecting state shows only the first paragraph, as in the prototype.
export const reconnectingAnswer =
  'Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian:';
export const partialAnswer = `Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian:

1. **Kesepakatan** para pihak yang mengikatkan dirinya.
2. **Kecakapan** untuk membuat suatu`;

export type VisualCapture = {
  status?: string;
  id: string;
  state: string;
  theme: 'light' | 'dark';
  viewport: 'desktop' | 'mobile';
  width: number;
  height: number;
  filename: string;
  producerCommit: string | null;
  sha256: string | null;
};

export function userMessage(
  id = userMessageId,
): Extract<ChatMessage, { role: 'user' }> {
  return {
    id,
    role: 'user',
    parentId: null,
    text: question,
    effort: 'high',
    createdAt: timestamp,
  };
}

export function assistantMessage(
  state: string,
  id = assistantMessageId,
  parentId = userMessageId,
): Extract<ChatMessage, { role: 'assistant' }> {
  const active =
    state === 'thinking' ||
    state === 'streaming-answer' ||
    state === 'reconnecting';
  const stoppedBeforeAnswer = state === 'stopped-before-answer';
  return {
    id,
    role: 'assistant',
    parentId,
    runId,
    text:
      state === 'thinking' || stoppedBeforeAnswer
        ? ''
        : state === 'reconnecting'
          ? reconnectingAnswer
          : state === 'streaming-answer'
            ? partialAnswer
            : state === 'stopped'
              ? partialAnswer
              : state === 'run-error'
                ? 'Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian:'
                : answer,
    createdAt: timestamp,
    status: active
      ? 'running'
      : stoppedBeforeAnswer || state === 'stopped'
        ? 'cancelled'
        : state === 'run-error'
          ? 'failed'
          : 'completed',
    reasoningSummary:
      state === 'no-signal-completion' ||
      state === 'measured-no-summary-completion' ||
      state === 'stopped-before-answer' ||
      // The failed answer keeps the measured 'Thought for N seconds' label
      // (reasoningDurationMs below); no summary to expand.
      state === 'run-error'
        ? null
        : reasoning,
    reasoningDurationMs:
      state === 'no-signal-completion' || state === 'stopped-before-answer'
        ? null
        : state === 'measured-no-summary-completion'
          ? 14_000
          : state === 'streaming-answer' || state === 'reconnecting'
            ? 8_000
            : state === 'stopped'
              ? 9_000
              : 14_000,
    feedback: null,
    operations: [],
  };
}

export function chatTree(state: string): ChatDetail {
  if (state === 'matching-message-highlight') {
    const matchedUser = {
      ...userMessage(),
      text: 'What remedies are available to a party when the other party commits wanprestasi under a supply agreement?',
    };
    const matchedAssistant = {
      ...assistantMessage('answer-complete'),
      text: 'Under Article 1267 of the Indonesian Civil Code, the injured party may seek performance, damages, or cancellation of the agreement, depending on the circumstances.',
    };
    return ChatDetailSchema.parse({
      id: chatId,
      title: fileNames.default,
      messages: [matchedUser, matchedAssistant],
      viewedLeafId: matchedAssistant.id,
      access: 'owner',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  if (state === 'edited-branch') {
    const firstUser = userMessage();
    const firstAssistant = assistantMessage(
      'answer-complete',
      assistantMessageId,
    );
    const editedUser = {
      ...userMessage('00000000-0000-4000-8000-000000000105'),
      text: 'Apa saja syarat sahnya perjanjian menurut KUHPerdata? Jawab singkat.',
    };
    const editedAssistant = {
      ...assistantMessage(
        'answer-complete',
        '00000000-0000-4000-8000-000000000106',
        editedUser.id,
      ),
      text: 'Ada dua syarat subjektif (kesepakatan dan kecakapan) dan dua syarat objektif (hal tertentu dan sebab yang halal) dalam Pasal 1320 KUHPerdata.\n\nPelanggaran syarat subjektif membuat perjanjian dapat dibatalkan; pelanggaran syarat objektif membuatnya batal demi hukum.',
      reasoningDurationMs: 6_000,
    };
    return ChatDetailSchema.parse({
      id: chatId,
      title: fileNames.newChat,
      messages: [firstUser, firstAssistant, editedUser, editedAssistant],
      viewedLeafId: editedAssistant.id,
      access: 'owner',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  const f5 = f5States[state];
  if (f5) {
    return ChatDetailSchema.parse({
      id: chatId,
      title: f5.title,
      messages: [
        { ...userMessage(), text: f5.user },
        {
          ...assistantMessage('answer-complete'),
          text: f5.text,
          status: f5.status,
          reasoningDurationMs: f5.reasoningDurationMs,
          operations: [...f5.operations],
        },
      ],
      viewedLeafId: assistantMessageId,
      access: 'owner',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return ChatDetailSchema.parse({
    id: chatId,
    title: fileNames.newChat,
    messages: [userMessage(), assistantMessage(state)],
    viewedLeafId: assistantMessageId,
    access: 'owner',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

// ---- F5 (r17): tool rows, question docks, approvals and decision records ----
// The r17 prototype states run on the production operation components: the
// tree's `operations` rebuild rows and records through the same path the
// canonical tree uses after a reload, and the paused/running states resume
// the deterministic snapshot stream (f5RunFrames). Titles, the user's turn,
// the question texts and the Indonesian copy are the prototype's.

export const deadlineOperationId = '00000000-0000-4000-8000-000000000201';
export const askOperationId = '00000000-0000-4000-8000-000000000202';
export const renameOperationId = '00000000-0000-4000-8000-000000000203';
// The prototype's expiry line reads "Expires 24 Nov 2026, 10:42" (WIB).
export const operationExpiresAt = '2026-11-24T03:42:00.000Z';
const operationDecidedAt = '2026-11-14T03:42:00.000Z';
const operationHash = 'c'.repeat(64);

export const f5Chat = {
  tool: {
    title: 'Batas waktu banding',
    user: 'Kapan batas akhir mengajukan banding jika putusan dibacakan pada 3 Agustus 2027?',
    pre: 'Saya hitung tenggatnya dengan kalender hari kerja Indonesia.',
  },
  ask: {
    title: 'Masa berlaku kontrak',
    user: 'Apakah kontrak ini masih berlaku?',
    pre: 'Saya perlu satu informasi sebelum menjawab.',
    preMulti: 'Saya perlu beberapa informasi sebelum menjawab.',
  },
  ren: {
    title: 'Draf somasi wanprestasi',
    user: 'Ganti judul chat ini jadi “Somasi PT Sinar”.',
    pre: 'Saya akan mengganti judul chat ini menjadi “Somasi PT Sinar”.',
  },
  nda: {
    title: 'Draf NDA vendor',
    user: 'Buatkan draf NDA untuk kerja sama dengan vendor kami.',
    pre: 'Saya perlu beberapa informasi sebelum menyusun drafnya.',
  },
} as const;

const deadlineAnswer =
  'Batas akhir pengajuan banding jatuh pada **Rabu, 18 Agustus 2027**.\n\nPerhitungan memakai 14 hari kalender sejak hari setelah putusan dibacakan. Hari ke-14 jatuh pada Selasa, 17 Agustus 2027 (Hari Kemerdekaan), sehingga digeser ke hari kerja berikutnya. Periksa kembali tenggang waktu yang berlaku untuk perkara Anda.';
const deadlineFailedAnswer =
  'Saya belum dapat menghitung tanggalnya secara otomatis. Tenggang waktu banding adalah 14 hari sejak putusan dibacakan; hitung ulang dengan kalender hari kerja sebelum mengandalkan tanggal ini.';
const askAnsweredText =
  'Untuk perjanjian kerja, masa berlakunya bergantung pada jenisnya. PKWT berakhir pada tanggal atau saat pekerjaan yang disepakati selesai, sedangkan PKWTT tidak memiliki batas waktu. Kirimkan tanggal mulai dan jangka waktu dalam kontrak, dan saya akan memeriksanya.';
const askDismissedText =
  'Baik. Jelaskan jenis kontraknya di chat, dan saya akan melanjutkan.';
const renApprovedText = 'Judul chat sudah diganti menjadi “Somasi PT Sinar”.';
const renRejectedText = 'Baik, judul chat tidak diubah.';
const renExpiredText =
  'Permintaan ganti judul kedaluwarsa, jadi judul chat tidak diubah.';

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

const askSingleInput = {
  questions: [
    {
      questionId: 'q1',
      text: 'Kontrak jenis apa yang Anda maksud?',
      kind: 'single',
      options: [
        { label: 'Perjanjian kerja', description: 'PKWT atau PKWTT' },
        {
          label: 'Sewa-menyewa',
          description: 'Tanah, bangunan, atau kendaraan',
        },
        { label: 'Jual beli', description: 'Barang atau aset' },
        {
          label: 'Kerja sama usaha',
          description: 'Kemitraan atau joint venture',
        },
      ],
      allowFreeText: true,
    },
  ],
};
const askMultiInput = {
  questions: [
    askSingleInput.questions[0],
    {
      questionId: 'q2',
      text: 'Siapa pihak dalam kontrak ini?',
      kind: 'single',
      options: [
        {
          label: 'Perusahaan dan karyawan',
          description: 'Hubungan kerja',
        },
        { label: 'Dua perusahaan', description: 'Hubungan bisnis' },
        { label: 'Perorangan', description: 'Antarindividu' },
      ],
      allowFreeText: true,
    },
    {
      questionId: 'q3',
      text: 'Kapan kontrak ditandatangani?',
      kind: 'single',
      options: [
        { label: 'Kurang dari 1 tahun lalu' },
        { label: '1 sampai 3 tahun lalu' },
        { label: 'Lebih dari 3 tahun lalu' },
      ],
      allowFreeText: true,
    },
  ],
};
const ndaInput = {
  questions: [
    {
      questionId: 'q1',
      text: 'NDA ini untuk siapa?',
      kind: 'single',
      options: [
        { label: 'Perusahaan dan vendor' },
        { label: 'Dua perusahaan' },
        { label: 'Perorangan' },
      ],
      allowFreeText: true,
    },
    {
      questionId: 'q2',
      text: 'Siapa nama pihak pertama?',
      kind: 'text',
    },
    {
      questionId: 'q3',
      text: 'Informasi apa saja yang dilindungi?',
      kind: 'multiple',
      options: [
        {
          label: 'Data keuangan',
          description: 'Laporan, harga, dan anggaran',
        },
        {
          label: 'Rahasia dagang',
          description: 'Proses, formula, dan metode kerja',
        },
        {
          label: 'Data pelanggan',
          description: 'Identitas dan riwayat transaksi',
        },
        { label: 'Kode sumber dan dokumentasi teknis' },
      ],
      allowFreeText: true,
    },
    {
      questionId: 'q4',
      text: 'Hukum mana yang berlaku?',
      kind: 'single',
      options: [
        { label: 'Hukum Indonesia' },
        { label: 'Hukum Singapura' },
        { label: 'Arbitrase' },
      ],
      allowFreeText: true,
    },
    {
      questionId: 'q5',
      text: 'Bagaimana sengketa diselesaikan?',
      kind: 'single',
      options: [
        { label: 'Pengadilan Negeri' },
        { label: 'Arbitrase BANI' },
        { label: 'Musyawarah' },
      ],
      allowFreeText: true,
    },
  ],
};
const renameInput = { newTitle: 'Somasi PT Sinar' };
const renameDisplay = { currentTitle: f5Chat.ren.title };

/** The operation snapshot the tree and the snapshot stream both carry. */
function f5Operation(options: {
  readonly operationId: string;
  readonly kind: 'approval' | 'question';
  readonly toolName: string;
  readonly approvalRequired: boolean;
  readonly status: OperationStatus;
  readonly input: Record<string, unknown>;
  readonly display?: Record<string, unknown>;
  readonly output?: unknown;
}): ChatOperationSnapshot {
  const waiting = options.status === 'awaiting_approval';
  return {
    operationId: options.operationId,
    kind: options.kind,
    status: options.status,
    approvalRequired: options.approvalRequired,
    snapshotHash: operationHash,
    expiresAt: waiting ? operationExpiresAt : null,
    decidedAt:
      waiting || options.status === 'pending' ? null : operationDecidedAt,
    toolName: options.toolName,
    input: options.input,
    ...(options.display ? { display: options.display } : {}),
    ...(options.output !== undefined ? { output: options.output } : {}),
  };
}

// `deadline_calculator` is a read tool: its row is not gated, so the stored
// kind is the 'approval' default and approvalRequired stays false.
const deadlineOperation = (status: OperationStatus, output?: unknown) =>
  f5Operation({
    operationId: deadlineOperationId,
    kind: 'approval',
    toolName: 'deadline_calculator',
    approvalRequired: false,
    status,
    input: deadlineInput,
    ...(output !== undefined ? { output } : {}),
  });
const askOperation = (
  status: OperationStatus,
  input: Record<string, unknown>,
  output?: unknown,
) =>
  f5Operation({
    operationId: askOperationId,
    kind: 'question',
    toolName: 'ask_user',
    approvalRequired: true,
    status,
    input,
    ...(output !== undefined ? { output } : {}),
  });
const renameOperation = (status: OperationStatus, output?: unknown) =>
  f5Operation({
    operationId: renameOperationId,
    kind: 'approval',
    toolName: 'rename_chat',
    approvalRequired: true,
    status,
    input: renameInput,
    display: renameDisplay,
    ...(output !== undefined ? { output } : {}),
  });

export type F5State = {
  /** The chat title (the approved rename keeps the new title). */
  readonly title: string;
  /** The user's turn text. */
  readonly user: string;
  /** The assistant turn's text and run status. */
  readonly text: string;
  readonly status: 'running' | 'awaiting_approval' | 'completed';
  readonly reasoningDurationMs: number;
  readonly operations: readonly ChatOperationSnapshot[];
  /** The Recent/Chats rows show the "Waiting for you" markers. */
  readonly waiting?: boolean;
};

// The paused/running states resume the snapshot stream; their keys are the
// `capture_state` values installRunStreamFixture selects frames by.
export const f5States: Record<string, F5State> = {
  'tool-activity': {
    title: f5Chat.tool.title,
    user: f5Chat.tool.user,
    text: `${f5Chat.tool.pre}\n\n${deadlineAnswer}`,
    status: 'completed',
    reasoningDurationMs: 7_000,
    operations: [deadlineOperation('completed', deadlineOutput)],
  },
  'tool-expanded': {
    title: f5Chat.tool.title,
    user: f5Chat.tool.user,
    text: `${f5Chat.tool.pre}\n\n${deadlineAnswer}`,
    status: 'completed',
    reasoningDurationMs: 7_000,
    operations: [deadlineOperation('completed', deadlineOutput)],
  },
  'tool-running': {
    title: f5Chat.tool.title,
    user: f5Chat.tool.user,
    text: f5Chat.tool.pre,
    status: 'running',
    reasoningDurationMs: 7_000,
    operations: [deadlineOperation('pending')],
  },
  'tool-failed': {
    title: f5Chat.tool.title,
    user: f5Chat.tool.user,
    text: `${f5Chat.tool.pre}\n\n${deadlineFailedAnswer}`,
    status: 'completed',
    reasoningDurationMs: 9_000,
    operations: [deadlineOperation('failed', { errorCode: 'AI_TOOL_TIMEOUT' })],
  },
  'question-single': {
    title: f5Chat.ask.title,
    user: f5Chat.ask.user,
    text: f5Chat.ask.pre,
    status: 'awaiting_approval',
    reasoningDurationMs: 3_000,
    operations: [askOperation('awaiting_approval', askSingleInput)],
    waiting: true,
  },
  'question-multi': {
    title: f5Chat.ask.title,
    user: f5Chat.ask.user,
    text: f5Chat.ask.preMulti,
    status: 'awaiting_approval',
    reasoningDurationMs: 4_000,
    operations: [askOperation('awaiting_approval', askMultiInput)],
    waiting: true,
  },
  'question-nda': {
    title: f5Chat.nda.title,
    user: f5Chat.nda.user,
    text: f5Chat.nda.pre,
    status: 'awaiting_approval',
    reasoningDurationMs: 4_000,
    operations: [askOperation('awaiting_approval', ndaInput)],
    waiting: true,
  },
  'question-answered': {
    title: f5Chat.ask.title,
    user: f5Chat.ask.user,
    text: `${f5Chat.ask.preMulti}\n\n${askAnsweredText}`,
    status: 'completed',
    reasoningDurationMs: 4_000,
    operations: [
      askOperation('answered', askMultiInput, {
        answers: [
          { questionId: 'q1', choice: { kind: 'option', index: 0 } },
          { questionId: 'q2', choice: { kind: 'option', index: 0 } },
          { questionId: 'q3', choice: { kind: 'skipped' } },
        ],
      }),
    ],
  },
  'question-dismissed': {
    title: f5Chat.ask.title,
    user: f5Chat.ask.user,
    text: `${f5Chat.ask.pre}\n\n${askDismissedText}`,
    status: 'completed',
    reasoningDurationMs: 3_000,
    operations: [
      askOperation('dismissed', askSingleInput, {
        answered_in_chat: true,
      }),
    ],
  },
  'approval-pending': {
    title: f5Chat.ren.title,
    user: f5Chat.ren.user,
    text: f5Chat.ren.pre,
    status: 'awaiting_approval',
    reasoningDurationMs: 2_000,
    operations: [renameOperation('awaiting_approval')],
    waiting: true,
  },
  'approval-approved': {
    title: 'Somasi PT Sinar',
    user: f5Chat.ren.user,
    text: `${f5Chat.ren.pre}\n\n${renApprovedText}`,
    status: 'completed',
    reasoningDurationMs: 2_000,
    operations: [
      renameOperation('completed', {
        renamed: true,
        previousTitle: f5Chat.ren.title,
      }),
    ],
  },
  'approval-rejected': {
    title: f5Chat.ren.title,
    user: f5Chat.ren.user,
    text: `${f5Chat.ren.pre}\n\n${renRejectedText}`,
    status: 'completed',
    reasoningDurationMs: 2_000,
    operations: [renameOperation('rejected', { denied: true })],
  },
  'approval-expired': {
    title: f5Chat.ren.title,
    user: f5Chat.ren.user,
    text: `${f5Chat.ren.pre}\n\n${renExpiredText}`,
    status: 'completed',
    reasoningDurationMs: 2_000,
    operations: [renameOperation('expired', { expired: 'approval' })],
  },
};

/** The resumed stream of a paused or running F5 state (snapshot protocol). */
export function f5RunFrames(state: string) {
  const spec = f5States[state];
  const operation = spec?.operations[0];
  if (!spec || !operation)
    throw new Error(`Unknown streamed F5 chat state "${state}".`);
  const parts = [
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 0,
      chunkIndex: 0,
      partType: 'reasoning',
      id: 'f5-reasoning',
      text: reasoning,
      final: true,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 1,
      chunkIndex: 0,
      partType: 'text',
      id: 'f5-answer',
      text: spec.text,
      final: true,
    },
    {
      type: 'snapshot-part',
      version: 1,
      partIndex: 2,
      chunkIndex: 0,
      partType: 'tool',
      id: 'f5-tool',
      toolCallId: operation.operationId,
      toolName: operation.toolName,
      operationId: operation.operationId,
      input: operation.input,
      ...(operation.output !== undefined ? { output: operation.output } : {}),
      outcome: operation.status,
      final: true,
    },
  ];
  return [
    {
      type: 'snapshot-start',
      version: 1,
      reset: true,
      snapshot: {
        runId,
        messageId: assistantMessageId,
        attemptId: null,
        generation: null,
        revision: 0,
        eventId: null,
        status: spec.status,
        errorCode: null,
        reasoningDurationMs: spec.reasoningDurationMs,
      },
      partCount: parts.length,
      operationCount: spec.operations.length,
    },
    ...parts,
    {
      type: 'snapshot-operation',
      version: 1,
      index: 0,
      operation,
    },
    {
      type: 'snapshot-end',
      version: 1,
      partCount: parts.length,
      operationCount: spec.operations.length,
    },
  ].map((frame) => ChatSnapshotFrameSchema.parse(frame));
}

export function chatList(state: string) {
  const f5 = f5States[state];
  const records = [
    [
      chatId,
      f5?.title ??
        (state === 'chats-waiting' ? f5Chat.ask.title : fileNames.newChat),
      chatTimes.newChat.at,
    ],
    [
      '00000000-0000-4000-8000-000000000111',
      fileNames.acquisition,
      chatTimes.acquisition.at,
    ],
    [
      '00000000-0000-4000-8000-000000000112',
      fileNames.employment,
      chatTimes.employment.at,
    ],
    [
      '00000000-0000-4000-8000-000000000113',
      fileNames.forceMajeure,
      chatTimes.forceMajeure.at,
    ],
    [
      '00000000-0000-4000-8000-000000000114',
      fileNames.default,
      chatTimes.default.at,
    ],
    ['00000000-0000-4000-8000-000000000115', fileNames.data, chatTimes.data.at],
  ];
  return ChatPageSchema.parse({
    items:
      state === 'chats-empty'
        ? []
        : records.map(([id, title, updatedAt], index) => ({
            id,
            title,
            updatedAt,
            lastMessageAt: updatedAt,
            awaitingUser:
              index === 0 &&
              (f5?.waiting === true || state === 'chats-waiting'),
          })),
    pageInfo: { nextCursor: null },
  });
}

export function searchExcerpt(excerpt: string) {
  const matchStart = excerpt.indexOf('wanprestasi');
  return {
    excerpt,
    matchStart,
    matchEnd: matchStart + 'wanprestasi'.length,
  };
}

export function searchPage(state: string, query: string) {
  const [wanprestasi, forceMajeure, newChat] = searchResults;
  const matches =
    state === 'chats-no-results' || query === 'hak tanggungan'
      ? []
      : [
          {
            chatId,
            title: wanprestasi.title,
            messageId: userMessageId,
            ...searchExcerpt(wanprestasi.excerpt),
            updatedAt: chatTimes.default.at,
          },
          {
            chatId: '00000000-0000-4000-8000-000000000113',
            title: forceMajeure.title,
            messageId: null,
            ...searchExcerpt(forceMajeure.excerpt),
            // The prototype's search list prints Nov 5 for this chat.
            updatedAt: '2026-11-05T03:42:00.000Z',
          },
          {
            chatId: '00000000-0000-4000-8000-000000000116',
            title: newChat.title,
            messageId: null,
            ...searchExcerpt(newChat.excerpt),
            updatedAt: chatTimes.newChat.at,
          },
        ];
  return ChatSearchPageSchema.parse({
    items: matches,
    pageInfo: { nextCursor: null },
  });
}

export function activeRunFrames(state: string) {
  const parts =
    state === 'thinking'
      ? []
      : [
          {
            type: 'snapshot-part',
            version: 1,
            partIndex: 0,
            chunkIndex: 0,
            partType: 'reasoning',
            id: 'chat-visual-reasoning',
            text: reasoning,
            final: true,
          },
          {
            type: 'snapshot-part',
            version: 1,
            partIndex: 1,
            chunkIndex: 0,
            partType: 'text',
            id: 'chat-visual-answer',
            text: state === 'reconnecting' ? reconnectingAnswer : partialAnswer,
            final: true,
          },
        ];
  const frames = [
    {
      type: 'snapshot-start',
      version: 1,
      reset: true,
      snapshot: {
        runId,
        messageId: assistantMessageId,
        attemptId: null,
        generation: null,
        revision: 0,
        eventId: null,
        status: 'running',
        errorCode: null,
        reasoningDurationMs: state === 'thinking' ? null : 8_000,
      },
      partCount: parts.length,
      operationCount: 0,
    },
    ...parts,
    {
      type: 'snapshot-end',
      version: 1,
      partCount: parts.length,
      operationCount: 0,
    },
  ].map((frame) => ChatSnapshotFrameSchema.parse(frame));
  return frames;
}

export function validateFixtures() {
  for (const state of [
    'thinking',
    'streaming-answer',
    'reasoning-open',
    'answer-complete',
    'copied-and-feedback',
    'edited-branch',
    'stopped',
    'run-error',
    'reconnecting',
    'no-signal-completion',
    'measured-no-summary-completion',
    'stopped-before-answer',
  ])
    chatTree(state);
  for (const state of Object.keys(f5States)) chatTree(state);
  for (const state of ['new-chat', 'chats-history', 'chat-actions-menu'])
    chatList(state);
  chatList('chats-empty');
  chatList('chats-waiting');
  searchPage('chats-search', 'wanprestasi');
  searchPage('chats-no-results', 'hak tanggungan');
  ChatSearchMatchSchema.parse({
    leafId: assistantMessageId,
    messageId: userMessageId,
  });
  activeRunFrames('thinking');
  activeRunFrames('streaming-answer');
  for (const state of [
    'tool-running',
    'question-single',
    'question-multi',
    'question-nda',
    'approval-pending',
  ])
    f5RunFrames(state);
}

export async function installChatFixtures(
  page: Page,
  getState: () => string,
  setPendingTreeRelease: (release: (() => void) | undefined) => void,
) {
  await page.route(/\/api\/chats(?:\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const state = getState();
    if (url.pathname === '/api/chats/events') return route.abort('failed');
    if (request.method() === 'GET' && url.pathname === '/api/chats')
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatList(state)),
      });
    if (request.method() === 'POST' && url.pathname === '/api/chats/search') {
      const input = request.postDataJSON() as { query?: string };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(searchPage(state, input.query ?? '')),
      });
    }
    if (
      request.method() === 'POST' &&
      url.pathname.endsWith(`/search-match/${userMessageId}`)
    )
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          ChatSearchMatchSchema.parse({
            leafId: assistantMessageId,
            messageId: userMessageId,
          }),
        ),
      });
    if (request.method() === 'GET' && url.pathname === `/api/chats/${chatId}`) {
      if (state === 'thread-loading') {
        await new Promise<void>((release) => setPendingTreeRelease(release));
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatTree(state)),
      });
    }
    if (request.method() === 'PUT' && url.pathname.endsWith('/feedback'))
      return route.fulfill({ status: 204 });
    return route.continue();
  });
}

export async function installRunStreamFixture(page: Page) {
  const frames: Record<string, unknown[]> = {
    thinking: activeRunFrames('thinking'),
    'streaming-answer': activeRunFrames('streaming-answer'),
    reconnecting: activeRunFrames('reconnecting'),
    'tool-running': f5RunFrames('tool-running'),
    'question-single': f5RunFrames('question-single'),
    'question-multi': f5RunFrames('question-multi'),
    'question-nda': f5RunFrames('question-nda'),
    'approval-pending': f5RunFrames('approval-pending'),
  };
  await page.addInitScript(
    ({
      fixtureRunId,
      frames,
    }: {
      fixtureRunId: string;
      frames: Record<string, unknown[]>;
    }) => {
      const nativeFetch = window.fetch.bind(window);
      let reconnectAttempts = 0;
      let disconnectFirstStream: (() => void) | undefined;
      const fixtureWindow = window as Window & {
        __chatVisualDisconnectRun?: () => boolean;
      };
      fixtureWindow.__chatVisualDisconnectRun = () => {
        if (!disconnectFirstStream) return false;
        const disconnect = disconnectFirstStream;
        disconnectFirstStream = undefined;
        disconnect();
        return true;
      };
      window.fetch = async (input, init) => {
        const requestUrl =
          typeof input === 'string' || input instanceof URL
            ? String(input)
            : input.url;
        const url = new URL(requestUrl, window.location.href);
        if (url.pathname !== `/api/runs/${fixtureRunId}/events`)
          return nativeFetch(input, init);

        const signal =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const state = new URL(window.location.href).searchParams.get(
          'capture_state',
        );
        if (state === 'reconnecting' && reconnectAttempts > 0) {
          return await new Promise<Response>((_resolve, reject) => {
            const fail = () =>
              reject(new DOMException('Aborted', 'AbortError'));
            if (signal?.aborted) fail();
            else signal?.addEventListener('abort', fail, { once: true });
          });
        }

        const disconnectAfterPartialAnswer = state === 'reconnecting';
        if (disconnectAfterPartialAnswer) reconnectAttempts += 1;
        const streamFrames =
          (disconnectAfterPartialAnswer
            ? frames.reconnecting
            : (state !== null && frames[state]) || frames.thinking) ?? [];
        const encoder = new TextEncoder();
        const frameSeparator = '\n\n';
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let settled = false;
            const close = () => {
              if (settled) return;
              settled = true;
              controller.close();
            };
            for (const frame of streamFrames)
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(frame)}${frameSeparator}`,
                ),
              );
            if (disconnectAfterPartialAnswer)
              disconnectFirstStream = () => {
                if (settled) return;
                settled = true;
                controller.error(
                  new TypeError('Transient chat stream interruption'),
                );
              };
            if (signal?.aborted) close();
            else signal?.addEventListener('abort', close, { once: true });
          },
        });
        return new Response(body, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        });
      };
    },
    { fixtureRunId: runId, frames },
  );
}

export async function openMobileSidebar(page: Page) {
  const sidebar = page.getByRole('dialog', { name: 'Sidebar' });
  if (!(await sidebar.isVisible()))
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(sidebar).toBeVisible();
  await expect(
    sidebar.getByRole('heading', { name: 'Sidebar' }),
  ).toBeAttached();
  const navigation = sidebar.getByRole('navigation', {
    name: 'Primary navigation',
  });
  await expect(navigation).toBeVisible();
  await expect(
    navigation.getByRole('link', { name: 'New chat' }),
  ).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Chats' })).toBeVisible();
  return sidebar;
}

export async function expectRecentChatReady(sidebar: Locator) {
  const recent = sidebar.getByRole('group', { name: 'Recent chats' });
  for (const title of [
    fileNames.newChat,
    fileNames.acquisition,
    fileNames.employment,
    fileNames.forceMajeure,
    fileNames.default,
    fileNames.data,
  ])
    await expect(
      recent.getByRole('link', { name: title, exact: true }),
    ).toBeVisible();
  await expect(
    recent.getByRole('link', { name: 'View all chats', exact: true }),
  ).toBeVisible();
}

export async function expectSolidDestructiveButton(button: Locator) {
  const styles = await button.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--lexon-destructive-fill)';
    probe.style.color = '#ffffff';
    document.body.append(probe);
    const expected = getComputedStyle(probe);
    const actual = getComputedStyle(element);
    const result = {
      actualBackground: actual.backgroundColor,
      expectedBackground: expected.backgroundColor,
      actualForeground: actual.color,
      expectedForeground: expected.color,
    };
    probe.remove();
    return result;
  });
  expect(styles.actualBackground).toBe(styles.expectedBackground);
  expect(styles.actualForeground).toBe(styles.expectedForeground);
}

export async function openState(page: Page, baseUrl: string, state: string) {
  if (
    state === 'chat-actions-menu' ||
    state === 'rename-inline' ||
    state === 'delete-confirm'
  ) {
    await page.goto(`${baseUrl}/chats/${chatId}`);
    await expect(page.getByText(answer.slice(0, 50))).toBeVisible();
    await page
      .getByRole('button', {
        name: `Chat actions for ${fileNames.acquisition}`,
      })
      .click();
    await expect(page.getByRole('menu')).toBeVisible();
    if (state === 'rename-inline') {
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await expect(
        page.getByRole('textbox', { name: 'Chat title' }),
      ).toBeVisible();
    }
    if (state === 'delete-confirm') {
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      const deleteButton = page.getByRole('button', {
        name: 'Delete chat',
        exact: true,
      });
      await expect(deleteButton).toBeVisible();
      await expectSolidDestructiveButton(deleteButton);
      await deleteButton.hover();
      await deleteButton.evaluate(async (button) => {
        await Promise.all(
          button
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      await expectSolidDestructiveButton(deleteButton);
      await page.mouse.move(0, 0);
    }
    return;
  }
  if (
    state === 'chats-history' ||
    state === 'chats-search' ||
    state === 'chats-no-results' ||
    state === 'chats-empty' ||
    state === 'matching-message-highlight'
  ) {
    await page.goto(`${baseUrl}/chats`);
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    if (
      state === 'chats-search' ||
      state === 'chats-no-results' ||
      state === 'matching-message-highlight'
    ) {
      const query =
        state === 'chats-no-results' ? 'hak tanggungan' : 'wanprestasi';
      const search = page.getByRole('textbox', { name: 'Search chats' });
      await search.fill(query);
      await search.press('Enter');
      if (state === 'matching-message-highlight') {
        const main = page.locator('#main');
        await expect(main.getByText('3 chats', { exact: true })).toBeVisible();
        const escapedTitle = fileNames.default.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        await main
          .getByRole('button', {
            name: new RegExp(`^${escapedTitle}(?:\\s|$)`),
          })
          .click();
        await expect(page).toHaveURL(`${baseUrl}/chats/${chatId}`);
        await expect(
          page.locator(`[data-message-id="${userMessageId}"]`),
        ).toHaveAttribute('data-search-highlight', 'true');
      } else if (state === 'chats-search') {
        await expect(page.getByText('3 chats', { exact: true })).toBeVisible();
      } else {
        await expect(
          page.getByText('No chats match “hak tanggungan”', { exact: true }),
        ).toBeVisible();
      }
    }
    return;
  }
  if (
    state === 'thread-loading' ||
    state === 'thinking' ||
    state === 'streaming-answer' ||
    state === 'reasoning-open' ||
    state === 'answer-complete' ||
    state === 'copied-and-feedback' ||
    state === 'edit-user-message' ||
    state === 'edited-branch' ||
    state === 'stopped' ||
    state === 'run-error' ||
    state === 'reconnecting' ||
    state === 'no-signal-completion' ||
    state === 'measured-no-summary-completion' ||
    state === 'stopped-before-answer'
  ) {
    const captureState =
      state === 'thinking' ||
      state === 'streaming-answer' ||
      state === 'reconnecting'
        ? `?capture_state=${state}`
        : '';
    await page.goto(`${baseUrl}/chats/${chatId}${captureState}`);
    if (state === 'thread-loading') {
      await expect(
        page.locator('#main [data-slot="aui_thread-history-skeleton"]'),
      ).toBeVisible();
      return;
    }
    if (state === 'thinking')
      await expect(page.getByText('Thinking…', { exact: true })).toBeVisible();
    if (state === 'thinking' || state === 'streaming-answer') {
      await expect(
        page.getByRole('button', { name: 'Stop generating' }),
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Message input' }),
      ).toHaveAttribute('placeholder', 'Lexon is answering…');
    }
    if (state === 'streaming-answer') {
      await expect(page.getByText('Thought for 8 seconds')).toBeVisible();
      await expect(
        page.getByText(/Pasal 1320 KUHPerdata menetapkan/).first(),
      ).toBeVisible();
    }
    if (state === 'reconnecting') {
      await expect(
        page.getByRole('button', { name: 'Stop generating' }),
      ).toBeVisible();
      await expect(
        page.getByText(/Pasal 1320 KUHPerdata menetapkan/).first(),
      ).toBeVisible();
      await expect(page.getByText('Reconnecting…')).toHaveCount(0);
      const disconnected = await page.evaluate(() => {
        const fixtureWindow = window as Window & {
          __chatVisualDisconnectRun?: () => boolean;
        };
        return fixtureWindow.__chatVisualDisconnectRun?.() ?? false;
      });
      expect(disconnected).toBe(true);
      await expect(page.getByText('Reconnecting…')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Stop generating' }),
      ).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Message input' }),
      ).toHaveAttribute('placeholder', 'Lexon is answering…');
    }
    if (state === 'reasoning-open')
      await page.locator(`[data-message-id="${assistantMessageId}"]`).hover();
    if (state === 'reasoning-open')
      await page
        .getByRole('button', { name: /Thought for 14 seconds/ })
        .click();
    if (
      state === 'answer-complete' ||
      state === 'copied-and-feedback' ||
      state === 'stopped' ||
      state === 'no-signal-completion' ||
      state === 'measured-no-summary-completion'
    )
      await page.locator(`[data-message-id="${assistantMessageId}"]`).hover();
    if (state === 'copied-and-feedback') {
      await page
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'], {
          origin: baseUrl,
        });
      await page.getByRole('button', { name: 'Copy answer' }).click();
      await page.getByRole('button', { name: 'Good answer' }).click();
      await expect(page.getByText('Thanks for your feedback.')).toBeVisible();
    }
    if (state === 'edit-user-message') {
      const message = page.locator(`[data-message-id="${userMessageId}"]`);
      await message.hover();
      await message.getByRole('button', { name: 'Edit message' }).click();
      await expect(
        page.getByRole('textbox', { name: 'Edit message input' }),
      ).toBeVisible();
    }
    if (state === 'edited-branch')
      await page
        .locator('[data-message-id="00000000-0000-4000-8000-000000000105"]')
        .hover();
    if (state === 'edited-branch')
      await expect(
        page.getByText('2 / 2', { exact: true }).first(),
      ).toBeVisible();
    if (state === 'stopped-before-answer') {
      await expect(
        page.getByText('You stopped this response.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/Pasal 1320 KUHPerdata/)).toHaveCount(0);
    }
    if (state === 'stopped')
      await expect(
        page.getByText('You stopped this response.', { exact: true }),
      ).toBeVisible();
    if (state === 'run-error')
      await expect(page.locator('#main').getByRole('alert')).toContainText(
        'The response could not be completed.',
      );
    if (state === 'no-signal-completion') {
      await expect(page.getByText(answer.slice(0, 50))).toBeVisible();
      await expect(page.getByText(/Thought for/)).toHaveCount(0);
    }
    if (state === 'measured-no-summary-completion') {
      await expect(page.getByText('Thought for 14 seconds')).toBeVisible();
      await expect(page.getByText(reasoning)).toHaveCount(0);
    }
    return;
  }
  await freezeMorningClock(page);
  await page.goto(`${baseUrl}/workspace`);
  await expect(
    page.getByText('Good morning, Ayu', { exact: true }),
  ).toBeVisible();
  if (state === 'deep-thinking-on') {
    await page
      .getByRole('textbox', { name: 'Message input' })
      .fill(deepThinkingQuestion);
    const toggle = page.getByRole('button', { name: 'Deep thinking' });
    await toggle.hover();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(0, 0);
    await toggle.hover();
    const tooltip = page.locator('[data-slot="tooltip-content"][data-open]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(
      'Takes longer and uses more of your budget',
    );
  }
  if (state === 'organization-switcher-open' || state === 'user-menu-open') {
    if (viewportWidth(page) === 390) {
      const sidebar = await openMobileSidebar(page);
      await expectRecentChatReady(sidebar);
    } else {
      const sidebar = page.getByRole('complementary', {
        name: 'Workspace navigation',
      });
      await expect(sidebar).toBeVisible();
      const collapsed = await page
        .getByRole('button', { name: 'Expand sidebar' })
        .isVisible();
      if (!collapsed) await expectRecentChatReady(sidebar);
    }
    if (state === 'organization-switcher-open')
      await page.getByRole('button', { name: /^Organization:/ }).click();
    else await page.getByRole('button', { name: /Ayu Wardani/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    if (state === 'organization-switcher-open') {
      await expect(
        page.getByRole('menuitem', { name: 'Personal', exact: true }),
      ).toBeVisible();
      const activeOrganization = page.getByRole('menuitem', {
        name: 'Hukum Nusantara',
        exact: true,
      });
      await expect(activeOrganization).toBeVisible();
      await expect(activeOrganization).toHaveAttribute('aria-current', 'true');
    }
  }
  if (state === 'sidebar-expanded' && viewportWidth(page) === 390) {
    const sidebar = await openMobileSidebar(page);
    await expectRecentChatReady(sidebar);
  }
  if (state === 'sidebar-collapsed' && viewportWidth(page) === 1440) {
    const collapseSidebar = page.getByRole('button', {
      name: 'Collapse sidebar',
    });
    if (await collapseSidebar.isVisible()) await collapseSidebar.click();
    await expect(
      page.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeVisible();
  }
}

export function viewportWidth(page: Page) {
  return page.viewportSize()?.width ?? 1440;
}

/**
 * Signs in the fixture user, creates the fixture team, and installs the
 * mocked chat API in the `answer-complete` state (F4.2 G1/G3 browser tests).
 */
export async function setupAnsweredChat(page: Page, slug: string) {
  const stack = descriptor();
  // A fresh identity and slug per call: the account rate limit and the unique
  // slug both reject a second test that reuses either.
  const unique = Math.random().toString(16).slice(2, 10);
  const headers = await authenticateApi(page.request, {
    name: 'Ayu Wardani',
    email: `ayu.wardani.${unique}@hukum-nusantara.co.id`,
  });
  const createdTeam = await page.request.post(
    `${stack.apiUrl}/api/organizations`,
    {
      headers,
      data: { name: 'Hukum Nusantara', slug: `${slug}-${unique}` },
    },
  );
  expect(createdTeam.status()).toBe(201);
  const team = OrganizationSummarySchema.parse(await createdTeam.json());
  expect(team).toMatchObject({
    name: 'Hukum Nusantara',
    kind: 'team',
    role: 'owner',
  });
  const activeTeam = await page.request.post(
    `${stack.apiUrl}/api/organizations/active`,
    { headers, data: { organizationId: team.id } },
  );
  expect(activeTeam.status()).toBe(200);
  expect(SwitchResultSchema.parse(await activeTeam.json())).toMatchObject({
    status: 'switched',
    organization: { id: team.id, name: 'Hukum Nusantara', role: 'owner' },
  });
  const onboarded = await page.request.post(
    `${stack.apiUrl}/api/identity/onboarding/complete`,
    { headers, data: {} },
  );
  expect(onboarded.status()).toBe(204);
  await installChatFixtures(
    page,
    () => 'answer-complete',
    () => {},
  );
  return stack;
}
