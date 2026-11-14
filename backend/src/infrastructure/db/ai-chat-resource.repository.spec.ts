import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import type { TenantContext } from './authorization-predicate.js';
import { AiChatResourceRepository } from './ai-chat-resource.repository.js';
import {
  beginSession,
  endSession,
  type TenantSession,
} from './tenant-session.js';

afterEach(() => {
  for (const session of sessions) endSession(session);
  sessions.clear();
});

const orgId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherChatId = '55555555-5555-4555-8555-555555555555';
const repository = new AiChatResourceRepository();
const sessions = new Set<TenantSession>();

function setup() {
  const query = vi.fn(
    async (
      ...args: [sql: string, values?: readonly unknown[]]
    ): Promise<{
      rows: unknown[];
      rowCount: number | null;
    }> => {
      void args;
      return { rows: [], rowCount: 0 };
    },
  );
  const client = { query } as unknown as PoolClient;
  const pool = {} as Pool;
  const context: TenantContext = { orgId, userId: ownerId };
  const session = beginSession(client, context, pool);
  sessions.add(session);
  return { query, session };
}

function runRow(
  overrides: {
    readonly owner_user_id?: string;
    readonly resource_ids?: unknown;
    readonly chat_id?: string | null;
  } = {},
) {
  return {
    owner_user_id: ownerId,
    resource_ids: [chatId],
    chat_id: chatId,
    ...overrides,
  };
}

function useRunRow(
  query: ReturnType<typeof setup>['query'],
  run: ReturnType<typeof runRow> | undefined,
) {
  query.mockResolvedValueOnce({
    rows: run ? [run] : [],
    rowCount: run ? 1 : 0,
  });
}

it('rejects an invalid run UUID before opening or querying a session', async () => {
  const { query, session } = setup();
  endSession(session);

  await expect(repository.lockLiveForRun(session, 'not-a-uuid')).resolves.toBe(
    false,
  );

  expect(query).not.toHaveBeenCalled();
});

it('rejects a valid run when its tenant session has expired', async () => {
  const { query, session } = setup();
  endSession(session);

  await expect(repository.lockLiveForRun(session, runId)).rejects.toThrow(
    'Tenant session expired',
  );
  expect(query).not.toHaveBeenCalled();
});

it('returns false when the run is missing or belongs to another user', async () => {
  const missing = setup();
  useRunRow(missing.query, undefined);
  await expect(repository.lockLiveForRun(missing.session, runId)).resolves.toBe(
    false,
  );

  const wrongOwner = setup();
  useRunRow(wrongOwner.query, runRow({ owner_user_id: randomUUID() }));
  await expect(
    repository.lockLiveForRun(wrongOwner.session, runId),
  ).resolves.toBe(false);
  expect(wrongOwner.query).toHaveBeenCalledTimes(1);
});

it('allows a resource-free legacy run only when no chat is mapped', async () => {
  const legacy = setup();
  useRunRow(legacy.query, runRow({ resource_ids: [], chat_id: null }));
  await expect(repository.lockLiveForRun(legacy.session, runId)).resolves.toBe(
    true,
  );
  expect(legacy.query).toHaveBeenCalledTimes(1);

  const mappedWithoutResources = setup();
  useRunRow(mappedWithoutResources.query, runRow({ resource_ids: [] }));
  await expect(
    repository.lockLiveForRun(mappedWithoutResources.session, runId),
  ).resolves.toBe(false);
  expect(mappedWithoutResources.query).toHaveBeenCalledTimes(1);
});

it.each<[string, unknown]>([
  ['a missing value', undefined],
  ['a non-array value', { resource: chatId }],
  ['an empty array', []],
])(
  'rejects a mapped chat with %s resource IDs',
  async (_label, resourceIds) => {
    const { query, session } = setup();
    useRunRow(query, runRow({ resource_ids: resourceIds }));

    await expect(repository.lockLiveForRun(session, runId)).resolves.toBe(
      false,
    );

    expect(query).toHaveBeenCalledTimes(1);
  },
);

it.each<[string, unknown, string | null]>([
  ['more than one resource', [chatId, otherChatId], chatId],
  ['a non-string resource', [42], chatId],
  ['an invalid resource UUID', ['invalid'], chatId],
  ['a resource that differs from the mapping', [otherChatId], chatId],
  ['a resource without a chat mapping', [chatId], null],
])(
  'rejects %s before locking a chat',
  async (_label, resourceIds, mappedChatId) => {
    const { query, session } = setup();
    useRunRow(
      query,
      runRow({ resource_ids: resourceIds, chat_id: mappedChatId }),
    );

    await expect(repository.lockLiveForRun(session, runId)).resolves.toBe(
      false,
    );

    expect(query).toHaveBeenCalledTimes(1);
  },
);

it('accepts one matching resource case-insensitively only when the live owned chat row is locked', async () => {
  const uppercaseChatId = chatId.toUpperCase();
  const { query, session } = setup();
  useRunRow(
    query,
    runRow({ resource_ids: [uppercaseChatId], chat_id: chatId }),
  );
  query.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

  await expect(repository.lockLiveForRun(session, runId)).resolves.toBe(true);

  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0]?.[1]).toEqual([orgId, runId]);
  expect(query.mock.calls[1]?.[1]).toEqual([orgId, chatId, ownerId]);
  expect(query.mock.calls[1]?.[0]).toMatch(/deleted_at\s+IS\s+NULL/i);
  expect(query.mock.calls[1]?.[0]).toMatch(/FOR\s+UPDATE/i);
});

it.each<[string, number | null]>([
  ['missing', 0],
  ['non-unique', 2],
  ['unknown row count', null],
])(
  'denies the mapped chat when the locking query returns a %s row count',
  async (_label, rowCount) => {
    const { query, session } = setup();
    useRunRow(query, runRow());
    query.mockResolvedValueOnce({ rows: [{}], rowCount });

    await expect(repository.lockLiveForRun(session, runId)).resolves.toBe(
      false,
    );
  },
);
