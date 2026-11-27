import { afterEach, expect, it, vi } from 'vitest';
import {
  ChatMessageRepository,
  ChatRepository,
  readTreeValidator,
  type ChatRecord,
} from '../../src/infrastructure/db/index.js';
import { ChatService } from '../../src/modules/chat/chat.service.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';

// The service must order readLive → readTreeValidator → match → tree inside
// one withTenant (spec §5 item 15, owner amendment 3). readTreeValidator is
// module-mocked so its invocation order can be compared to the repository spy.
vi.mock(
  '../../src/infrastructure/db/chat-tree-validator.js',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    readTreeValidator: vi.fn(),
  }),
);
const validator = vi.mocked(readTreeValidator);

afterEach(() => {
  vi.restoreAllMocks();
});

const orgId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const actor = { orgId, userId } as RunActor;
const chatId = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';
const createdAt = new Date('2026-11-23T08:00:00.000Z');

const chat: ChatRecord = {
  id: chatId,
  orgId,
  ownerUserId: userId,
  title: 'Case notes',
  titleSource: 'excerpt',
  titleVersion: 1,
  viewedLeafId: '44444444-4444-4444-8444-444444444444',
  activeAnswerRunId: null,
  deletedAt: null,
  createdAt,
  updatedAt: createdAt,
  lastActivityAt: createdAt,
  projectId: null,
};

const tree = {
  chatId,
  viewedLeafId: '44444444-4444-4444-8444-444444444444',
  messages: [
    {
      id: messageId,
      parentMessageId: null,
      role: 'user' as const,
      userText: 'Summarise the clause.',
      effort: 'high' as const,
      assistantText: null,
      reasoningSummary: null,
      reasoningDurationMs: null,
      feedback: null,
      operations: [],
      runId: null,
      status: null,
      createdAt,
    },
  ],
};

function setup(options: { chat?: ChatRecord | null } = {}) {
  const tx = {};
  const withTenant = vi.fn(
    async (_scope: unknown, callback: (session: unknown) => Promise<unknown>) =>
      callback(tx),
  );
  const assertLiveActor = vi.fn();
  const readLive = vi
    .spyOn(ChatRepository.prototype, 'readLive')
    .mockResolvedValue(options.chat === undefined ? chat : options.chat);
  const treeSpy = vi
    .spyOn(ChatMessageRepository.prototype, 'tree')
    .mockResolvedValue(tree);
  const service = new ChatService(
    { withTenant } as never,
    {} as never,
    { assertLiveActor } as never,
  );
  return { service, withTenant, assertLiveActor, readLive, treeSpy, tx };
}

it('a matching tag returns notModified without calling the tree query', async () => {
  const { service, treeSpy } = setup();
  validator.mockResolvedValue('W/"v1.same-tag"');

  const result = await service.get(actor, chatId, {
    ifNoneMatch: '"v1.same-tag"',
  });

  expect(result).toEqual({
    notModified: true,
    etag: 'W/"v1.same-tag"',
  });
  expect(treeSpy).not.toHaveBeenCalled();
});

it('the wildcard tag never reaches the tree query', async () => {
  const { service, treeSpy } = setup();
  validator.mockResolvedValue('W/"v1.some-tag"');

  const result = await service.get(actor, chatId, { ifNoneMatch: '*' });

  expect(result).toEqual({
    notModified: true,
    etag: 'W/"v1.some-tag"',
  });
  expect(treeSpy).not.toHaveBeenCalled();
});

it('a non-matching tag runs the validator before the tree query', async () => {
  const { service, treeSpy } = setup();
  validator.mockResolvedValue('W/"v1.new-tag"');

  const result = await service.get(actor, chatId, {
    ifNoneMatch: 'W/"v1.old-tag"',
  });

  expect(result.notModified).toBe(false);
  if (!result.notModified) {
    expect(result.etag).toBe('W/"v1.new-tag"');
    expect(result.tree.id).toBe(chatId);
  }
  expect(validator).toHaveBeenCalledTimes(1);
  expect(treeSpy).toHaveBeenCalledTimes(1);
  const validatorOrder = validator.mock.invocationCallOrder[0]!;
  const treeOrder = treeSpy.mock.invocationCallOrder[0]!;
  expect(validatorOrder).toBeLessThan(treeOrder);
});

it('no tag still returns the tree and the fresh tag', async () => {
  const { service, treeSpy } = setup();
  validator.mockResolvedValue('W/"v1.fresh-tag"');

  const result = await service.get(actor, chatId);

  expect(result.notModified).toBe(false);
  if (!result.notModified) {
    expect(result.etag).toBe('W/"v1.fresh-tag"');
    expect(result.tree.messages).toHaveLength(1);
  }
  expect(treeSpy).toHaveBeenCalledTimes(1);
});

it('a missing chat is CHAT_NOT_FOUND even with If-None-Match: *', async () => {
  const { service, treeSpy } = setup({ chat: null });

  await expect(
    service.get(actor, chatId, { ifNoneMatch: '*' }),
  ).rejects.toMatchObject({ code: 'CHAT_NOT_FOUND' });
  expect(validator).not.toHaveBeenCalled();
  expect(treeSpy).not.toHaveBeenCalled();
});

it('a chat deleted between reads is CHAT_NOT_FOUND, never a 304', async () => {
  const { service, treeSpy } = setup();
  validator.mockResolvedValue(null);

  await expect(
    service.get(actor, chatId, { ifNoneMatch: '*' }),
  ).rejects.toMatchObject({ code: 'CHAT_NOT_FOUND' });
  expect(treeSpy).not.toHaveBeenCalled();
});

const ownerId = '55555555-5555-4555-8555-555555555555';
const readerChat: ChatRecord = { ...chat, ownerUserId: ownerId };
const identity = {} as never;

function setupReader(port: { transaction: ReturnType<typeof vi.fn> }) {
  const tx = {};
  let order = 0;
  let tenantEndedAt = -1;
  const withTenant = vi.fn(
    async (
      _scope: unknown,
      callback: (session: unknown) => Promise<unknown>,
    ) => {
      const result = await callback(tx);
      tenantEndedAt = ++order;
      return result;
    },
  );
  vi.spyOn(ChatRepository.prototype, 'readLive').mockResolvedValue(readerChat);
  vi.spyOn(ChatMessageRepository.prototype, 'tree').mockResolvedValue(tree);
  const service = new ChatService(
    { withTenant } as never,
    {} as never,
    { assertLiveActor: vi.fn() } as never,
    undefined,
    port as never,
  );
  return {
    service,
    withTenant,
    tenantEndedAt: () => tenantEndedAt,
    order: () => order,
  };
}

it('resolves the owner name after the tenant transaction closes', async () => {
  let portCalledAt = -1;
  const port = {
    transaction: vi.fn(
      async (
        _id: unknown,
        work: (tx: { call: () => Promise<unknown> }) => Promise<unknown>,
      ) => {
        portCalledAt = 0;
        return work({
          call: async () => ({
            members: [{ userId: ownerId, user: { name: 'Share Owner' } }],
          }),
        });
      },
    ),
  };
  const { service, tenantEndedAt, order } = setupReader(port);
  port.transaction.mockImplementation(
    async (
      _id: unknown,
      work: (tx: { call: () => Promise<unknown> }) => Promise<unknown>,
    ) => {
      portCalledAt = order() + 1;
      return work({
        call: async () => ({
          members: [{ userId: ownerId, user: { name: 'Share Owner' } }],
        }),
      });
    },
  );
  validator.mockResolvedValue('W/"v1.reader-tag"');

  const result = await service.get(actor, chatId, {}, identity);

  expect(result.notModified).toBe(false);
  if (!result.notModified) expect(result.tree.ownerName).toBe('Share Owner');
  expect(port.transaction).toHaveBeenCalledTimes(1);
  expect(portCalledAt).toBeGreaterThan(tenantEndedAt());
});

it('a throwing member directory still returns the reader tree', async () => {
  const port = {
    transaction: vi.fn(async () => {
      throw new Error('auth side unavailable');
    }),
  };
  const { service } = setupReader(port);
  validator.mockResolvedValue('W/"v1.reader-tag"');

  const result = await service.get(actor, chatId, {}, identity);

  expect(result.notModified).toBe(false);
  if (!result.notModified) {
    expect(result.tree.access).toBe('reader');
    expect(result.tree.ownerName).toBeUndefined();
  }
});
