import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';

// F4.4 hardening (spec §5 item 3, B-01): every chat mutation route must treat a
// same-org peer and an other-org member exactly like a random chat id — the
// identical 404 — and must leave zero side effects behind.

interface AttackIds {
  readonly chatId: string;
  readonly messageId: string;
}

interface AttackRoute {
  readonly name: string;
  // Which real message the route targets: 'user' turn or 'assistant' answer.
  readonly message: 'user' | 'assistant';
  readonly call: (
    origin: string,
    headers: Record<string, string>,
    ids: AttackIds,
  ) => ReturnType<typeof fetch>;
}

const jsonHeaders = (headers: Record<string, string>) => ({
  ...headers,
  'content-type': 'application/json',
});

const routes: readonly AttackRoute[] = [
  {
    name: 'POST /api/chats/:chatId/messages',
    message: 'assistant',
    call: (origin, headers, ids) =>
      fetch(`${origin}/api/chats/${ids.chatId}/messages`, {
        method: 'POST',
        headers: jsonHeaders(headers),
        body: JSON.stringify({
          userMessageId: randomUUID(),
          parentMessageId: ids.messageId,
          text: 'cross-actor send probe',
          effort: 'high',
        }),
      }),
  },
  {
    name: 'POST /api/chats/:chatId/messages/:messageId/edit',
    message: 'user',
    call: (origin, headers, ids) =>
      fetch(
        `${origin}/api/chats/${ids.chatId}/messages/${ids.messageId}/edit`,
        {
          method: 'POST',
          headers: jsonHeaders(headers),
          body: JSON.stringify({
            messageId: ids.messageId,
            newMessageId: randomUUID(),
            text: 'cross-actor edit probe',
            effort: 'high',
          }),
        },
      ),
  },
  {
    name: 'POST /api/chats/:chatId/messages/:messageId/regenerate',
    message: 'assistant',
    call: (origin, headers, ids) =>
      fetch(
        `${origin}/api/chats/${ids.chatId}/messages/${ids.messageId}/regenerate`,
        {
          method: 'POST',
          headers: jsonHeaders(headers),
          body: JSON.stringify({
            messageId: ids.messageId,
            requestId: randomUUID(),
          }),
        },
      ),
  },
  {
    name: 'PUT /api/chats/:chatId/viewed-leaf',
    message: 'assistant',
    call: (origin, headers, ids) =>
      fetch(`${origin}/api/chats/${ids.chatId}/viewed-leaf`, {
        method: 'PUT',
        headers: jsonHeaders(headers),
        body: JSON.stringify({ leafId: ids.messageId }),
      }),
  },
  {
    name: 'POST /api/chats/:chatId/search-match/:messageId',
    message: 'user',
    call: (origin, headers, ids) =>
      fetch(`${origin}/api/chats/${ids.chatId}/search-match/${ids.messageId}`, {
        method: 'POST',
        headers,
      }),
  },
  {
    name: 'DELETE /api/chats/:chatId',
    message: 'user',
    call: (origin, headers, ids) =>
      fetch(`${origin}/api/chats/${ids.chatId}`, {
        method: 'DELETE',
        headers,
      }),
  },
];

const actors = ['same-org peer', 'other-org member'] as const;

interface Captured {
  readonly status: number;
  readonly error: unknown;
}

async function capture(response: Response): Promise<Captured> {
  const text = await response.text();
  // requestId is a per-request correlation id; only the safe error payload
  // must be identical between a foreign id and a random id.
  const parsed = text ? (JSON.parse(text) as { error?: unknown }) : null;
  return { status: response.status, error: parsed?.error ?? null };
}

for (const route of routes) {
  for (const actorKind of actors) {
    test(`${route.name} returns the identical random-id 404 to a ${actorKind} and leaves zero side effects`, async ({
      services,
    }) => {
      // The file signs up a fresh owner + actor per case; lift the shared
      // per-IP signup/signin/verification-resend windows so case isolation
      // stays affordable.
      const environment = createAuthEnvironment(
        services,
        '/tmp/lexon-chat-cross-actor-health.json',
      );
      environment.AUTH_RATE_RULES_JSON = JSON.stringify({
        signup: { account: 3, ip: 10_000, windowSeconds: 600 },
        signin: { account: 5, ip: 10_000, windowSeconds: 60 },
        'verification-resend': {
          account: 3,
          ip: 10_000,
          windowSeconds: 600,
        },
      });
      const app = await createTestApi(loadRuntimeConfig('api', environment));
      const organizations = createOrganizationInspector({
        migratorUrl: services.migratorUrl,
      });
      const fixture = await createChatFixture(services);
      try {
        await app.listen(0, '127.0.0.1');
        const origin = await app.getUrl();
        const owner = await apiHeaders(app);
        const attacker = await apiHeaders(app);
        if (actorKind === 'same-org peer') {
          const ownerId = (
            (await (
              await fetch(`${origin}/api/identity`, { headers: owner })
            ).json()) as { user: { id: string } }
          ).user.id;
          const attackerId = (
            (await (
              await fetch(`${origin}/api/identity`, { headers: attacker })
            ).json()) as { user: { id: string } }
          ).user.id;
          const team = await organizations.seedTeam([ownerId, attackerId]);
          for (const headers of [owner, attacker]) {
            const switched = await fetch(`${origin}/api/organizations/active`, {
              method: 'POST',
              headers: { ...headers, 'content-type': 'application/json' },
              body: JSON.stringify({ organizationId: team.id }),
            });
            expect(switched.status).toBe(200);
          }
        }
        const input = {
          chatId: randomUUID(),
          userMessageId: randomUUID(),
          requestId: randomUUID(),
          text: `cross-actor target ${randomUUID()}`,
          effort: 'high',
        };
        const created = await fetch(`${origin}/api/chats`, {
          method: 'POST',
          headers: { ...owner, 'content-type': 'application/json' },
          body: JSON.stringify(input),
        });
        expect(created.status).toBe(201);
        const createdBody = (await created.json()) as {
          assistantMessageId: string;
        };
        expect(createdBody.assistantMessageId).toBeTruthy();
        const realIds: AttackIds = {
          chatId: input.chatId,
          messageId:
            route.message === 'user'
              ? input.userMessageId
              : createdBody.assistantMessageId,
        };
        const ownerTree = () =>
          fetch(`${origin}/api/chats/${input.chatId}`, { headers: owner });
        const beforeRead = await ownerTree();
        expect(beforeRead.status).toBe(200);
        const treeBefore = await beforeRead.json();
        const snapshot = async () => {
          const counts = await fixture.inspect.query(
            `SELECT (SELECT count(*)::int FROM app.ai_runs) AS ai_runs,
                    (SELECT count(*)::int FROM ops.outbox) AS outbox`,
          );
          const row = counts.rows[0] as { ai_runs: number; outbox: number };
          const chat = await fixture.inspect.chat(input.chatId);
          return {
            aiRuns: row.ai_runs,
            outbox: row.outbox,
            viewedLeafId: chat?.viewed_leaf_id ?? null,
            deletedAt: chat?.deleted_at ?? null,
          };
        };
        const before = await snapshot();
        const baseline = await capture(
          await route.call(origin, attacker, {
            chatId: randomUUID(),
            messageId: randomUUID(),
          }),
        );
        const attackResult = await capture(
          await route.call(origin, attacker, realIds),
        );
        expect(baseline.status).toBe(404);
        expect(attackResult).toEqual(baseline);
        expect(await snapshot()).toEqual(before);
        const afterRead = await ownerTree();
        expect(afterRead.status).toBe(200);
        expect(await afterRead.json()).toEqual(treeBefore);
      } finally {
        await app.close();
        await organizations.close();
        await fixture.close();
      }
    });
  }
}
