import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { createTestApi } from '../setup/test-api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { securityHarness } from '../setup/security-harness.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { OrganizationSwitchService } from '../../src/modules/organizations/organization-switch.service.js';
import { ChatDetailSchema, ChatShareSummarySchema } from '@lexon/contracts';
import { z } from 'zod';

// F6 task 7: standalone-chat sharing — owner-only grants to org members on
// project_id-NULL chats; recipients read via the predicate arm; revocation
// ends access on the next request and closes an open run stream within the
// 5 s revalidation window.

const password = 'Chat-shares-42!';

const jsonHeaders = (cookieHeaders: Headers) => {
  const headers = new Headers(cookieHeaders);
  headers.set('content-type', 'application/json');
  // Cookie-authenticated writes require the configured public origin (CSRF).
  headers.set('origin', 'http://localhost:3000');
  return headers;
};

async function activate(
  proof: Awaited<ReturnType<typeof createAuthFixture>>,
  user: { cookieHeaders: Headers },
  orgId: string,
) {
  const security = securityHarness(proof);
  const switching = new OrganizationSwitchService(
    new IdentitySessionService(proof.integration),
  );
  await security.identity(user.cookieHeaders, (identity) =>
    switching.select(identity, orgId),
  );
}

/** A standalone chat + a 'running' answer run, inserted as the migrator so
 * no run machinery spins up — the share/read predicates only need the rows. */
async function seedSharedChat(
  pools: ReturnType<typeof createPlatformPools>,
  input: { orgId: string; ownerUserId: string; projectId?: string },
) {
  const chatId = randomUUID();
  const runId = randomUUID();
  const client = await pools.migrator.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id)
       VALUES ($1,$2,$3,'shared candidate',$4)`,
      [chatId, input.orgId, input.ownerUserId, input.projectId ?? null],
    );
    await client.query(`SELECT set_config('app.user_id',$1,true)`, [
      input.ownerUserId,
    ]);
    const runConfig = JSON.stringify({
      resourceIds: [chatId],
      profileSnapshot: { maxIterations: 2, maxToolProposalsPerGeneration: 4 },
    });
    await client.query(
      `INSERT INTO app.ai_runs(id,org_id,initiating_user_id,profile_id,profile_version,
         resolved_config,model_id,input_text,status,input_budget_tokens,output_budget_tokens,
         run_version,next_sequence)
       VALUES ($1,$2,$3,'test-profile',1,$4::jsonb,'synthetic/test','seed input',
         'running',1000,1000,1,1)`,
      [runId, input.orgId, input.ownerUserId, runConfig],
    );
    await client.query(
      `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
       VALUES ($1,$2,$3,'answer')`,
      [input.orgId, chatId, runId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { chatId, runId };
}

const readSseFrame = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Promise.race([
    (async () => {
      let text = '';
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) throw new Error('SSE stream closed before event');
        text += decoder.decode(value, { stream: true });
        const separator = text.indexOf('\n\n');
        if (separator < 0) continue;
        const frame = text.slice(0, separator);
        if (frame.startsWith(': ')) return frame;
        const data = frame
          .split('\n')
          .find((line) => line.startsWith('data: '));
        if (data) return data.slice('data: '.length);
      }
    })(),
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for SSE event')),
        8000,
      );
      timeout.unref();
    }),
  ]);

test('share add lists recipients, grants reader access, revokes into identical 404 and audits both directions', async ({
  services,
}) => {
  const env = createAuthEnvironment(services, '/tmp/lexon-chat-shares.json');
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, {
    secret: env.AUTH_SECRET,
  });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  const opened: Response[] = [];
  try {
    const [owner, recipient, outsider] = await Promise.all(
      ['Share Owner', 'Share Recipient', 'Share Outsider'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([owner.userId, recipient.userId]);
    for (const user of [owner, recipient]) await activate(proof, user, team.id);
    const { chatId } = await seedSharedChat(pools, {
      orgId: team.id,
      ownerUserId: owner.userId,
    });
    const sharesUrl = `${origin}/api/chats/${chatId}/shares`;

    // The recipient's invalidation stream sees the grant event live.
    const invalidations = await fetch(`${origin}/api/chats/events`, {
      headers: recipient.cookieHeaders,
    });
    opened.push(invalidations);
    const invalidationReader = invalidations.body!.getReader();
    expect(await readSseFrame(invalidationReader)).toBe(': connected');

    const share = await fetch(sharesUrl, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ userIds: [recipient.userId] }),
    });
    expect(share.status).toBe(201);
    const summaries = z.array(ChatShareSummarySchema).parse(await share.json());
    expect(summaries).toEqual([
      expect.objectContaining({ userId: recipient.userId }),
    ]);
    const grant = JSON.parse(await readSseFrame(invalidationReader)) as Record<
      string,
      unknown
    >;
    expect(grant).toEqual({
      version: 1,
      type: 'chat.invalidated',
      chatId,
    });

    // Owner's list shows the recipient row.
    const list = await fetch(sharesUrl, { headers: owner.cookieHeaders });
    expect(list.status).toBe(200);
    expect(z.array(ChatShareSummarySchema).parse(await list.json())).toEqual([
      expect.objectContaining({ userId: recipient.userId }),
    ]);

    // Recipient reads the tree with reader access and sees it under
    // scope=shared — never under their own list.
    const detail = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: recipient.cookieHeaders,
    });
    expect(detail.status).toBe(200);
    expect(ChatDetailSchema.parse(await detail.json()).access).toBe('reader');
    const shared = await fetch(`${origin}/api/chats?scope=shared`, {
      headers: recipient.cookieHeaders,
    });
    const sharedItems = (await shared.json()) as {
      items: Array<{ id: string }>;
    };
    expect(sharedItems.items.map((item) => item.id)).toContain(chatId);
    const own = await fetch(`${origin}/api/chats`, {
      headers: recipient.cookieHeaders,
    });
    const ownItems = (await own.json()) as { items: Array<{ id: string }> };
    expect(ownItems.items.map((item) => item.id)).not.toContain(chatId);

    // Recipients cannot manage shares; outsiders see nothing.
    const recipientShare = await fetch(sharesUrl, {
      method: 'POST',
      headers: jsonHeaders(recipient.cookieHeaders),
      body: JSON.stringify({ userIds: [owner.userId] }),
    });
    expect(recipientShare.status).toBe(403);
    const invisible = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: outsider.cookieHeaders,
    });
    expect(invisible.status).toBe(404);

    // Revoke: 204, identical-404 on the next request, revoked audit.
    const revoke = await fetch(`${sharesUrl}/${recipient.userId}`, {
      method: 'DELETE',
      headers: jsonHeaders(owner.cookieHeaders),
    });
    expect(revoke.status).toBe(204);
    const gone = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: recipient.cookieHeaders,
    });
    expect(gone.status).toBe(404);

    const audits = await pools.migrator.query<{
      type: string;
      subject_user_id: string;
    }>(
      `SELECT type,subject_user_id FROM ops.audit_events
       WHERE org_id=$1 AND metadata->>'chatId'=$2`,
      [team.id, chatId],
    );
    expect(audits.rows.map((row) => row.type)).toEqual(
      expect.arrayContaining(['chat.shared.v1', 'chat.share_revoked.v1']),
    );
    expect(audits.rows.map((row) => row.type)).toHaveLength(2);
    expect(audits.rows[0]?.subject_user_id).toBe(recipient.userId);
  } finally {
    for (const response of opened) response.body?.cancel().catch(() => {});
    await pools.close();
    await organizations.close();
    await proof.close();
    await app.close();
  }
});

test('sharing refuses project chats and non-org targets, and access ends when the recipient leaves the org', async ({
  services,
}) => {
  const env = createAuthEnvironment(services, '/tmp/lexon-chat-shares.json');
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, {
    secret: env.AUTH_SECRET,
  });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const [owner, recipient, outsider] = await Promise.all(
      ['Refuse Owner', 'Refuse Recipient', 'Refuse Outsider'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([owner.userId, recipient.userId]);
    for (const user of [owner, recipient]) await activate(proof, user, team.id);
    const projectId = randomUUID();
    const projectClient = await pools.migrator.connect();
    try {
      await projectClient.query(
        `INSERT INTO app.projects(id,org_id,owner_user_id,name)
         VALUES ($1,$2,$3,'share refusal project')`,
        [projectId, team.id, owner.userId],
      );
    } finally {
      projectClient.release();
    }
    const projectChat = await seedSharedChat(pools, {
      orgId: team.id,
      ownerUserId: owner.userId,
      projectId,
    });
    const standalone = await seedSharedChat(pools, {
      orgId: team.id,
      ownerUserId: owner.userId,
    });

    // Project chats can never be shared — the invariant is project access.
    const projectShare = await fetch(
      `${origin}/api/chats/${projectChat.chatId}/shares`,
      {
        method: 'POST',
        headers: jsonHeaders(owner.cookieHeaders),
        body: JSON.stringify({ userIds: [recipient.userId] }),
      },
    );
    expect(projectShare.status).toBe(422);

    // Targets outside the org are refused by the insert check.
    const offOrg = await fetch(
      `${origin}/api/chats/${standalone.chatId}/shares`,
      {
        method: 'POST',
        headers: jsonHeaders(owner.cookieHeaders),
        body: JSON.stringify({ userIds: [outsider.userId] }),
      },
    );
    expect(offOrg.status).toBe(422);

    // Org-leave ends recipient access: grant, confirm the read, delete the
    // member row as migrator (the lexon_org_member arm fails on the next
    // request — leaving the org removes every grant at the predicate level).
    const share = await fetch(
      `${origin}/api/chats/${standalone.chatId}/shares`,
      {
        method: 'POST',
        headers: jsonHeaders(owner.cookieHeaders),
        body: JSON.stringify({ userIds: [recipient.userId] }),
      },
    );
    expect(share.status).toBe(201);
    const readable = await fetch(`${origin}/api/chats/${standalone.chatId}`, {
      headers: recipient.cookieHeaders,
    });
    expect(readable.status).toBe(200);
    const member = await pools.migrator.query(
      `DELETE FROM auth.member
       WHERE organization_id=$1 AND user_id=$2`,
      [team.id, recipient.userId],
    );
    expect(member.rowCount).toBe(1);
    const ended = await fetch(`${origin}/api/chats/${standalone.chatId}`, {
      headers: recipient.cookieHeaders,
    });
    expect(ended.status).toBe(404);
  } finally {
    await pools.close();
    await organizations.close();
    await proof.close();
    await app.close();
  }
});

test('an open run stream closes within the revalidation window when the share is revoked', async ({
  services,
}) => {
  const env = createAuthEnvironment(services, '/tmp/lexon-chat-shares.json');
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, {
    secret: env.AUTH_SECRET,
  });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const [owner, recipient] = await Promise.all(
      ['Stream Owner', 'Stream Recipient'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([owner.userId, recipient.userId]);
    for (const user of [owner, recipient]) await activate(proof, user, team.id);
    const { chatId, runId } = await seedSharedChat(pools, {
      orgId: team.id,
      ownerUserId: owner.userId,
    });
    const share = await fetch(`${origin}/api/chats/${chatId}/shares`, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ userIds: [recipient.userId] }),
    });
    expect(share.status).toBe(201);

    // Recipient opens the run stream — the snapshot replay flushes headers.
    const stream = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers: recipient.cookieHeaders,
    });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const ended = (async () => {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return 'closed';
        decoder.decode(value, { stream: true });
      }
    })();

    const revoke = await fetch(
      `${origin}/api/chats/${chatId}/shares/${recipient.userId}`,
      { method: 'DELETE', headers: jsonHeaders(owner.cookieHeaders) },
    );
    expect(revoke.status).toBe(204);
    await expect(
      Promise.race([
        ended,
        new Promise<never>((_resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Stream stayed open past revocation')),
            9000,
          );
          timeout.unref();
        }),
      ]),
    ).resolves.toBe('closed');
  } finally {
    await pools.close();
    await organizations.close();
    await proof.close();
    await app.close();
  }
});
