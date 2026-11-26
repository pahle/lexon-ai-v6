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

// F6 task 8: project deletion — the 0049 definer tombstones every project
// chat with its deletion-work row and per-run notifies, fences live runs and
// cascades the projects row; the confirmation contract is the live
// chatCount and owner-only semantics fall out of the in-function check.

const password = 'Project-delete-42!';

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

async function insertChat(
  pools: ReturnType<typeof createPlatformPools>,
  input: {
    orgId: string;
    ownerUserId: string;
    projectId: string;
    title: string;
    runningRun?: boolean;
  },
) {
  const chatId = randomUUID();
  const runId = randomUUID();
  const client = await pools.migrator.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [chatId, input.orgId, input.ownerUserId, input.title, input.projectId],
    );
    await client.query(`SELECT set_config('app.user_id',$1,true)`, [
      input.ownerUserId,
    ]);
    if (input.runningRun) {
      const runConfig = JSON.stringify({
        resourceIds: [chatId],
        profileSnapshot: {
          maxIterations: 2,
          maxToolProposalsPerGeneration: 4,
        },
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
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { chatId, runId };
}

test('owner-only delete with the chatCount confirmation tombstones every project chat, cascades the row and audits chatCount', async ({
  services,
}) => {
  const env = createAuthEnvironment(services, '/tmp/lexon-project-delete.json');
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, {
    secret: env.AUTH_SECRET,
  });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const [owner, editor, viewer, outsider] = await Promise.all(
      ['Del Owner', 'Del Editor', 'Del Viewer', 'Del Outsider'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([
      owner.userId,
      editor.userId,
      viewer.userId,
    ]);
    for (const user of [owner, editor, viewer])
      await activate(proof, user, team.id);
    const create = await fetch(`${origin}/api/projects`, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ name: 'Delete matter' }),
    });
    const project = (await create.json()) as { id: string };
    const membersUrl = `${origin}/api/projects/${project.id}/members`;
    for (const [user, role] of [
      [editor, 'editor'],
      [viewer, 'viewer'],
    ] as const) {
      const add = await fetch(membersUrl, {
        method: 'POST',
        headers: jsonHeaders(owner.cookieHeaders),
        body: JSON.stringify({ userId: user.userId, role }),
      });
      expect(add.status).toBe(201);
    }
    // Chats belonging to the owner and to members alike.
    const chats = [
      await insertChat(pools, {
        orgId: team.id,
        ownerUserId: owner.userId,
        projectId: project.id,
        title: 'owner chat',
      }),
      await insertChat(pools, {
        orgId: team.id,
        ownerUserId: editor.userId,
        projectId: project.id,
        title: 'editor chat',
      }),
      await insertChat(pools, {
        orgId: team.id,
        ownerUserId: viewer.userId,
        projectId: project.id,
        title: 'viewer chat',
      }),
    ];
    const detail = await fetch(`${origin}/api/projects/${project.id}`, {
      headers: owner.cookieHeaders,
    });
    const { chatCount } = (await detail.json()) as { chatCount: number };
    expect(chatCount).toBe(3);

    // Refusals: outsider 404 (invisible), editor/viewer 403 (visible,
    // not owner), wrong confirmation 422, no body 422.
    const outsiderDelete = await fetch(`${origin}/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(outsider.cookieHeaders),
    });
    expect(outsiderDelete.status).toBe(404);
    const editorDelete = await fetch(`${origin}/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(editor.cookieHeaders),
      body: JSON.stringify({ chatCount }),
    });
    expect(editorDelete.status).toBe(403);
    const wrongCount = await fetch(`${origin}/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ chatCount: chatCount + 1 }),
    });
    expect(wrongCount.status).toBe(422);

    const remove = await fetch(`${origin}/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ chatCount }),
    });
    expect(remove.status).toBe(204);

    // The project is gone for everyone — including the owner.
    for (const user of [owner, editor, viewer])
      expect(
        (
          await fetch(`${origin}/api/projects/${project.id}`, {
            headers: user.cookieHeaders,
          })
        ).status,
      ).toBe(404);

    // Every project chat is tombstoned and detached (SET NULL on the FK).
    const tombstones = await pools.migrator.query<{
      id: string;
      deleted: boolean;
      project_id: string | null;
    }>(
      `SELECT id,(deleted_at IS NOT NULL) AS deleted,project_id
       FROM app.chats WHERE org_id=$1 AND id=ANY($2::uuid[])`,
      [team.id, chats.map((chat) => chat.chatId)],
    );
    expect(tombstones.rows).toHaveLength(3);
    for (const row of tombstones.rows) {
      expect(row.deleted).toBe(true);
      expect(row.project_id).toBeNull();
    }
    // No project chat escapes the tombstone.
    const survivors = await pools.migrator.query(
      `SELECT count(*)::int AS n FROM app.chats
       WHERE org_id=$1 AND project_id=$2`,
      [team.id, project.id],
    );
    expect(survivors.rows[0]?.n).toBe(0);

    // Members' own tombstoned chats are invisible on the read path.
    for (const [user, chat] of [
      [editor, chats[1]!],
      [viewer, chats[2]!],
    ] as const) {
      expect(
        (
          await fetch(`${origin}/api/chats/${chat.chatId}`, {
            headers: user.cookieHeaders,
          })
        ).status,
      ).toBe(404);
    }

    // Each chat carries the same deletion-work row the sweep consumes.
    const work = await pools.migrator.query<{
      chat_id: string;
      owner_user_id: string;
      phase: string;
    }>(
      `SELECT chat_id,owner_user_id,phase FROM app.chat_deletion_work
       WHERE org_id=$1`,
      [team.id],
    );
    expect(work.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chat_id: chats[0]!.chatId,
          owner_user_id: owner.userId,
          phase: 'grace',
        }),
        expect.objectContaining({
          chat_id: chats[1]!.chatId,
          owner_user_id: editor.userId,
          phase: 'grace',
        }),
      ]),
    );
    // Outbox records mirror F4 single-chat delete (chat.cleanup.v1 per chat).
    const outbox = await pools.migrator.query<{ payload: { chatId: string } }>(
      `SELECT payload FROM ops.outbox
       WHERE org_id=$1 AND type='chat.cleanup.v1'`,
      [team.id],
    );
    expect(outbox.rows.map((row) => row.payload.chatId).sort()).toEqual(
      chats.map((chat) => chat.chatId).sort(),
    );

    const audit = await pools.migrator.query<{
      metadata: { chatCount: number };
    }>(
      `SELECT metadata FROM ops.audit_events
       WHERE org_id=$1 AND type='project.deleted.v1'`,
      [team.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata.chatCount).toBe(3);
  } finally {
    await pools.close();
    await organizations.close();
    await proof.close();
    await app.close();
  }
});

test('a member chat with an active run is fenced to cancelling and the member stream closes on delete', async ({
  services,
}) => {
  const env = createAuthEnvironment(services, '/tmp/lexon-project-delete.json');
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, {
    secret: env.AUTH_SECRET,
  });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const [owner, member] = await Promise.all(
      ['Run Owner', 'Run Member'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([owner.userId, member.userId]);
    for (const user of [owner, member]) await activate(proof, user, team.id);
    const create = await fetch(`${origin}/api/projects`, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ name: 'Run matter' }),
    });
    const project = (await create.json()) as { id: string };
    const memberAdd = await fetch(
      `${origin}/api/projects/${project.id}/members`,
      {
        method: 'POST',
        headers: jsonHeaders(owner.cookieHeaders),
        body: JSON.stringify({ userId: member.userId, role: 'editor' }),
      },
    );
    expect(memberAdd.status).toBe(201);
    const { runId } = await insertChat(pools, {
      orgId: team.id,
      ownerUserId: member.userId,
      projectId: project.id,
      title: 'member live chat',
      runningRun: true,
    });

    // The member (project editor) opens the run stream — the run is
    // theirs and the chat is project-visible.
    const stream = await fetch(`${origin}/api/runs/${runId}/events`, {
      headers: member.cookieHeaders,
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

    const remove = await fetch(`${origin}/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ chatCount: 1 }),
    });
    expect(remove.status).toBe(204);

    // The run is fenced to cancelling inside the same transaction.
    const run = await pools.migrator.query<{ status: string }>(
      `SELECT status FROM app.ai_runs WHERE org_id=$1 AND id=$2`,
      [team.id, runId],
    );
    expect(run.rows[0]?.status).toBe('cancelling');

    // The member's open stream closes on the deletion notify.
    await expect(
      Promise.race([
        ended,
        new Promise<never>((_resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Stream stayed open past project delete')),
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
