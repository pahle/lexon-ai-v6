import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import {
  chatMutationSendReceiptRows,
  cloneDatabase,
  dropDatabase,
  reapplyChatMutation0032ForUpgradeTest,
  roleUrl,
} from '../../src/infrastructure/db/testing/provision.js';
import type { FileServices } from '../setup/provided-context.js';
import {
  AiRunRepository,
  ChatRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';

test('0032 backfills original sends across live and deleted chats in a populated upgrade', async ({
  services,
}) => {
  const id = randomBytes(12).toString('hex');
  const databaseName = `lexon_test_${id}`;
  const adminUrl = new URL(services.migratorUrl);
  adminUrl.username = 'postgres';
  adminUrl.pathname = '/postgres';
  const adminConnection = adminUrl.toString();
  const clonedServices: FileServices = {
    ...services,
    dbName: databaseName,
    appUrl: roleUrl(
      adminConnection,
      'lexon_app',
      decodeURIComponent(adminUrl.password),
      databaseName,
    ),
    authUrl: roleUrl(
      adminConnection,
      'lexon_auth',
      decodeURIComponent(adminUrl.password),
      databaseName,
    ),
    migratorUrl: roleUrl(
      adminConnection,
      'lexon_migrator',
      decodeURIComponent(adminUrl.password),
      databaseName,
    ),
    queuePrefix: `${services.queuePrefix}_${id}`,
  };
  await cloneDatabase(adminConnection, services.dbName, databaseName);
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        clonedServices,
        `/tmp/lexon-chat-mutation-migration-${id}.json`,
      ),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as { user: { id: string }; organization: { id: string } };
    const tenant = {
      orgId: identity.organization.id,
      userId: identity.user.id,
    };
    const database = app.get(TenantDatabase);
    const complete = (runId: string) =>
      database.withTenant(tenant, (tx) =>
        new AiRunRepository().transition(tx, {
          runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'completed',
        }),
      );

    const liveChatId = randomUUID();
    const rootUserId = randomUUID();
    const rootCreated = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: liveChatId,
        userMessageId: rootUserId,
        requestId: randomUUID(),
        text: 'Upgrade root question',
        effort: 'max',
      }),
    });
    expect(rootCreated.status).toBe(201);
    const rootResult = (await rootCreated.json()) as {
      userMessageId: string;
      assistantMessageId: string;
      runId: string;
    };
    expect(await complete(rootResult.runId)).toBe(true);

    const followupInput = {
      userMessageId: randomUUID(),
      parentMessageId: rootResult.assistantMessageId,
      text: 'Upgrade follow-up question',
      effort: 'high' as const,
    };
    const followup = await fetch(`${origin}/api/chats/${liveChatId}/messages`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(followupInput),
    });
    expect(followup.status).toBe(201);
    const originalFollowup = (await followup.json()) as {
      chatId: string;
      userMessageId: string;
      assistantMessageId: string;
      runId: string;
    };
    expect(await complete(originalFollowup.runId)).toBe(true);

    const deletedChatId = randomUUID();
    const deletedUserId = randomUUID();
    const deletedCreated = await fetch(`${origin}/api/chats`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: deletedChatId,
        userMessageId: deletedUserId,
        requestId: randomUUID(),
        text: 'Upgrade deleted chat question',
        effort: 'high',
      }),
    });
    expect(deletedCreated.status).toBe(201);
    const deletedResult = (await deletedCreated.json()) as { runId: string };
    expect(await complete(deletedResult.runId)).toBe(true);
    expect(
      await database.withTenant(tenant, (tx) =>
        new ChatRepository().markDeleted(tx, deletedChatId),
      ),
    ).toBe(true);
    await reapplyChatMutation0032ForUpgradeTest(clonedServices.migratorUrl);

    const backfilled = await chatMutationSendReceiptRows(
      clonedServices.migratorUrl,
      [rootUserId, followupInput.userMessageId, deletedUserId],
    );
    expect(backfilled).toHaveLength(3);
    expect(backfilled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          request_id: rootUserId,
          chat_id: liveChatId,
          user_message_id: rootUserId,
          assistant_message_id: rootResult.assistantMessageId,
        }),
        expect.objectContaining({
          request_id: followupInput.userMessageId,
          chat_id: liveChatId,
          user_message_id: followupInput.userMessageId,
          assistant_message_id: originalFollowup.assistantMessageId,
        }),
        expect.objectContaining({
          request_id: deletedUserId,
          chat_id: deletedChatId,
          user_message_id: deletedUserId,
          assistant_message_id: deletedResult.runId,
        }),
      ]),
    );

    const replay = await fetch(`${origin}/api/chats/${liveChatId}/messages`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(followupInput),
    });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(originalFollowup);
    const deletedReplay = await fetch(`${origin}/api/chats/${deletedChatId}`, {
      headers,
    });
    expect(deletedReplay.status).toBe(404);
  } finally {
    await app.close();
    await dropDatabase(adminConnection, databaseName);
  }
});
