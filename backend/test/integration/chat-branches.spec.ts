import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { ChatTreeSchema } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import type { FileServices } from '../setup/provided-context.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import {
  AiRunRepository,
  ChatMessageRepository,
  ChatMutationRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';

test('a send retry keeps its original answer identity after that answer is regenerated', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-branches-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const chatId = randomUUID();
    const rootUserId = randomUUID();
    const first = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: rootUserId,
        requestId: randomUUID(),
        text: 'Root question',
        effort: 'max',
      }),
    });
    expect(first.status).toBe(201);
    const firstMutation = (await first.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    const activeBaseline = await fixture.inspect.chatSendSnapshot(chatId);
    const activeEdit = await fetch(
      `${origin}/api/chats/${chatId}/messages/${rootUserId}/edit`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: rootUserId,
          newMessageId: randomUUID(),
          text: 'Must not edit while the answer is active',
          effort: 'high',
        }),
      },
    );
    expect(activeEdit.status).toBe(409);
    const activeRegenerate = await fetch(
      `${origin}/api/chats/${chatId}/messages/${firstMutation.assistantMessageId}/regenerate`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: firstMutation.assistantMessageId,
          requestId: randomUUID(),
        }),
      },
    );
    expect(activeRegenerate.status).toBe(409);
    expect(await fixture.inspect.chatSendSnapshot(chatId)).toEqual(
      activeBaseline,
    );
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string }; organization: { id: string } };
    const tenant = {
      orgId: identity.organization.id,
      userId: identity.user.id,
    };
    const runs = new AiRunRepository();
    const database = app.get(TenantDatabase);
    const complete = (runId: string) =>
      database.withTenant(tenant, (tx) =>
        runs.transition(tx, {
          runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'completed',
        }),
      );
    expect(await complete(firstMutation.runId)).toBe(true);

    const foreignChatId = randomUUID();
    const foreignUserId = randomUUID();
    const foreignCreate = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: foreignChatId,
        userMessageId: foreignUserId,
        requestId: randomUUID(),
        text: 'Another chat root',
        effort: 'high',
      }),
    });
    expect(foreignCreate.status).toBe(201);
    const foreignMutation = (await foreignCreate.json()) as { runId: string };
    expect(await complete(foreignMutation.runId)).toBe(true);
    const wrongChatEdit = await fetch(
      `${origin}/api/chats/${chatId}/messages/${foreignUserId}/edit`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: foreignUserId,
          newMessageId: randomUUID(),
          text: 'Cross-chat edit attempt',
          effort: 'max',
        }),
      },
    );
    expect(wrongChatEdit.status).toBe(409);
    const wrongRoleEdit = await fetch(
      `${origin}/api/chats/${chatId}/messages/${firstMutation.assistantMessageId}/edit`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: firstMutation.assistantMessageId,
          newMessageId: randomUUID(),
          text: 'Assistant edit attempt',
          effort: 'max',
        }),
      },
    );
    expect(wrongRoleEdit.status).toBe(409);
    expect(await fixture.inspect.chatSendSnapshot(chatId)).toMatchObject({
      messages: '2',
      answers: '1',
      runs: '1',
      start_outbox: '1',
      start_audit: '1',
      slots: '0',
    });
    const refusedMutationAudits = await fixture.inspect.query(
      `SELECT type,metadata FROM ops.audit_events
       WHERE type IN ('chat.message_edited.v1','chat.message_regenerated.v1')
         AND metadata->>'chatId'=$1`,
      [chatId],
    );
    expect(refusedMutationAudits.rows).toEqual([]);

    const sentInput = {
      userMessageId: randomUUID(),
      parentMessageId: firstMutation.assistantMessageId,
      text: 'Follow-up question',
      effort: 'high',
    };
    const send = () =>
      fetch(`${origin}/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(sentInput),
      });
    const firstSend = await send();
    expect(firstSend.status).toBe(201);
    const originalResult = (await firstSend.json()) as {
      userMessageId: string;
      assistantMessageId: string;
      runId: string;
    };
    expect(await complete(originalResult.runId)).toBe(true);

    const regenerateRequestId = randomUUID();
    const regenerate = () =>
      fetch(
        `${origin}/api/chats/${chatId}/messages/${originalResult.assistantMessageId}/regenerate`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            messageId: originalResult.assistantMessageId,
            requestId: regenerateRequestId,
          }),
        },
      );
    const [regenerateOne, regenerateTwo] = await Promise.all([
      regenerate(),
      regenerate(),
    ]);
    expect([regenerateOne.status, regenerateTwo.status]).toEqual([201, 201]);
    const regenerated = (await regenerateOne.json()) as {
      userMessageId: string;
      assistantMessageId: string;
      runId: string;
    };
    expect(await regenerateTwo.json()).toEqual(regenerated);
    expect(regenerated.userMessageId).toBe(originalResult.userMessageId);
    expect(regenerated.assistantMessageId).not.toBe(
      originalResult.assistantMessageId,
    );
    expect(await complete(regenerated.runId)).toBe(true);
    const regeneratedRun = await database.withTenant(tenant, (tx) =>
      new AiRunRepository().find(tx, regenerated.runId),
    );
    expect(regeneratedRun?.resolvedConfig).toMatchObject({
      resolvedEffort: 'high',
    });
    const regenerateAudits = await fixture.inspect.query(
      `SELECT type,metadata FROM ops.audit_events
       WHERE type='chat.message_regenerated.v1' AND metadata->>'chatId'=$1`,
      [chatId],
    );
    expect(regenerateAudits.rows).toEqual([
      {
        type: 'chat.message_regenerated.v1',
        metadata: { chatId, messageId: regenerated.assistantMessageId },
      },
    ]);

    const retry = await send();
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(originalResult);
    const treeResponse = await fetch(`${origin}/api/chats/${chatId}`, {
      headers,
    });
    const tree = ChatTreeSchema.parse(await treeResponse.json());
    expect(
      tree.messages.filter(
        (message) =>
          message.role === 'assistant' &&
          message.parentId === originalResult.userMessageId,
      ),
    ).toHaveLength(2);
    expect(await fixture.inspect.chatSendSnapshot(chatId)).toMatchObject({
      messages: '5',
      answers: '3',
      runs: '3',
    });
    expect(await fixture.inspect.mutationRequestPrivileges()).toEqual({
      rls_enabled: true,
      rls_forced: true,
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
      can_truncate: false,
    });
    expect(await fixture.inspect.mutationRequestRuntimeDenials(tenant)).toEqual(
      ['42501', '42501', '42501'],
    );
    const foreignTenant = fixture.tenants.find(
      (candidate) => candidate.userId !== tenant.userId,
    )!;
    const foreignReceipt = await database.withTenant(foreignTenant, (tx) =>
      new ChatMutationRepository().findByRequestIdentity(tx, {
        chatId,
        kind: 'regenerate',
        requestId: regenerateRequestId,
      }),
    );
    expect(foreignReceipt).toBeNull();

    const editedUserId = randomUUID();
    const editInput = {
      messageId: originalResult.userMessageId,
      newMessageId: editedUserId,
      text: 'Edited nonroot follow-up',
      effort: 'max',
    };
    const editRequest = () =>
      fetch(
        `${origin}/api/chats/${chatId}/messages/${originalResult.userMessageId}/edit`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(editInput),
        },
      );
    const [editOne, editTwo] = await Promise.all([
      editRequest(),
      editRequest(),
    ]);
    expect([editOne.status, editTwo.status]).toEqual([201, 201]);
    const editResult = await editOne.json();
    expect(await editTwo.json()).toEqual(editResult);
    const editAudits = await fixture.inspect.query(
      `SELECT type,metadata FROM ops.audit_events
       WHERE type='chat.message_edited.v1' AND metadata->>'chatId'=$1`,
      [chatId],
    );
    expect(editAudits.rows).toEqual([
      {
        type: 'chat.message_edited.v1',
        metadata: { chatId, messageId: editedUserId },
      },
    ]);
    expect(
      JSON.stringify([...regenerateAudits.rows, ...editAudits.rows]),
    ).not.toContain('Edited nonroot follow-up');
    const editedTree = ChatTreeSchema.parse(
      await (await fetch(`${origin}/api/chats/${chatId}`, { headers })).json(),
    );
    expect(editedTree.messages).toHaveLength(7);
    expect(
      editedTree.messages.find(
        (message) => message.id === originalResult.userMessageId,
      ),
    ).toMatchObject({
      role: 'user',
      parentId: firstMutation.assistantMessageId,
      text: 'Follow-up question',
      effort: 'high',
    });
    expect(
      editedTree.messages.find((message) => message.id === editedUserId),
    ).toMatchObject({
      role: 'user',
      parentId: firstMutation.assistantMessageId,
      text: 'Edited nonroot follow-up',
      effort: 'max',
    });
    const contextBefore = await database.withTenant(tenant, (tx) =>
      new ChatMessageRepository().historyForRun(tx, editResult.runId),
    );
    const selectLeaf = (leafId: string) =>
      fetch(`${origin}/api/chats/${chatId}/viewed-leaf`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ leafId }),
      });
    expect((await selectLeaf(firstMutation.assistantMessageId)).status).toBe(
      409,
    );
    expect((await selectLeaf(originalResult.assistantMessageId)).status).toBe(
      200,
    );
    expect((await selectLeaf(regenerated.assistantMessageId)).status).toBe(200);
    const selectedTree = ChatTreeSchema.parse(
      await (await fetch(`${origin}/api/chats/${chatId}`, { headers })).json(),
    );
    expect(selectedTree.viewedLeafId).toBe(regenerated.assistantMessageId);
    const contextAfter = await database.withTenant(tenant, (tx) =>
      new ChatMessageRepository().historyForRun(tx, editResult.runId),
    );
    expect(contextAfter).toEqual(contextBefore);
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('editing a user message creates a new root sibling and leaves its source unchanged', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-branches-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const chatId = randomUUID();
    const originalUserId = randomUUID();
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: originalUserId,
        requestId: randomUUID(),
        text: 'Original root question',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const original = (await created.json()) as { runId: string };
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string }; organization: { id: string } };
    await app
      .get(TenantDatabase)
      .withTenant(
        { orgId: identity.organization.id, userId: identity.user.id },
        (tx) =>
          new AiRunRepository().transition(tx, {
            runId: original.runId,
            expectedVersion: 1,
            from: 'queued',
            to: 'completed',
          }),
      );

    const newUserId = randomUUID();
    const edit = await fetch(
      `${origin}/api/chats/${chatId}/messages/${originalUserId}/edit`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: originalUserId,
          newMessageId: newUserId,
          text: 'Edited root question',
          effort: 'max',
        }),
      },
    );
    expect(edit.status).toBe(201);
    const result = (await edit.json()) as {
      userMessageId: string;
      assistantMessageId: string;
      runId: string;
    };
    expect(result.userMessageId).toBe(newUserId);
    expect(result.assistantMessageId).toBe(result.runId);

    const treeResponse = await fetch(`${origin}/api/chats/${chatId}`, {
      headers,
    });
    expect(treeResponse.status).toBe(200);
    const tree = ChatTreeSchema.parse(await treeResponse.json());
    expect(tree.messages).toHaveLength(4);
    expect(
      tree.messages.find((message) => message.id === originalUserId),
    ).toMatchObject({
      role: 'user',
      parentId: null,
      text: 'Original root question',
      effort: 'high',
    });
    expect(
      tree.messages.find((message) => message.id === newUserId),
    ).toMatchObject({
      role: 'user',
      parentId: null,
      text: 'Edited root question',
      effort: 'max',
    });
    expect(
      tree.messages.find((message) => message.id === result.assistantMessageId),
    ).toMatchObject({
      role: 'assistant',
      parentId: newUserId,
      runId: result.runId,
    });
    await app
      .get(TenantDatabase)
      .withTenant(
        { orgId: identity.organization.id, userId: identity.user.id },
        (tx) =>
          new AiRunRepository().transition(tx, {
            runId: result.runId,
            expectedVersion: 1,
            from: 'queued',
            to: 'completed',
          }),
      );
    expect(
      await fixture.chat.deleteFor(
        { orgId: identity.organization.id, userId: identity.user.id },
        chatId,
      ),
    ).toBe(true);
    expect(
      (await fetch(`${origin}/api/chats/${chatId}`, { headers })).status,
    ).toBe(404);

    const replacementChatId = randomUUID();
    const replacementUserId = randomUUID();
    const replacement = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: replacementChatId,
        userMessageId: replacementUserId,
        requestId: randomUUID(),
        text: 'Replacement chat',
        effort: 'high',
      }),
    });
    expect(replacement.status).toBe(201);
    const replacementResult = (await replacement.json()) as { runId: string };
    await app
      .get(TenantDatabase)
      .withTenant(
        { orgId: identity.organization.id, userId: identity.user.id },
        (tx) =>
          new AiRunRepository().transition(tx, {
            runId: replacementResult.runId,
            expectedVersion: 1,
            from: 'queued',
            to: 'completed',
          }),
      );
    const replacementBaseline =
      await fixture.inspect.chatSendSnapshot(replacementChatId);
    const reusedDeletedIdentity = await fetch(
      `${origin}/api/chats/${replacementChatId}/messages/${replacementUserId}/edit`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: replacementUserId,
          newMessageId: newUserId,
          text: 'Must not reuse deleted request identity',
          effort: 'max',
        }),
      },
    );
    expect(reusedDeletedIdentity.status).toBe(409);
    expect(await fixture.inspect.chatSendSnapshot(replacementChatId)).toEqual(
      replacementBaseline,
    );
    expect(
      ChatTreeSchema.parse(
        await (
          await fetch(`${origin}/api/chats/${replacementChatId}`, { headers })
        ).json(),
      ).messages,
    ).toHaveLength(2);
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('unexpected outbox uniqueness failures remain server errors and roll back an edit', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-branches-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  let removeConstraint: (() => Promise<void>) | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const chatId = randomUUID();
    const sourceUserId = randomUUID();
    const text = `unique-run-prompt-${randomUUID()}`;
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId: sourceUserId,
        requestId: randomUUID(),
        text,
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as { runId: string };
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string }; organization: { id: string } };
    const tenant = {
      orgId: identity.organization.id,
      userId: identity.user.id,
    };
    expect(
      await app.get(TenantDatabase).withTenant(tenant, (tx) =>
        new AiRunRepository().transition(tx, {
          runId: mutation.runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'completed',
        }),
      ),
    ).toBe(true);
    const before = await fixture.inspect.chatSendSnapshot(chatId);
    removeConstraint =
      await fixture.inspect.installUnexpectedOutboxUniqueViolation();

    const edit = await fetch(
      `${origin}/api/chats/${chatId}/messages/${sourceUserId}/edit`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: sourceUserId,
          newMessageId: randomUUID(),
          text,
          effort: 'max',
        }),
      },
    );
    expect(edit.status).toBe(500);
    expect(await edit.text()).not.toContain('task9_unexpected_outbox_unique');
    expect(await fixture.inspect.chatSendSnapshot(chatId)).toEqual(before);
  } finally {
    await removeConstraint?.();
    await app.close();
    await fixture.close();
  }
});

test('a repeated accepted edit appends exactly one IDs-only mutation audit', async ({
  services,
}) => {
  const context = await createCompletedRoot(services);
  try {
    const newMessageId = randomUUID();
    const edit = () =>
      fetch(
        `${context.origin}/api/chats/${context.chatId}/messages/${context.userMessageId}/edit`,
        {
          method: 'POST',
          headers: { ...context.headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            messageId: context.userMessageId,
            newMessageId,
            text: 'Private edited prompt',
            effort: 'max',
          }),
        },
      );
    const first = await edit();
    expect(first.status).toBe(201);
    const firstResult = await first.json();
    const replay = await edit();
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstResult);
    const rows = await context.fixture.inspect.query(
      `SELECT type,metadata FROM ops.audit_events
       WHERE type='chat.message_edited.v1' AND metadata->>'chatId'=$1`,
      [context.chatId],
    );
    expect(rows.rows).toEqual([
      {
        type: 'chat.message_edited.v1',
        metadata: { chatId: context.chatId, messageId: newMessageId },
      },
    ]);
    expect(JSON.stringify(rows.rows)).not.toContain('Private edited prompt');
  } finally {
    await context.close();
  }
});

test('an edit audit append failure rolls the branch mutation back', async ({
  services,
}) => {
  const context = await createCompletedRoot(services);
  const originalAppend = AuditService.prototype.append;
  const failEditAudit = vi
    .spyOn(AuditService.prototype, 'append')
    .mockImplementation(async function (this: AuditService, tx, event) {
      if (String(event.type) === 'chat.message_edited.v1')
        throw new Error('injected edit audit failure');
      await originalAppend.call(this, tx, event);
    });
  try {
    const before = await context.fixture.inspect.chatSendSnapshot(
      context.chatId,
    );
    const response = await fetch(
      `${context.origin}/api/chats/${context.chatId}/messages/${context.userMessageId}/edit`,
      {
        method: 'POST',
        headers: { ...context.headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: context.userMessageId,
          newMessageId: randomUUID(),
          text: 'Rollback edit text',
          effort: 'max',
        }),
      },
    );
    expect(response.status).toBe(500);
    expect(
      await context.fixture.inspect.chatSendSnapshot(context.chatId),
    ).toEqual(before);
    expect(
      (
        await context.fixture.inspect.query(
          `SELECT event_id FROM ops.audit_events
           WHERE type='chat.message_edited.v1' AND metadata->>'chatId'=$1`,
          [context.chatId],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    failEditAudit.mockRestore();
    await context.close();
  }
});

test('a repeated accepted regeneration appends exactly one IDs-only mutation audit', async ({
  services,
}) => {
  const context = await createCompletedRoot(services);
  try {
    const requestId = randomUUID();
    const regenerate = () =>
      fetch(
        `${context.origin}/api/chats/${context.chatId}/messages/${context.assistantMessageId}/regenerate`,
        {
          method: 'POST',
          headers: { ...context.headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            messageId: context.assistantMessageId,
            requestId,
          }),
        },
      );
    const first = await regenerate();
    expect(first.status).toBe(201);
    const firstResult = await first.json();
    const replay = await regenerate();
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstResult);
    const result = firstResult as { assistantMessageId: string };
    const rows = await context.fixture.inspect.query(
      `SELECT type,metadata FROM ops.audit_events
       WHERE type='chat.message_regenerated.v1' AND metadata->>'chatId'=$1`,
      [context.chatId],
    );
    expect(rows.rows).toEqual([
      {
        type: 'chat.message_regenerated.v1',
        metadata: {
          chatId: context.chatId,
          messageId: result.assistantMessageId,
        },
      },
    ]);
    expect(JSON.stringify(rows.rows)).not.toContain('Root question');
  } finally {
    await context.close();
  }
});

test('a regeneration audit append failure rolls the branch mutation back', async ({
  services,
}) => {
  const context = await createCompletedRoot(services);
  const originalAppend = AuditService.prototype.append;
  const failRegenerateAudit = vi
    .spyOn(AuditService.prototype, 'append')
    .mockImplementation(async function (this: AuditService, tx, event) {
      if (String(event.type) === 'chat.message_regenerated.v1')
        throw new Error('injected regenerate audit failure');
      await originalAppend.call(this, tx, event);
    });
  try {
    const before = await context.fixture.inspect.chatSendSnapshot(
      context.chatId,
    );
    const response = await fetch(
      `${context.origin}/api/chats/${context.chatId}/messages/${context.assistantMessageId}/regenerate`,
      {
        method: 'POST',
        headers: { ...context.headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: context.assistantMessageId,
          requestId: randomUUID(),
        }),
      },
    );
    expect(response.status).toBe(500);
    expect(
      await context.fixture.inspect.chatSendSnapshot(context.chatId),
    ).toEqual(before);
    expect(
      (
        await context.fixture.inspect.query(
          `SELECT event_id FROM ops.audit_events
           WHERE type='chat.message_regenerated.v1' AND metadata->>'chatId'=$1`,
          [context.chatId],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    failRegenerateAudit.mockRestore();
    await context.close();
  }
});

async function createCompletedRoot(services: FileServices) {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-mutation-audit-health.json',
      ),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const created = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId,
        userMessageId,
        requestId: randomUUID(),
        text: 'Root question',
        effort: 'high',
      }),
    });
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string }; organization: { id: string } };
    expect(
      await app
        .get(TenantDatabase)
        .withTenant(
          { orgId: identity.organization.id, userId: identity.user.id },
          (tx) =>
            new AiRunRepository().transition(tx, {
              runId: mutation.runId,
              expectedVersion: 1,
              from: 'queued',
              to: 'completed',
            }),
        ),
    ).toBe(true);
    return {
      app,
      fixture,
      origin,
      headers,
      chatId,
      userMessageId,
      assistantMessageId: mutation.assistantMessageId,
      async close() {
        await app.close();
        await fixture.close();
      },
    };
  } catch (error) {
    await app.close();
    await fixture.close();
    throw error;
  }
}
