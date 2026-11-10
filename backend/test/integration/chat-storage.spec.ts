import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  AiRunRepository,
  ChatRepository,
} from '../../src/infrastructure/db/index.js';
import { test } from '../setup/file-services.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';

test('chat storage is tenant forced-RLS with owner and deletion predicates', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const result = await fixture.inspect.chatSchema();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      relrowsecurity: true,
      relforcerowsecurity: true,
      columns: expect.arrayContaining([
        'org_id',
        'owner_user_id',
        'deleted_at',
        'active_answer_run_id',
      ]),
    });
  } finally {
    await fixture.close();
  }
});

test('chat trees are visible only to their owner in the active tenant', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  const owner = fixture.tenants[0]!;
  const anotherUser = fixture.tenants[1]!;
  try {
    const chat = await fixture.chat.create(0);
    const rootId = randomUUID();
    await fixture.chat.insertUser(0, {
      chatId: chat.id,
      messageId: rootId,
      parentMessageId: null,
      text: 'Owner-private question',
      effort: 'high',
    });
    const run = await fixture.database.withTenant(owner, (tx) => {
      return new AiRunRepository().insert(tx, {
        id: randomUUID(),
        orgId: owner.orgId,
        initiatingUserId: owner.userId,
        profileId: 'test-profile',
        profileVersion: 1,
        resolvedConfig: { resourceIds: [] },
        modelId: 'synthetic/test',
        inputText: 'Owner-private question',
        inputBudgetTokens: 100,
        outputBudgetTokens: 100,
      });
    });
    await fixture.chat.setRunOutput(0, run.id, 'Canonical assistant answer');
    await fixture.chat.linkAnswer(0, chat.id, run.id);
    await fixture.chat.insertAssistant(0, {
      chatId: chat.id,
      messageId: run.id,
      parentMessageId: rootId,
      runId: run.id,
    });
    expect(await fixture.chat.selectLeaf(0, chat.id, run.id)).toBe(true);
    expect(await fixture.chat.tree(0, chat.id)).toMatchObject({
      chatId: chat.id,
      viewedLeafId: run.id,
      messages: [
        { id: rootId, userText: 'Owner-private question' },
        { id: run.id, assistantText: 'Canonical assistant answer' },
      ],
    });
    expect(
      await fixture.chat.treeAs(
        { orgId: owner.orgId, userId: anotherUser.userId },
        chat.id,
      ),
    ).toBeNull();
    expect(
      await fixture.chat.treeAs(
        { orgId: anotherUser.orgId, userId: anotherUser.userId },
        chat.id,
      ),
    ).toBeNull();
    expect(await fixture.chat.selectWithoutTenant(chat.id)).toMatchObject({
      rows: [],
    });
  } finally {
    await fixture.close();
  }
});

test('only one live answer occupies the pointer and a title terminal transition cannot clear it', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const chat = await fixture.chat.create(0);
    const owner = fixture.tenants[0]!;
    const createRun = () =>
      fixture.database.withTenant(owner, (tx) =>
        new AiRunRepository().insert(tx, {
          id: randomUUID(),
          orgId: owner.orgId,
          initiatingUserId: owner.userId,
          profileId: 'test-profile',
          profileVersion: 1,
          resolvedConfig: { resourceIds: [] },
          modelId: 'synthetic/test',
          inputText: 'synthetic',
          inputBudgetTokens: 100,
          outputBudgetTokens: 100,
        }),
      );
    const answer = await createRun();
    await fixture.chat.linkAnswer(0, chat.id, answer.id);
    const secondAnswer = await createRun();
    await expect(
      fixture.chat.linkAnswer(0, chat.id, secondAnswer.id),
    ).rejects.toThrow();
    const title = await createRun();
    await fixture.chat.linkTitle(0, chat.id, title.id);
    expect(await fixture.inspect.chat(chat.id)).toMatchObject({
      active_answer_run_id: answer.id,
    });
    expect(await fixture.chat.transitionStatus(0, title.id)).toBe(true);
    expect(await fixture.inspect.chat(chat.id)).toMatchObject({
      active_answer_run_id: answer.id,
    });
    expect(await fixture.chat.transitionStatus(0, answer.id)).toBe(true);
    expect(await fixture.inspect.chat(chat.id)).toMatchObject({
      active_answer_run_id: null,
    });
    expect(await fixture.inspect.messageColumns()).not.toContain(
      'assistant_text',
    );
  } finally {
    await fixture.close();
  }
});

test('chat message parents and viewed leaves cannot cross chat boundaries', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const first = await fixture.chat.create(0);
    const second = await fixture.chat.create(0);
    const rootId = randomUUID();
    await fixture.chat.insertUser(0, {
      chatId: first.id,
      messageId: rootId,
      parentMessageId: null,
      text: 'First root',
      effort: 'high',
    });
    await expect(
      fixture.chat.insertUser(0, {
        chatId: second.id,
        messageId: randomUUID(),
        parentMessageId: rootId,
        text: 'Cross-chat child',
        effort: 'high',
      }),
    ).rejects.toThrow();
    expect(await fixture.chat.selectLeaf(0, second.id, rootId)).toBe(false);
    await expect(
      fixture.chat.insertUser(0, {
        chatId: first.id,
        messageId: randomUUID(),
        parentMessageId: rootId,
        text: 'Same-role child',
        effort: 'high',
      }),
    ).rejects.toThrow();
    await expect(
      fixture.chat.insertUser(0, {
        chatId: first.id,
        messageId: randomUUID(),
        parentMessageId: randomUUID(),
        text: 'Missing parent',
        effort: 'high',
      }),
    ).rejects.toThrow();
  } finally {
    await fixture.close();
  }
});

test('strict live-row SELECT RLS blocks a direct hidden-state update', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const chat = await fixture.chat.create(0);
    const directUpdate = fixture.chat.directHiddenUpdate(0, chat.id);
    await expect(directUpdate).rejects.toMatchObject({ code: '42501' });
    expect(await fixture.inspect.chat(chat.id)).toMatchObject({
      deleted_at: null,
    });
  } finally {
    await fixture.close();
  }
});

test('chat deletion marker primitive rejects missing, cross-owner, and cross-org contexts', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  const repository = new ChatRepository();
  try {
    const chat = await fixture.chat.create(0);
    const owner = fixture.tenants[0]!;
    const other = fixture.tenants[1]!;
    const sameOrgOtherOwner = await fixture.database.withTenant(
      { orgId: owner.orgId, userId: other.userId },
      (tx) => repository.markDeleted(tx, chat.id),
    );
    expect(sameOrgOtherOwner).toBe(false);
    expect(await fixture.chat.delete(1, chat.id)).toBe(false);
    const unscoped = await fixture.chat.markerWithoutTenant(
      owner.orgId,
      owner.userId,
      chat.id,
    );
    expect(unscoped.rows[0]?.deleted).toBe(false);
    expect(await fixture.inspect.chat(chat.id)).toMatchObject({
      deleted_at: null,
    });
    expect(await fixture.inspect.outbox(chat.id)).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('chat deletion marker function is executable only by the tenant application role', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    expect(await fixture.inspect.markerGrants()).toEqual({
      app_can_execute: true,
      auth_can_execute: false,
      public_can_execute: false,
    });
  } finally {
    await fixture.close();
  }
});
