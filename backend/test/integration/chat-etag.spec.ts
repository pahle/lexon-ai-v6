import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { identityApiHarness } from '../setup/identity-api-harness.js';
import {
  requireSession,
  readTreeValidator,
} from '../../src/infrastructure/db/index.js';

// F4.4 hardening (spec §5 item 15, B-04): the chat tree read answers a weak
// validator ETag, honours If-None-Match with an empty 304, and moves the tag
// for every write kind that changes the tree. Foreign actors holding a real
// tag still get the identical random-id 404 — never a 304.

const TAG = /^W\/"v1\.[A-Za-z0-9_-]{30,}"$/;

async function createChat(
  origin: string,
  headers: Record<string, string>,
  text: string,
) {
  const chatId = randomUUID();
  const userMessageId = randomUUID();
  const created = await fetch(`${origin}/api/chats`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      chatId,
      userMessageId,
      requestId: randomUUID(),
      text,
      effort: 'high',
    }),
  });
  expect(created.status).toBe(201);
  const mutation = (await created.json()) as {
    assistantMessageId: string;
    runId: string;
  };
  return { chatId, userMessageId, mutation };
}

test('GET chat answers a validator ETag, honours If-None-Match, and shifts on every tree-changing write kind', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-etag-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const { chatId, userMessageId, mutation } = await createChat(
      origin,
      owner,
      'ETag freshness probe',
    );

    const getTree = (tag?: string) =>
      fetch(`${origin}/api/chats/${chatId}`, {
        headers: tag === undefined ? owner : { ...owner, 'if-none-match': tag },
      });

    // The 200 carries the same tag readTreeValidator computes, plus
    // cache-control: no-store and no Vary on both statuses.
    const first = await getTree();
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(TAG);
    expect(first.headers.get('cache-control')).toContain('no-store');
    expect(first.headers.get('vary')).toBeNull();
    const treeBody = (await first.json()) as { id: string };
    expect(treeBody.id).toBe(chatId);

    const chatRow = (await fixture.inspect.chat(chatId))!;
    const ctx = {
      orgId: chatRow.org_id as string,
      userId: chatRow.owner_user_id as string,
    };
    const expectedTag = await fixture.database.withTenant(ctx, (tx) =>
      readTreeValidator(tx, chatId),
    );
    expect(etag).toBe(expectedTag);

    const notModified = await getTree(etag!);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe(etag);
    expect(notModified.headers.get('cache-control')).toContain('no-store');
    expect(notModified.headers.get('vary')).toBeNull();
    expect(await notModified.text()).toBe('');

    const tenantQuery = (sql: string, params: readonly unknown[]) =>
      fixture.database.withTenant(ctx, async (tx) => {
        const { client } = requireSession(tx);
        return client.query(sql, [...params]);
      });
    const completeRun = (runId: string) =>
      tenantQuery(
        `UPDATE app.ai_runs SET status='completed',final_output='probe output',
         run_version=run_version+1,updated_at=clock_timestamp(),
         completed_at=clock_timestamp()
         WHERE org_id=$1 AND id=$2`,
        [ctx.orgId, runId],
      );

    /** Stale tag answers a fresh 200; the fresh tag still answers 304. */
    const expectTagShift = async (previous: string, kind: string) => {
      const fresh = await getTree(previous);
      expect(fresh.status, `${kind}: stale tag must not answer 304`).toBe(200);
      const next = fresh.headers.get('etag');
      expect(next, `${kind}: tag must shift`).toMatch(TAG);
      expect(next, `${kind}: tag must shift`).not.toBe(previous);
      const again = await getTree(next!);
      expect(again.status, `${kind}: fresh tag must answer 304`).toBe(304);
      return next!;
    };

    let tag = etag!;

    // run status: queued -> running bumps run_version/updated_at.
    await tenantQuery(
      `UPDATE app.ai_runs SET status='running',run_version=run_version+1,
       updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2`,
      [ctx.orgId, mutation.runId],
    );
    tag = await expectTagShift(tag, 'run status');

    // final output: running -> completed clears the active-answer pointer.
    await tenantQuery(
      `UPDATE app.ai_runs SET status='completed',final_output='probe output',
       run_version=run_version+1,updated_at=clock_timestamp(),
       completed_at=clock_timestamp()
       WHERE org_id=$1 AND id=$2`,
      [ctx.orgId, mutation.runId],
    );
    tag = await expectTagShift(tag, 'final output');

    // checkpoint: a fresh step, attempt and checkpoint row on the same run.
    const stepId = randomUUID();
    const attemptId = randomUUID();
    await tenantQuery(
      `INSERT INTO app.ai_steps(id,org_id,run_id,sequence,expected_version,state,fence)
       VALUES ($3,$1,$2,900,1,'committed',1)`,
      [ctx.orgId, mutation.runId, stepId],
    );
    await tenantQuery(
      `INSERT INTO app.ai_attempts(id,org_id,run_id,step_id,ordinal,model_id,
        estimator_version,estimated_input_tokens,reserved_input_tokens,
        reserved_output_tokens,fence,active)
       VALUES ($4,$1,$2,$3,1,'probe/model','probe-v1',1,1,4,1,true)`,
      [ctx.orgId, mutation.runId, stepId, attemptId],
    );
    await tenantQuery(
      `INSERT INTO app.ai_checkpoints(org_id,run_id,step_id,attempt_id,fence,text)
       VALUES ($1,$2,$3,$4,1,'checkpoint probe')`,
      [ctx.orgId, mutation.runId, stepId, attemptId],
    );
    tag = await expectTagShift(tag, 'checkpoint');

    // new message: a follow-up turn inserts a user and an assistant row.
    const followUp = await fetch(`${origin}/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({
        userMessageId: randomUUID(),
        parentMessageId: mutation.assistantMessageId,
        text: 'Follow-up probe',
        effort: 'high',
      }),
    });
    expect(followUp.status).toBe(201);
    const followUpMutation = (await followUp.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    tag = await expectTagShift(tag, 'new message');
    await completeRun(followUpMutation.runId);
    tag = await getTree().then((res) => res.headers.get('etag')!);

    // branch: edit forks a new user turn, regenerate a new answer row.
    const edited = await fetch(
      `${origin}/api/chats/${chatId}/messages/${userMessageId}/edit`,
      {
        method: 'POST',
        headers: { ...owner, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: userMessageId,
          newMessageId: randomUUID(),
          text: 'Edited probe',
          effort: 'high',
        }),
      },
    );
    expect(edited.status).toBe(201);
    const editedMutation = (await edited.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    tag = await expectTagShift(tag, 'edit branch');
    await completeRun(editedMutation.runId);
    tag = await getTree().then((res) => res.headers.get('etag')!);

    const regenerated = await fetch(
      `${origin}/api/chats/${chatId}/messages/${editedMutation.assistantMessageId}/regenerate`,
      {
        method: 'POST',
        headers: { ...owner, 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: editedMutation.assistantMessageId,
          requestId: randomUUID(),
        }),
      },
    );
    expect(regenerated.status).toBe(201);
    const regenMutation = (await regenerated.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    tag = await expectTagShift(tag, 'regenerate branch');

    // feedback: set, change and clear each rewrite the tree's feedback field.
    const feedback = (rating: 'good' | 'bad' | null) =>
      fetch(
        `${origin}/api/chats/${chatId}/messages/${mutation.runId}/feedback`,
        {
          method: 'PUT',
          headers: { ...owner, 'content-type': 'application/json' },
          body: JSON.stringify({ rating }),
        },
      );
    expect((await feedback('good')).status).toBe(204);
    tag = await expectTagShift(tag, 'feedback set');
    expect((await feedback('bad')).status).toBe(204);
    tag = await expectTagShift(tag, 'feedback change');
    expect((await feedback(null)).status).toBe(204);
    tag = await expectTagShift(tag, 'feedback clear');

    // viewed leaf: the freshest answer row becomes the read pointer.
    const viewed = await fetch(`${origin}/api/chats/${chatId}/viewed-leaf`, {
      method: 'PUT',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ leafId: regenMutation.assistantMessageId }),
    });
    expect(viewed.status).toBe(200);
    tag = await expectTagShift(tag, 'viewed leaf');

    // title: a manual rename bumps chats.title and title_version.
    const renamed = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed probe' }),
    });
    expect(renamed.status).toBe(204);
    await expectTagShift(tag, 'title');
  } finally {
    await Promise.all([app.close(), fixture.close()]);
  }
});

test('validator header values stay out of request and response logs', async ({
  services,
}) => {
  const harness = await identityApiHarness(services);
  try {
    const user = await harness.user('ETag logging actor');
    const chatId = randomUUID();
    const created = await harness.call('/chats', user.headers, 'POST', {
      chatId,
      userMessageId: randomUUID(),
      requestId: randomUUID(),
      text: 'ETag logging probe',
      effort: 'high',
    });
    expect(created.status).toBe(201);
    const first = await harness.call(`/chats/${chatId}`, user.headers);
    expect(first.status).toBe(200);
    const tag = first.headers.get('etag');
    expect(tag).toMatch(TAG);
    const again = await harness.call(`/chats/${chatId}`, {
      ...user.headers,
      'if-none-match': tag!,
    });
    expect(again.status).toBe(304);
    const logs = harness.logs.join('');
    expect(logs).not.toContain(tag!);
    // The ended 304 hands nothing back to the transport: no headers-sent
    // complaint and no error-level record for the request.
    expect(logs).not.toContain('ERR_HTTP_HEADERS_SENT');
    expect(logs).not.toMatch(/"level":\s*(?:50|60)\b/);
  } finally {
    await harness.close();
  }
});

for (const actorKind of ['same-org peer', 'other-org member'] as const) {
  test(`a ${actorKind} holding the owner's real tag still gets the identical random-id 404`, async ({
    services,
  }) => {
    const environment = createAuthEnvironment(
      services,
      '/tmp/lexon-chat-etag-foreign-health.json',
    );
    environment.AUTH_RATE_RULES_JSON = JSON.stringify({
      signup: { account: 3, ip: 10_000, windowSeconds: 600 },
      signin: { account: 5, ip: 10_000, windowSeconds: 60 },
      'verification-resend': { account: 3, ip: 10_000, windowSeconds: 600 },
    });
    const app = await createTestApi(loadRuntimeConfig('api', environment));
    const organizations = createOrganizationInspector({
      migratorUrl: services.migratorUrl,
    });
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
      const { chatId } = await createChat(origin, owner, 'Foreign tag probe');
      const owned = await fetch(`${origin}/api/chats/${chatId}`, {
        headers: owner,
      });
      expect(owned.status).toBe(200);
      const tag = owned.headers.get('etag');
      expect(tag).toMatch(TAG);

      const capture = async (id: string) => {
        const response = await fetch(`${origin}/api/chats/${id}`, {
          headers: { ...attacker, 'if-none-match': tag! },
        });
        const text = await response.text();
        const parsed = text ? (JSON.parse(text) as { error?: unknown }) : null;
        return { status: response.status, error: parsed?.error ?? null };
      };
      // A real tag must never buy visibility: the foreign read answers the
      // identical random-id 404 body, never a 304.
      const foreign = await capture(chatId);
      const random = await capture(randomUUID());
      expect(foreign.status).toBe(404);
      expect(foreign).toEqual(random);
    } finally {
      await Promise.all([app.close(), organizations.close()]);
    }
  });
}
