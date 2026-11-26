import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  chatShare,
  createProjectScenario,
  projectDeny,
} from '../../src/infrastructure/db/testing/project-fixture.js';
import { TenantDatabase } from '../../src/infrastructure/db/index.js';
import {
  AiRunRepository,
  ChatRepository,
} from '../../src/infrastructure/db/index.js';
import { CancelSignals } from '../../src/infrastructure/queue/cancel-signals.js';

// F6 fix-batch issue 1: chat-scoped notification fan-out must resolve the
// audience once per notification (ops.lexon_chat_notification_audience)
// rather than running a tenant transaction per connected user, and must
// deliver only to connections whose user still passes the live predicate.
// Access-change notifications carry userIds and reach exactly those users.

const POLL_MS = 75;
const TIMEOUT_MS = 10_000;

interface Collected {
  events: Array<{ orgId: string; chatId: string | null }>;
  unavailable: number;
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

test('chat notification resolves the audience once and skips denied, removed and non-member connections', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const scenario = await createProjectScenario({
    app: pools.app,
    migrator: pools.migrator,
  });
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 4,
    statementTimeoutMs: 10000,
  });
  const withTenantSpy = vi.spyOn(database, 'withTenant');
  const signals = new CancelSignals({
    url: services.valkey.queueUrl,
    prefix: `test-audience-${randomUUID().slice(0, 8)}`,
    databaseUrl: services.appUrl,
    database,
    runs: new AiRunRepository(),
  });
  const collected = new Map<string, Collected>();
  const listeners: string[] = [
    scenario.users.owner,
    scenario.users.editor,
    scenario.users.viewer,
    scenario.users.member,
    scenario.users.admin,
    scenario.users.outsider,
  ];
  try {
    for (const userId of listeners) {
      const bucket: Collected = { events: [], unavailable: 0 };
      collected.set(userId, bucket);
      await signals.subscribeChatTitleInvalidations(
        { orgId: scenario.orgId, userId },
        (notification) => bucket.events.push(notification),
        () => bucket.unavailable++,
      );
    }
    // Outsider subscribes with the scenario org on purpose — neither the
    // org match nor the audience lookup may admit them.

    // Seeded roles: project audience = owner + editor + viewer.
    await pools.migrator.query("SELECT pg_notify('lexon_chat_title', $1)", [
      JSON.stringify({
        orgId: scenario.orgId,
        chatId: scenario.projectChatId,
      }),
    ]);

    await waitFor(
      () =>
        collected.get(scenario.users.owner)!.events.length >= 1 &&
        collected.get(scenario.users.editor)!.events.length >= 1 &&
        collected.get(scenario.users.viewer)!.events.length >= 1,
      'audience members received the chat invalidation',
    );
    // Give excluded listeners a beat beyond the delivery to catch leaks.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(collected.get(scenario.users.member)!.events).toEqual([]);
    expect(collected.get(scenario.users.admin)!.events).toEqual([]);
    expect(collected.get(scenario.users.outsider)!.events).toEqual([]);

    // Exactly one tenant transaction resolved the audience for the whole
    // notification — not one per connected listener.
    expect(withTenantSpy.mock.calls.length).toBe(1);
  } finally {
    await signals.close();
    await pools.close();
    await database.close();
  }
});

test('a denied or project-removed connection receives nothing after the live predicate changes', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const scenario = await createProjectScenario({
    app: pools.app,
    migrator: pools.migrator,
  });
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 4,
    statementTimeoutMs: 10000,
  });
  const signals = new CancelSignals({
    url: services.valkey.queueUrl,
    prefix: `test-audience-${randomUUID().slice(0, 8)}`,
    databaseUrl: services.appUrl,
    database,
    runs: new AiRunRepository(),
  });
  const collected = new Map<string, Collected>();
  try {
    for (const userId of [
      scenario.users.owner,
      scenario.users.editor,
      scenario.users.viewer,
    ]) {
      const bucket: Collected = { events: [], unavailable: 0 };
      collected.set(userId, bucket);
      await signals.subscribeChatTitleInvalidations(
        { orgId: scenario.orgId, userId },
        (notification) => bucket.events.push(notification),
        () => bucket.unavailable++,
      );
    }
    // Deny the viewer — the audience is evaluated at delivery time.
    await projectDeny(pools.migrator, {
      orgId: scenario.orgId,
      projectId: scenario.projectId,
      userId: scenario.users.viewer,
      setByUserId: scenario.users.owner,
    });
    await pools.migrator.query("SELECT pg_notify('lexon_chat_title', $1)", [
      JSON.stringify({
        orgId: scenario.orgId,
        chatId: scenario.projectChatId,
      }),
    ]);
    await waitFor(
      () =>
        collected.get(scenario.users.owner)!.events.length >= 1 &&
        collected.get(scenario.users.editor)!.events.length >= 1,
      'remaining audience received the chat invalidation',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(collected.get(scenario.users.viewer)!.events).toEqual([]);
  } finally {
    await signals.close();
    await pools.close();
    await database.close();
  }
});

test('standalone chats notify owner plus share recipients only', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const scenario = await createProjectScenario({
    app: pools.app,
    migrator: pools.migrator,
  });
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 4,
    statementTimeoutMs: 10000,
  });
  const signals = new CancelSignals({
    url: services.valkey.queueUrl,
    prefix: `test-audience-${randomUUID().slice(0, 8)}`,
    databaseUrl: services.appUrl,
    database,
    runs: new AiRunRepository(),
  });
  const collected = new Map<string, Collected>();
  try {
    for (const userId of [
      scenario.users.owner,
      scenario.users.member,
      scenario.users.editor,
    ]) {
      const bucket: Collected = { events: [], unavailable: 0 };
      collected.set(userId, bucket);
      await signals.subscribeChatTitleInvalidations(
        { orgId: scenario.orgId, userId },
        (notification) => bucket.events.push(notification),
        () => bucket.unavailable++,
      );
    }
    await chatShare(pools.migrator, {
      orgId: scenario.orgId,
      chatId: scenario.standaloneChatId,
      userId: scenario.users.member,
      grantedByUserId: scenario.users.owner,
    });
    await pools.migrator.query("SELECT pg_notify('lexon_chat_title', $1)", [
      JSON.stringify({
        orgId: scenario.orgId,
        chatId: scenario.standaloneChatId,
      }),
    ]);
    await waitFor(
      () =>
        collected.get(scenario.users.owner)!.events.length >= 1 &&
        collected.get(scenario.users.member)!.events.length >= 1,
      'owner and share recipient received the invalidation',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(collected.get(scenario.users.editor)!.events).toEqual([]);
  } finally {
    await signals.close();
    await pools.close();
    await database.close();
  }
});

test('access-change notifications deliver a chatless refresh to exactly the listed users', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const scenario = await createProjectScenario({
    app: pools.app,
    migrator: pools.migrator,
  });
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 4,
    statementTimeoutMs: 10000,
  });
  const signals = new CancelSignals({
    url: services.valkey.queueUrl,
    prefix: `test-audience-${randomUUID().slice(0, 8)}`,
    databaseUrl: services.appUrl,
    database,
    runs: new AiRunRepository(),
  });
  const collected = new Map<string, Collected>();
  try {
    for (const userId of [
      scenario.users.owner,
      scenario.users.member,
      scenario.users.editor,
    ]) {
      const bucket: Collected = { events: [], unavailable: 0 };
      collected.set(userId, bucket);
      await signals.subscribeChatTitleInvalidations(
        { orgId: scenario.orgId, userId },
        (notification) => bucket.events.push(notification),
        () => bucket.unavailable++,
      );
    }
    // notifyAccessChanged is emitted inside the caller's transaction by the
    // mutation paths (deny/member/share writes); here the repository helper
    // produces the same wire payload.
    await database.withTenant(
      { orgId: scenario.orgId, userId: scenario.users.owner },
      (tx) =>
        new ChatRepository().notifyAccessChanged(tx, {
          chatId: null,
          userIds: [scenario.users.member],
        }),
    );
    await waitFor(
      () => collected.get(scenario.users.member)!.events.length >= 1,
      'listed user received the access-change refresh',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(collected.get(scenario.users.member)!.events).toEqual([
      { orgId: scenario.orgId, chatId: null },
    ]);
    expect(collected.get(scenario.users.owner)!.events).toEqual([]);
    expect(collected.get(scenario.users.editor)!.events).toEqual([]);
  } finally {
    await signals.close();
    await pools.close();
    await database.close();
  }
});
