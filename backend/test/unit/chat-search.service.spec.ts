import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ChatSearchRepository,
  type ChatSearchRow,
} from '../../src/infrastructure/db/index.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';
import { ChatSearchService } from '../../src/modules/chat/chat-search.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const orgId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const actor = { orgId, userId } as RunActor;
const updatedAt = new Date('2026-11-13T09:30:00.000Z');
const activityAt = '2026-11-13T09:30:00.000000Z';

function row(overrides: Partial<ChatSearchRow> = {}): ChatSearchRow {
  return {
    chatId: randomUUID(),
    title: 'Case notes',
    messageId: randomUUID(),
    excerpt: 'The contract clause applies.',
    matchStart: null,
    matchEnd: null,
    updatedAt,
    activityAt,
    score: '0.75',
    ...overrides,
  };
}

function setup(rows: ChatSearchRow[] = []) {
  const tx = {};
  const withTenant = vi.fn(
    async (_scope: unknown, callback: (session: unknown) => Promise<unknown>) =>
      callback(tx),
  );
  const assertLiveActor = vi.fn();
  const search = vi
    .spyOn(ChatSearchRepository.prototype, 'search')
    .mockResolvedValue(rows);
  const service = new ChatSearchService(
    { withTenant } as never,
    { assertLiveActor } as never,
  );
  return { service, withTenant, assertLiveActor, search, tx };
}

it('passes the trimmed query and tenant scope, returns only ranked page rows, and encodes the last visible row as the next cursor', async () => {
  const first = row({
    score: '0.91',
    activityAt: '2026-11-13T09:30:00.000000Z',
  });
  const second = row({
    score: '0.82',
    activityAt: '2026-11-12T09:30:00.000000Z',
  });
  const lookahead = row({
    score: '0.70',
    activityAt: '2026-11-11T09:30:00.000000Z',
  });
  const { service, withTenant, assertLiveActor, search, tx } = setup([
    first,
    second,
    lookahead,
  ]);

  const result = await service.search(actor, {
    query: '  contract  ',
    limit: 2,
  });

  expect(assertLiveActor).toHaveBeenCalledWith(actor);
  expect(withTenant).toHaveBeenCalledWith(
    { orgId, userId },
    expect.any(Function),
  );
  expect(search).toHaveBeenCalledWith(
    tx,
    'contract',
    null,
    2,
    expect.objectContaining({
      start: expect.any(String),
      end: expect.any(String),
    }),
  );
  expect(result.items.map((item) => item.chatId)).toEqual([
    first.chatId,
    second.chatId,
  ]);
  expect(result.items).not.toContainEqual(
    expect.objectContaining({ chatId: lookahead.chatId }),
  );
  expect(result.pageInfo.nextCursor).toEqual(expect.any(String));
});

it.each<[string, ChatSearchRow[]]>([
  ['an empty page', []],
  ['a final page without a lookahead row', [row()]],
])('%s has no next cursor', async (_label, rows) => {
  const { service } = setup(rows);

  const result = await service.search(actor, { query: 'contract', limit: 2 });

  expect(result.items).toHaveLength(rows.length);
  expect(result.pageInfo.nextCursor).toBeNull();
});

it('returns the exact full page without a next cursor when there is no lookahead row', async () => {
  const rows = [row(), row()];
  const { service } = setup(rows);

  const result = await service.search(actor, { query: 'contract', limit: 2 });

  expect(result.items).toHaveLength(2);
  expect(result.pageInfo.nextCursor).toBeNull();
});

it('round-trips the last selected cursor values to the repository on the next page', async () => {
  const selected = row({
    score: '0.625',
    activityAt: '2026-11-10T01:02:03.123456Z',
  });
  const { service, search } = setup([selected, row()]);
  const firstPage = await service.search(actor, {
    query: 'contract',
    limit: 1,
  });
  const cursor = firstPage.pageInfo.nextCursor;
  expect(cursor).toBeTruthy();
  search.mockResolvedValueOnce([]);

  await service.search(actor, {
    query: 'contract',
    cursor: cursor!,
    limit: 20,
  });

  expect(search).toHaveBeenLastCalledWith(
    expect.anything(),
    'contract',
    {
      score: selected.score,
      activityAt: selected.activityAt,
      chatId: selected.chatId,
      messageId: null,
    },
    20,
    expect.objectContaining({
      start: expect.any(String),
      end: expect.any(String),
    }),
  );
});

it.each<[string, Partial<RunActor>, string]>([
  [
    'another organization',
    { orgId: '33333333-3333-4333-8333-333333333333' },
    'contract',
  ],
  [
    'another user',
    { userId: '44444444-4444-4444-8444-444444444444' },
    'contract',
  ],
  ['another query', {}, 'statute'],
])(
  'rejects a valid cursor reused for %s before tenant database work',
  async (_label, actorChanges, query) => {
    const { service, withTenant, search } = setup([row(), row()]);
    const page = await service.search(actor, { query: 'contract', limit: 1 });
    const otherActor = { ...actor, ...actorChanges } as RunActor;

    await expect(
      service.search(otherActor, {
        query,
        cursor: page.pageInfo.nextCursor!,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'CHAT_CONFLICT' });

    expect(withTenant).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  },
);

it.each<[string, (parts: unknown[]) => void]>([
  ['unsupported version', (parts: unknown[]) => (parts[0] = 2)],
  ['invalid score', (parts: unknown[]) => (parts[2] = '01.2')],
  [
    'invalid activity timestamp',
    (parts: unknown[]) => (parts[3] = 'yesterday'),
  ],
  ['invalid chat UUID', (parts: unknown[]) => (parts[4] = 'not-a-uuid')],
  ['modified digest', (parts: unknown[]) => (parts[1] = '0'.repeat(64))],
])(
  'rejects a cursor with %s before tenant database work',
  async (_label, tamper) => {
    const { service, withTenant, search } = setup([row(), row()]);
    const page = await service.search(actor, { query: 'contract', limit: 1 });
    const parts = JSON.parse(
      Buffer.from(page.pageInfo.nextCursor!, 'base64url').toString('utf8'),
    ) as unknown[];
    tamper(parts);
    const cursor = Buffer.from(JSON.stringify(parts), 'utf8').toString(
      'base64url',
    );

    await expect(
      service.search(actor, { query: 'contract', cursor, limit: 20 }),
    ).rejects.toMatchObject({
      code: 'CHAT_CONFLICT',
    });

    expect(withTenant).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  },
);

it('bounds a long excerpt to 500 UTF-16 units and reports the match offset within that excerpt', async () => {
  const text = `${'a'.repeat(250)} target ${'z'.repeat(600)}`;
  const { service } = setup([row({ excerpt: text })]);

  const [match] = (await service.search(actor, { query: 'target', limit: 20 }))
    .items;

  expect(match?.excerpt).toHaveLength(500);
  expect(match?.excerpt).toBe(text.slice(71, 571));
  expect(match?.matchStart).toBe(180);
  expect(match?.matchEnd).toBe(186);
});

it('keeps a bounded snippet at the start and removes database highlight markers while preserving their offsets', async () => {
  const { service, search } = setup();
  search.mockImplementation(async (_tx, _query, _cursor, _limit, markers) => [
    row({ excerpt: `before ${markers.start}target${markers.end} after` }),
  ]);

  const [match] = (await service.search(actor, { query: 'target', limit: 20 }))
    .items;

  expect(match?.excerpt).toBe('before target after');
  expect(match?.excerpt).not.toContain('__LX');
  expect(match?.matchStart).toBe(7);
  expect(match?.matchEnd).toBe(13);
});

it.each<
  [
    string,
    (markers: { start: string; end: string }) => string,
    string,
    number | null,
    number | null,
  ]
>([
  [
    'a marker pair at the text boundaries',
    (markers) => `${markers.start}target${markers.end} trailing`,
    'target trailing',
    0,
    6,
  ],
  [
    'repeated start and end markers',
    (markers) =>
      `a${markers.start}b${markers.start}c${markers.end}d${markers.end}e`,
    'abcde',
    1,
    3,
  ],
])(
  'parses %s from database highlight text',
  async (_label, buildText, expectedExcerpt, matchStart, matchEnd) => {
    const { service, search } = setup();
    search.mockImplementation(async (_tx, _query, _cursor, _limit, markers) => [
      row({ excerpt: buildText(markers) }),
    ]);

    const [match] = (
      await service.search(actor, { query: 'target', limit: 20 })
    ).items;

    expect(match?.excerpt).toBe(expectedExcerpt);
    expect(match?.matchStart).toBe(matchStart);
    expect(match?.matchEnd).toBe(matchEnd);
  },
);

it('does not treat an end-before-start marker sequence as a highlighted span', async () => {
  let expectedExcerpt = '';
  const { service, search } = setup();
  search.mockImplementation(async (_tx, _query, _cursor, _limit, markers) => {
    expectedExcerpt = `${markers.end}prefix ${markers.start}target`;
    return [row({ excerpt: expectedExcerpt })];
  });

  const [match] = (await service.search(actor, { query: 'missing', limit: 20 }))
    .items;

  expect(match?.excerpt).toBe(expectedExcerpt);
  expect(match?.matchStart).toBeNull();
  expect(match?.matchEnd).toBeNull();
});

it('does not report a match when the highlighted span falls beyond the bounded snippet', async () => {
  const { service, search } = setup();
  search.mockImplementation(async (_tx, _query, _cursor, _limit, markers) => [
    row({ excerpt: `${markers.start}${'x'.repeat(600)}${markers.end}` }),
  ]);

  const [match] = (await service.search(actor, { query: 'target', limit: 20 }))
    .items;

  expect(match?.excerpt).toBe('x'.repeat(500));
  expect(match?.matchStart).toBeNull();
  expect(match?.matchEnd).toBeNull();
});

it('tries later query tokens when the first token is absent from the excerpt', async () => {
  const { service } = setup([row({ excerpt: 'The statute applies here.' })]);

  const [match] = (
    await service.search(actor, { query: 'missing statute', limit: 20 })
  ).items;

  expect(match?.matchStart).toBe(4);
  expect(match?.matchEnd).toBe(11);
});

it('does not split a surrogate pair at either bounded snippet edge', async () => {
  const text = `😀${'a'.repeat(179)}needle${'z'.repeat(314)}😀${'z'.repeat(100)}`;
  const { service } = setup([row({ excerpt: text })]);

  const [match] = (await service.search(actor, { query: 'needle', limit: 20 }))
    .items;
  expect(match).toBeDefined();
  const excerpt = match!.excerpt;

  expect(excerpt).toBe(text.slice(2, 501));
  expect(excerpt.length).toBe(499);
  expect(excerpt[0]).toBe('a');
  expect(excerpt.at(-1)).toBe('z');
  expect(match?.matchStart).toBe(179);
  expect(match?.matchEnd).toBe(185);
});

it('uses the alphanumeric query token for punctuation-bearing case-insensitive fallback matches', async () => {
  const { service } = setup([row({ excerpt: 'Exact (term) appears here.' })]);

  const [match] = (await service.search(actor, { query: '(TERM)', limit: 20 }))
    .items;

  expect(match?.excerpt).toBe('Exact (term) appears here.');
  expect(match?.matchStart).toBe(7);
  expect(match?.matchEnd).toBe(11);
});

it('returns title-only rows without a message highlight and applies safe empty title and excerpt defaults', async () => {
  const { service, search } = setup();
  search.mockImplementation(async (_tx, _query, _cursor, _limit, markers) => [
    row({
      messageId: null,
      title: '',
      excerpt: `before ${markers.start}contract${markers.end} after`,
      matchStart: 5,
      matchEnd: 9,
    }),
  ]);

  const [match] = (
    await service.search(actor, { query: 'contract', limit: 20 })
  ).items;

  expect(match).toMatchObject({
    title: 'New chat',
    messageId: null,
    excerpt: expect.stringContaining('__LX'),
  });
  expect(match?.excerpt).toContain('contract');
  expect(match?.matchStart).toBeGreaterThan(7);
  expect(match?.matchEnd).toBe((match?.matchStart ?? 0) + 'contract'.length);
  expect(match?.excerpt).not.toBe('before contract after');
});

it('maps PostgreSQL statement timeout to the fixed search timeout error', async () => {
  const { service, search } = setup();
  search.mockRejectedValueOnce(
    Object.assign(new Error('private database detail'), { code: '57014' }),
  );

  await expect(
    service.search(actor, { query: 'contract', limit: 20 }),
  ).rejects.toMatchObject({
    code: 'CHAT_SEARCH_TIMEOUT',
    message: expect.not.stringContaining('private database detail'),
  });
});

it.each<[unknown]>([
  [null],
  ['57014'],
  [57014],
  [{ code: 'OTHER' }],
  [{ code: 57014 }],
])('preserves a non-PostgreSQL-timeout failure value (%s)', async (failure) => {
  const { service, search } = setup();
  search.mockRejectedValueOnce(failure);

  await expect(
    service.search(actor, { query: 'contract', limit: 20 }),
  ).rejects.toBe(failure);
});

it('preserves unrelated repository errors for the outer safe error boundary', async () => {
  const failure = new Error('repository failure');
  const { service, search } = setup();
  search.mockRejectedValueOnce(failure);

  await expect(
    service.search(actor, { query: 'contract', limit: 20 }),
  ).rejects.toBe(failure);
});
