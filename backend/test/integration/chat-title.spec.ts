import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createAiHarness } from '../setup/ai-harness.js';
import { ModelAllowlistSchema, type ModelGateway } from '../../src/infrastructure/ai/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { CHAT_PROFILES } from '../../src/modules/chat/chat-profiles.js';
import { ChatHistoryContextProvider } from '../../src/modules/chat/chat-history-context.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import { IdentitySummarySchema } from '@lexon/contracts';
import { requireSession } from '../../src/infrastructure/db/tenant-session.js';
import { ChatTitleService } from '../../src/modules/chat/chat-title.service.js';

function withActor<T>(
  tenant: { orgId: string; userId: string },
  authorization: RunAuthorizationService,
  work: (actor: ReturnType<typeof currentVerifiedIdentity>) => Promise<T>,
): Promise<T> {
  const request = {};
  const identities = new RequestIdentity();
  identities.prepare(
    request,
    {
      identity: {
        userId: tenant.userId,
        sessionId: randomUUID(),
        activeOrganizationId: tenant.orgId,
        channel: 'cookie',
        platformAdmin: false,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
      },
      tenant: { orgId: tenant.orgId, userId: tenant.userId, role: 'owner' },
      summary: IdentitySummarySchema.parse({
        version: 1,
        user: {
          version: 1,
          id: tenant.userId,
          name: 'Fixture',
          email: 'fixture@example.test',
          emailVerified: true,
          twoFactorEnabled: false,
          onboardingCompleted: true,
        },
        organization: {
          version: 1,
          id: tenant.orgId,
          name: 'Fixture',
          slug: 'fixture',
          kind: 'personal',
          state: 'active',
          require2fa: false,
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
        platformAdmin: false,
      }),
    },
    new Headers(),
  );
  return identities.run(request, () =>
    authorization.withActor(currentVerifiedIdentity(), work),
  );
}

test('a completed first chat answer emits its title task in the completion transaction', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  const authorization = new RunAuthorizationService();
  const tenant = fixture.tenants[0]!;
  const chat = await fixture.chat.create(0);
  const userMessageId = randomUUID();
  const answerText = 'A completed answer about Indonesian law.';
  await fixture.chat.insertUser(0, {
    chatId: chat.id,
    messageId: userMessageId,
    parentMessageId: null,
    text: 'Bagaimana aturan tentang perjanjian?',
    effort: 'high',
  });
  let calls = 0;
  const gateway: ModelGateway = {
    async *generate() {
      calls++;
      yield { type: 'text', text: answerText };
      yield {
        type: 'outcome',
        outcome: {
          finishReason: 'stop',
          attemptOutcome: 'succeeded',
          retryable: false,
          usage: { inputTokens: 8, outputTokens: 9 },
        },
      };
    },
  };
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const engine = await createAiHarness(
    {
      database: fixture.database,
      capacity: fixture.capacity,
      capacityConfig: fixture.capacityConfig,
      allowlist,
      authorization,
      close: async () => {},
    },
    {
      profiles: [CHAT_PROFILES.chat, CHAT_PROFILES.title],
      contexts: [new ChatHistoryContextProvider(fixture.database)],
      tools: [],
    },
    gateway,
    undefined,
    { chatTitleServiceFactory: (runs) => new ChatTitleService(fixture.database, runs) },
  );

  try {
    const started = await withActor(tenant, authorization, (actor) =>
      engine.start(actor, {
        profileId: CHAT_PROFILES.chat.id,
        prompt: 'Bagaimana aturan tentang perjanjian?',
        effort: 'high',
        resourceIds: [chat.id],
      }),
    );
    await fixture.chat.associateStartedAnswer(0, chat.id, started.runId);
    await fixture.chat.insertAssistant(0, {
      chatId: chat.id,
      messageId: started.runId,
      parentMessageId: userMessageId,
      runId: started.runId,
    });
    await engine.execute(
      {
        outboxId: stepJobId(started.runId, 1),
        type: 'run.start.v1',
        ctx: tenant,
        payload: { runId: started.runId, sequence: 1, expectedVersion: 1 },
      },
      { signal: new AbortController().signal },
    );

    expect((await engine.inspect(tenant, started.runId))?.status).toBe('completed');
    expect(calls).toBe(1);
    const titleTasks = await fixture.database.withTenant(tenant, async (tx) => {
      const { client } = requireSession(tx);
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ops.outbox
         WHERE org_id=$1 AND user_id=$2 AND type='chat.title.v1'
           AND payload->>'chatId'=$3`,
        [tenant.orgId, tenant.userId, chat.id],
      );
      return result.rows[0]!.count;
    });
    expect(titleTasks).toBe('1');
  } finally {
    await engine.close();
    await fixture.close();
  }
});
