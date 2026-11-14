import { afterEach, expect, it, vi } from 'vitest';
import { ChatMessageRepository } from '../../src/infrastructure/db/index.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';
import {
  CHAT_HISTORY_CONTEXT_ID,
  CHAT_PROFILES,
} from '../../src/modules/chat/chat-profiles.js';
import { ChatHistoryContextProvider } from '../../src/modules/chat/chat-history-context.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const orgId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const actor = { orgId, userId } as RunActor;
const historyBudget =
  CHAT_PROFILES.chat.contextBudgets[CHAT_HISTORY_CONTEXT_ID]!;
type ChatHistoryRecord = Awaited<
  ReturnType<ChatMessageRepository['historyForRun']>
>[number];

function record(
  role: ChatHistoryRecord['role'],
  text: string | null,
  status: string | null,
): ChatHistoryRecord {
  return { role, text, status };
}

function setup(history: readonly ChatHistoryRecord[] = []) {
  const tx = {};
  const withTenant = vi.fn(
    async (_scope: unknown, callback: (session: unknown) => Promise<unknown>) =>
      callback(tx),
  );
  const historyForRun = vi
    .spyOn(ChatMessageRepository.prototype, 'historyForRun')
    .mockResolvedValue(history);
  const provider = new ChatHistoryContextProvider({
    withTenant,
  } as never);
  return { provider, withTenant, historyForRun, tx };
}

function collect(
  provider: ChatHistoryContextProvider,
  overrides: {
    readonly input?: Readonly<Record<string, unknown>>;
    readonly budget?: number;
  } = {},
) {
  return provider.collect({
    actor,
    runId,
    input: { prompt: 'Summarize the key points.' },
    budget: historyBudget,
    ...overrides,
  });
}

it.each<
  [string, { input?: Readonly<Record<string, unknown>>; budget?: number }]
>([
  ['the wrong context budget', { budget: historyBudget - 1 }],
  ['a missing prompt', { input: {} }],
  ['a non-string prompt', { input: { prompt: 12 } }],
  ['a blank prompt', { input: { prompt: '   ' } }],
])('rejects %s before tenant history IO', async (_label, overrides) => {
  const { provider, withTenant, historyForRun } = setup();

  await expect(collect(provider, overrides)).rejects.toThrow(
    'AI context request denied',
  );

  expect(withTenant).not.toHaveBeenCalled();
  expect(historyForRun).not.toHaveBeenCalled();
});

it('loads the actor-owned run history and keeps only nonblank user and terminal assistant text in path order', async () => {
  const completed = Object.assign(
    record('assistant', 'Completed answer', 'completed'),
    {
      reasoningSummary: 'REASONING_CANARY_NOT_CONTEXT',
      providerDetail: 'PROVIDER_CANARY_NOT_CONTEXT',
    },
  );
  const history = [
    record('user', '  Earlier question  ', null),
    completed,
    record('assistant', 'Failed answer', 'failed'),
    record('assistant', 'Cancelled answer', 'cancelled'),
    record('assistant', 'Still running output', 'running'),
    record('assistant', 'Queued output', 'queued'),
    record('assistant', 'Unknown output', null),
    record('assistant', '   ', 'completed'),
    record('user', null, null),
  ];
  const { provider, withTenant, historyForRun, tx } = setup(history);

  const pieces = await collect(provider);

  expect(withTenant).toHaveBeenCalledWith(
    { orgId, userId },
    expect.any(Function),
  );
  expect(historyForRun).toHaveBeenCalledWith(tx, runId);
  expect(pieces).toEqual([
    { label: 'chat history user', text: '  Earlier question  ' },
    { label: 'chat history assistant completed', text: 'Completed answer' },
    { label: 'chat history assistant failed', text: 'Failed answer' },
    { label: 'chat history assistant cancelled', text: 'Cancelled answer' },
  ]);
  expect(JSON.stringify(pieces)).not.toContain('CANARY_NOT_CONTEXT');
});

it('drops oldest history until escaped multibyte JSON data fits the serialized byte budget', async () => {
  const olderText = `Earlier ${'é'.repeat(66_000)} with quote " and newline\n`;
  const newestText = 'Keep this newest turn: 「retention」';
  const { provider } = setup([
    record('user', olderText, null),
    record('user', newestText, null),
  ]);

  const pieces = await collect(provider);

  expect(pieces).toEqual([{ label: 'chat history user', text: newestText }]);
});

it('accepts history at the exact serialized UTF-8 byte boundary and drops a piece one byte over', async () => {
  // One user piece serializes as 41 JSON bytes of fixed framing plus ASCII text.
  const exactText = 'x'.repeat(historyBudget - 41);
  const exact = setup([record('user', exactText, null)]);
  const exactPieces = await collect(exact.provider);
  expect(exactPieces).toEqual([
    { label: 'chat history user', text: exactText },
  ]);

  const overText = 'x'.repeat(historyBudget - 40);
  const over = setup([record('user', overText, null)]);
  await expect(collect(over.provider)).resolves.toEqual([]);
});

it('returns no history when the actual assembled model input cannot fit alongside the prompt', async () => {
  const { provider } = setup([
    record('user', 'Old context that would otherwise fit.', null),
  ]);

  const pieces = await collect(provider, {
    input: { prompt: 'x'.repeat(1_000_000) },
  });

  expect(pieces).toEqual([]);
});

it('returns an empty list for empty history', async () => {
  const { provider } = setup();

  await expect(collect(provider)).resolves.toEqual([]);
});
