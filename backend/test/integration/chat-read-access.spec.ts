import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import {
  createPlatformPools,
  createRoleClient,
} from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  chatShare,
  projectDeny,
  projectMemberRemove,
  withAppTenant,
} from '../../src/infrastructure/db/testing/project-fixture.js';
import {
  AiRunRepository,
  AiStepRepository,
  ChatMessageRepository,
  ChatRepository,
  readTreeValidator,
  type CommittedStreamReference,
  type StepClaim,
  type TerminalStreamReference,
} from '../../src/infrastructure/db/index.js';

// F6 §4.1/§5/§6: the application read predicate (owner OR project access OR
// standalone share, deny-wins) governs every app-level read path — detail
// tree, lists, SSE snapshot/proofs and the title fan-out — and the owner-only
// write paths gain the same project-access disjunction on the owner arm. A
// denied or removed member loses even their own project chats, and every
// denial returns the byte-identical nonexistent-id 404.

interface Actor {
  readonly headers: Record<string, string>;
  readonly userId: string;
  readonly personalOrgId: string;
}

interface AccessScenario {
  readonly teamId: string;
  readonly projectId: string;
  readonly projectChatId: string;
  readonly editorChatId: string;
  readonly viewerChatId: string;
  readonly standaloneChatId: string;
  readonly sharedChatId: string;
  readonly memberMessageId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly activeRunId: string;
  readonly activeStepId: string;
  readonly failedRunId: string;
  readonly failedStepId: string;
}

const RATE_RULES = {
  signup: { account: 8, ip: 10_000, windowSeconds: 600 },
  signin: { account: 5, ip: 10_000, windowSeconds: 60 },
  'verification-resend': { account: 3, ip: 10_000, windowSeconds: 600 },
};

async function actor(app: Awaited<ReturnType<typeof createTestApi>>) {
  const headers = await apiHeaders(app);
  const identity = (await (
    await fetch(`${await app.getUrl()}/api/identity`, { headers })
  ).json()) as { user: { id: string }; organization: { id: string } };
  return {
    headers,
    userId: identity.user.id,
    personalOrgId: identity.organization.id,
  } satisfies Actor;
}

async function switchOrg(
  origin: string,
  headers: Record<string, string>,
  organizationId: string,
) {
  const switched = await fetch(`${origin}/api/organizations/active`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  expect(switched.status).toBe(200);
}

async function capture(response: Response) {
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as { error?: unknown }) : null;
  return { status: response.status, error: parsed?.error ?? null };
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return Promise.race([
    readEventFrame(reader),
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for SSE event')),
        4000,
      );
      timeout.unref();
    }),
  ]);
}

async function readEventFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error('SSE stream closed before event');
    text += decoder.decode(value, { stream: true });
    const separator = text.indexOf('\n\n');
    if (separator < 0) continue;
    const frame = text.slice(0, separator);
    if (frame.startsWith(': ')) return frame;
    const data = frame.split('\n').find((line) => line.startsWith('data: '));
    if (data) return data.slice('data: '.length);
  }
}

async function expectNoEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  quietMs = 250,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    reader.read().then(() => 'event'),
    new Promise<'quiet'>((resolve) => {
      timeout = setTimeout(() => resolve('quiet'), quietMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  expect(result).toBe('quiet');
}

/**
 * Seeds the project/chat/run scenario the access tests share. `owner` owns
 * the project, `viewer`/`editor` carry project member rows and `member` is an
 * org member with no project standing. Chat rows are written as
 * lexon_migrator (RLS-free) with the chat-owner claim bound for the resource
 * write fence; run/step rows follow the project-fixture pattern.
 */
async function seedAccessScenario(
  pools: ReturnType<typeof createPlatformPools>,
  input: {
    orgId: string;
    owner: string;
    editor: string;
    viewer: string;
  },
): Promise<AccessScenario> {
  const scenario: AccessScenario = {
    teamId: input.orgId,
    projectId: randomUUID(),
    projectChatId: randomUUID(),
    editorChatId: randomUUID(),
    viewerChatId: randomUUID(),
    standaloneChatId: randomUUID(),
    sharedChatId: randomUUID(),
    memberMessageId: randomUUID(),
    runId: randomUUID(),
    stepId: randomUUID(),
    activeRunId: randomUUID(),
    activeStepId: randomUUID(),
    failedRunId: randomUUID(),
    failedStepId: randomUUID(),
  };
  const migrator = await pools.migrator.connect();
  try {
    await migrator.query('BEGIN');
    await migrator.query(`SELECT set_config('app.user_id',$1,true)`, [
      input.owner,
    ]);
    await migrator.query(
      `INSERT INTO app.projects(id,org_id,owner_user_id,name,matter_number,practice_area)
       VALUES ($1,$2,$3,'F6 matter','F6-042','litigation')`,
      [scenario.projectId, input.orgId, input.owner],
    );
    await migrator.query(
      `INSERT INTO app.project_members(org_id,project_id,user_id,role) VALUES
       ($1,$2,$3,'editor'),($1,$2,$4,'viewer')
       ON CONFLICT (org_id,project_id,user_id) DO NOTHING`,
      [input.orgId, scenario.projectId, input.editor, input.viewer],
    );
    await migrator.query(
      `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id) VALUES
       ($1,$2,$3,'project alpha',$4),
       ($5,$2,$6,'editor beta',$4),
       ($7,$2,$8,'viewer gamma',$4),
       ($9,$2,$3,'standalone delta',NULL),
       ($10,$2,$3,'shared epsilon',NULL)`,
      [
        scenario.projectChatId,
        input.orgId,
        input.owner,
        scenario.projectId,
        scenario.editorChatId,
        input.editor,
        scenario.viewerChatId,
        input.viewer,
        scenario.standaloneChatId,
        scenario.sharedChatId,
      ],
    );
    await migrator.query(
      `INSERT INTO app.chat_messages(id,org_id,chat_id,parent_message_id,role,user_text,effort)
       VALUES ($1,$2,$3,NULL,'user','project alpha question','high')`,
      [scenario.memberMessageId, input.orgId, scenario.projectChatId],
    );
    await migrator.query(
      `UPDATE app.chats SET viewed_leaf_id=$3 WHERE org_id=$1 AND id=$2`,
      [input.orgId, scenario.projectChatId, scenario.memberMessageId],
    );
    // ai_runs/ai_steps/ai_operations rows go through lexon_migrator — the
    // app-role write fences require initiator claims plus a pre-existing
    // chat_runs link, which a completed/failed seed cannot satisfy
    // (project-fixture precedent). resourceIds carries the chat id so the
    // ai_*_access_read policies resolve the link.
    const runConfig = JSON.stringify({
      resourceIds: [scenario.projectChatId],
      profileSnapshot: { maxIterations: 2, maxToolProposalsPerGeneration: 4 },
    });
    await migrator.query(
      `INSERT INTO app.ai_runs(id,org_id,initiating_user_id,profile_id,profile_version,
         resolved_config,model_id,input_text,status,input_budget_tokens,output_budget_tokens,
         final_output,completed_at,run_version,next_sequence)
       VALUES ($1,$2,$3,'chat',1,$4::jsonb,'synthetic/test','seed input',
         'completed',1000,1000,'done',clock_timestamp(),1,2),
              ($5,$2,$3,'chat',1,$4::jsonb,'synthetic/test','seed input',
         'running',1000,1000,NULL,NULL,1,1),
              ($6,$2,$3,'chat',1,$4::jsonb,'synthetic/test','seed input',
         'failed',1000,1000,NULL,NULL,1,2)`,
      [
        scenario.runId,
        input.orgId,
        input.owner,
        runConfig,
        scenario.activeRunId,
        scenario.failedRunId,
      ],
    );
    await migrator.query(
      `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind) VALUES
       ($1,$2,$3,'answer'),($1,$2,$4,'answer'),($1,$2,$5,'answer')`,
      [
        input.orgId,
        scenario.projectChatId,
        scenario.runId,
        scenario.activeRunId,
        scenario.failedRunId,
      ],
    );
    await migrator.query('COMMIT');
  } catch (error) {
    await migrator.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    migrator.release();
  }
  // ai_steps carries no lexon_migrator INSERT policy, so it is written
  // through the app role — tenant claims bound to the run initiator make
  // the owner-run fence pass (project-fixture pattern).
  await withAppTenant(
    pools.app,
    { orgId: input.orgId, userId: input.owner },
    async (client) => {
      await client.query(
        `INSERT INTO app.ai_steps(id,org_id,run_id,sequence,expected_version,state,fence,lease_until)
         VALUES ($1,$2,$3,1,1,'committed',1,NULL),
                ($4,$2,$5,1,1,'claimed',1,clock_timestamp()+interval '1 hour'),
                ($6,$2,$7,1,1,'failed',1,NULL)`,
        [
          scenario.stepId,
          input.orgId,
          scenario.runId,
          scenario.activeStepId,
          scenario.activeRunId,
          scenario.failedStepId,
          scenario.failedRunId,
        ],
      );
    },
  );
  return scenario;
}

test('a project member opens a project chat as reader while owners report owner access; every denial is the identical 404', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-read-access-health.json',
  );
  environment.AUTH_RATE_RULES_JSON = JSON.stringify(RATE_RULES);
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const pools = createPlatformPools(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const opened: Response[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const [owner, editor, viewer, member, outsider] = await Promise.all([
      actor(app),
      actor(app),
      actor(app),
      actor(app),
      actor(app),
    ]);
    const team = await organizations.seedTeam([
      owner.userId,
      editor.userId,
      viewer.userId,
      member.userId,
    ]);
    for (const current of [owner, editor, viewer, member])
      await switchOrg(origin, current.headers, team.id);
    const scenario = await seedAccessScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      editor: editor.userId,
      viewer: viewer.userId,
    });
    await chatShare(pools.migrator, {
      orgId: team.id,
      chatId: scenario.sharedChatId,
      userId: member.userId,
      grantedByUserId: owner.userId,
    });

    const get = (headers: Record<string, string>, chatId: string) =>
      fetch(`${origin}/api/chats/${chatId}`, { headers });

    const ownerRead = await get(owner.headers, scenario.projectChatId);
    expect(ownerRead.status).toBe(200);
    expect((await ownerRead.json()).access).toBe('owner');
    const standaloneRead = await get(owner.headers, scenario.standaloneChatId);
    expect(standaloneRead.status).toBe(200);
    expect((await standaloneRead.json()).access).toBe('owner');

    const viewerRead = await get(viewer.headers, scenario.projectChatId);
    expect(viewerRead.status).toBe(200);
    const viewerTree = await viewerRead.json();
    expect(viewerTree.access).toBe('reader');
    expect(viewerTree.messages).toHaveLength(1);
    const editorRead = await get(editor.headers, scenario.projectChatId);
    expect(editorRead.status).toBe(200);
    expect((await editorRead.json()).access).toBe('reader');
    const shareRead = await get(member.headers, scenario.sharedChatId);
    expect(shareRead.status).toBe(200);
    expect((await shareRead.json()).access).toBe('reader');

    // Identical-404 matrix: nonexistent id, org non-member, outsider,
    // denied member, denied owner on their own project chat.
    const baseline = await capture(await get(member.headers, randomUUID()));
    expect(baseline.status).toBe(404);
    expect(
      await capture(await get(member.headers, scenario.projectChatId)),
    ).toEqual(baseline);
    expect(
      await capture(await get(outsider.headers, scenario.projectChatId)),
    ).toEqual(baseline);
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: viewer.userId,
      setByUserId: owner.userId,
    });
    expect(
      await capture(await get(viewer.headers, scenario.projectChatId)),
    ).toEqual(baseline);
    // The denied viewer's own project chat is equally invisible.
    expect(
      await capture(await get(viewer.headers, scenario.viewerChatId)),
    ).toEqual(baseline);
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: owner.userId,
      setByUserId: owner.userId,
    });
    expect(
      await capture(await get(owner.headers, scenario.projectChatId)),
    ).toEqual(baseline);
    // The denied owner's standalone chat is unaffected — deny is per-project.
    const deniedStandalone = await get(
      owner.headers,
      scenario.standaloneChatId,
    );
    expect(deniedStandalone.status).toBe(200);
  } finally {
    for (const response of opened)
      await response.body?.cancel().catch(() => {});
    await app.close();
    await organizations.close();
    await pools.close();
  }
});

test('a removed member loses their own project chat on every owner-scoped path', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-read-access-removed.json',
  );
  environment.AUTH_RATE_RULES_JSON = JSON.stringify(RATE_RULES);
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const pools = createPlatformPools(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const [owner, viewer] = await Promise.all([actor(app), actor(app)]);
    const team = await organizations.seedTeam([owner.userId, viewer.userId]);
    for (const current of [owner, viewer])
      await switchOrg(origin, current.headers, team.id);
    const scenario = await seedAccessScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      editor: owner.userId,
      viewer: viewer.userId,
    });
    await projectMemberRemove(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: viewer.userId,
    });
    const baseline = await capture(
      await fetch(`${origin}/api/chats/${randomUUID()}`, {
        headers: viewer.headers,
      }),
    );
    expect(baseline.status).toBe(404);
    // The removed member's own project chat returns the identical 404.
    expect(
      await capture(
        await fetch(`${origin}/api/chats/${scenario.viewerChatId}`, {
          headers: viewer.headers,
        }),
      ),
    ).toEqual(baseline);
    // Repository level: readLive/tree/validator agree with the API.
    const tenant = { orgId: team.id, userId: viewer.userId };
    const chats = new ChatRepository();
    const messages = new ChatMessageRepository();
    expect(
      await fixture.database.withTenant(tenant, (tx) =>
        chats.readLive(tx, scenario.viewerChatId),
      ),
    ).toBeNull();
    expect(
      await fixture.database.withTenant(tenant, (tx) =>
        messages.tree(tx, scenario.viewerChatId),
      ),
    ).toBeNull();
    expect(
      await fixture.database.withTenant(tenant, (tx) =>
        readTreeValidator(tx, scenario.viewerChatId),
      ),
    ).toBeNull();
    // Owner-scoped write fences refuse the removed member too.
    expect(
      await fixture.database.withTenant(tenant, (tx) =>
        chats.rename(tx, scenario.viewerChatId, 'renamed'),
      ),
    ).toBe(false);
  } finally {
    await app.close();
    await organizations.close();
    await fixture.close();
    await pools.close();
  }
});

test('the chats list carries projectName on accessible project chats, drops them on access loss, and scope=shared lists only shared standalone chats', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-read-access-list.json',
  );
  environment.AUTH_RATE_RULES_JSON = JSON.stringify(RATE_RULES);
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const pools = createPlatformPools(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const [owner, editor, member] = await Promise.all([
      actor(app),
      actor(app),
      actor(app),
    ]);
    const team = await organizations.seedTeam([
      owner.userId,
      editor.userId,
      member.userId,
    ]);
    for (const current of [owner, editor, member])
      await switchOrg(origin, current.headers, team.id);
    const scenario = await seedAccessScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      editor: editor.userId,
      viewer: editor.userId,
    });
    await chatShare(pools.migrator, {
      orgId: team.id,
      chatId: scenario.sharedChatId,
      userId: member.userId,
      grantedByUserId: owner.userId,
    });
    const list = async (headers: Record<string, string>, query = '') => {
      const response = await fetch(`${origin}/api/chats${query}`, { headers });
      expect(response.status).toBe(200);
      return (await response.json()) as {
        items: { id: string; projectName?: string }[];
      };
    };
    const ownerList = await list(owner.headers);
    const byId = new Map(
      ownerList.items.map((item) => [item.id, item] as const),
    );
    expect(byId.get(scenario.projectChatId)?.projectName).toBe('F6 matter');
    expect(byId.get(scenario.editorChatId)).toBeUndefined();
    expect(byId.get(scenario.standaloneChatId)?.projectName).toBeUndefined();
    // The editor's own project chat lists for them with the same secondary
    // text; chats they do not own never appear in the own list.
    const editorList = await list(editor.headers);
    const editorById = new Map(
      editorList.items.map((item) => [item.id, item] as const),
    );
    expect(editorById.get(scenario.editorChatId)?.projectName).toBe(
      'F6 matter',
    );
    expect(editorById.get(scenario.projectChatId)).toBeUndefined();
    // scope=shared is the chat_shares arm only: the shared standalone chat
    // appears, the member's own chats and every project chat stay out.
    const sharedList = await list(member.headers, '?scope=shared');
    expect(sharedList.items.map((item) => item.id)).toEqual([
      scenario.sharedChatId,
    ]);
    const ownerShared = await list(owner.headers, '?scope=shared');
    expect(ownerShared.items).toHaveLength(0);
    // Deny the owner: their own project chats vanish from the own list while
    // standalone rows stay.
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: owner.userId,
      setByUserId: owner.userId,
    });
    const deniedList = await list(owner.headers);
    const deniedIds = deniedList.items.map((item) => item.id);
    expect(deniedIds).not.toContain(scenario.projectChatId);
    expect(deniedIds).toContain(scenario.standaloneChatId);
    expect(deniedIds).toContain(scenario.sharedChatId);
  } finally {
    await app.close();
    await organizations.close();
    await pools.close();
  }
});

test('owner-scoped write paths 404 identically for members and denied owners on project chats', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-read-access-writes.json',
  );
  environment.AUTH_RATE_RULES_JSON = JSON.stringify(RATE_RULES);
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const pools = createPlatformPools(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const [owner, viewer] = await Promise.all([actor(app), actor(app)]);
    const team = await organizations.seedTeam([owner.userId, viewer.userId]);
    for (const current of [owner, viewer])
      await switchOrg(origin, current.headers, team.id);
    const scenario = await seedAccessScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      editor: owner.userId,
      viewer: viewer.userId,
    });
    const json = (headers: Record<string, string>) => ({
      ...headers,
      'content-type': 'application/json',
    });
    const routes: Array<{
      name: string;
      call: (
        headers: Record<string, string>,
        chatId: string,
      ) => ReturnType<typeof fetch>;
    }> = [
      {
        name: 'PATCH /api/chats/:chatId (rename)',
        call: (headers, chatId) =>
          fetch(`${origin}/api/chats/${chatId}`, {
            method: 'PATCH',
            headers: json(headers),
            body: JSON.stringify({ title: 'probe' }),
          }),
      },
      {
        name: 'PUT /api/chats/:chatId/viewed-leaf',
        call: (headers, chatId) =>
          fetch(`${origin}/api/chats/${chatId}/viewed-leaf`, {
            method: 'PUT',
            headers: json(headers),
            body: JSON.stringify({ leafId: scenario.memberMessageId }),
          }),
      },
      {
        name: 'POST /api/chats/:chatId/messages (send)',
        call: (headers, chatId) =>
          fetch(`${origin}/api/chats/${chatId}/messages`, {
            method: 'POST',
            headers: json(headers),
            body: JSON.stringify({
              userMessageId: randomUUID(),
              parentMessageId: scenario.memberMessageId,
              text: 'member send probe',
              effort: 'high',
            }),
          }),
      },
    ];
    for (const route of routes) {
      const baseline = await capture(
        await route.call(viewer.headers, randomUUID()),
      );
      expect(baseline.status).toBe(404);
      // A viewer can read the chat but never write to it — identical 404.
      expect(
        await capture(await route.call(viewer.headers, scenario.projectChatId)),
      ).toEqual(baseline);
      // A denied owner loses their own project chat on the owner paths too.
      await projectDeny(pools.migrator, {
        orgId: team.id,
        projectId: scenario.projectId,
        userId: owner.userId,
        setByUserId: owner.userId,
      });
      expect(
        await capture(await route.call(owner.headers, scenario.projectChatId)),
      ).toEqual(baseline);
      await pools.migrator.query(
        'DELETE FROM app.project_denies WHERE org_id=$1 AND project_id=$2',
        [team.id, scenario.projectId],
      );
    }
  } finally {
    await app.close();
    await organizations.close();
    await pools.close();
  }
});

test('SSE snapshot, stream proofs and the registry state accept viewer claims on project chats and reject denied or non-members', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-read-access-streams.json',
  );
  environment.AUTH_RATE_RULES_JSON = JSON.stringify(RATE_RULES);
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const pools = createPlatformPools(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const [owner, viewer, member] = await Promise.all([
      actor(app),
      actor(app),
      actor(app),
    ]);
    const team = await organizations.seedTeam([
      owner.userId,
      viewer.userId,
      member.userId,
    ]);
    for (const current of [owner, viewer, member])
      await switchOrg(origin, current.headers, team.id);
    const scenario = await seedAccessScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      editor: owner.userId,
      viewer: viewer.userId,
    });
    const runs = new AiRunRepository();
    const steps = new AiStepRepository();
    const viewerTenant = { orgId: team.id, userId: viewer.userId };
    const memberTenant = { orgId: team.id, userId: member.userId };
    const ownerTenant = { orgId: team.id, userId: owner.userId };

    // Snapshot + existence checks.
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        runs.authorizedChatSnapshot(tx, scenario.runId, viewer.userId),
      ),
    ).toBeDefined();
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        runs.existsForAccessibleChat(tx, scenario.runId, viewer.userId),
      ),
    ).toBe(true);
    expect(
      await fixture.database.withTenant(ownerTenant, (tx) =>
        runs.existsForAccessibleChat(tx, scenario.runId, owner.userId),
      ),
    ).toBe(true);
    expect(
      await fixture.database.withTenant(memberTenant, (tx) =>
        runs.existsForAccessibleChat(tx, scenario.runId, member.userId),
      ),
    ).toBe(false);
    expect(
      await fixture.database.withTenant(memberTenant, (tx) =>
        runs.authorizedChatSnapshot(tx, scenario.runId, member.userId),
      ),
    ).toBeNull();

    const committed: CommittedStreamReference = {
      runId: scenario.runId,
      orgId: team.id,
      userId: viewer.userId,
      stepId: scenario.stepId,
      sequence: 1,
      expectedVersion: 1,
      fence: 1,
      committedRunVersion: 1,
      committedStatus: 'completed',
    };
    const committedEvent = {
      version: 1 as const,
      runId: scenario.runId,
      type: 'text-end' as const,
      id: 't1',
    };
    const terminal: TerminalStreamReference = {
      runId: scenario.runId,
      orgId: team.id,
      userId: viewer.userId,
      stepId: scenario.stepId,
      sequence: 1,
      expectedVersion: 1,
      fence: 1,
    };
    const active: StepClaim = {
      runId: scenario.activeRunId,
      orgId: team.id,
      userId: viewer.userId,
      stepId: scenario.activeStepId,
      sequence: 1,
      expectedVersion: 1,
      fence: 1,
      leaseUntil: new Date(Date.now() + 60_000),
    };
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        steps.streamCommittedProof(tx, committed, committedEvent),
      ),
    ).toBeDefined();
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        steps.streamTerminalProof(tx, terminal),
      ),
    ).toBeDefined();
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        steps.streamActiveProof(tx, active),
      ),
    ).toBeDefined();
    // The registry resolves a failed project run as terminal for a member —
    // the read predicate reaches the initiator-independent fallback.
    const registry = await fixture.database.withTenant(viewerTenant, (tx) =>
      runs.streamRegistryState(tx, scenario.failedRunId, viewer.userId),
    );
    expect(registry).toMatchObject({ state: 'terminal' });

    // Org non-member: every proof rejects.
    const memberClaims = { ...memberTenant };
    expect(
      await fixture.database.withTenant(memberClaims, (tx) =>
        steps.streamCommittedProof(
          tx,
          { ...committed, userId: member.userId },
          committedEvent,
        ),
      ),
    ).toBeUndefined();
    expect(
      await fixture.database.withTenant(memberClaims, (tx) =>
        steps.streamTerminalProof(tx, {
          ...terminal,
          userId: member.userId,
        }),
      ),
    ).toBeUndefined();
    expect(
      await fixture.database.withTenant(memberClaims, (tx) =>
        steps.streamActiveProof(tx, { ...active, userId: member.userId }),
      ),
    ).toBeUndefined();
    expect(
      await fixture.database.withTenant(memberClaims, (tx) =>
        runs.streamRegistryState(tx, scenario.failedRunId, member.userId),
      ),
    ).toMatchObject({ state: 'missing' });

    // Deny the viewer: every proof now rejects their claim too.
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: viewer.userId,
      setByUserId: owner.userId,
    });
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        steps.streamCommittedProof(tx, committed, committedEvent),
      ),
    ).toBeUndefined();
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        steps.streamTerminalProof(tx, terminal),
      ),
    ).toBeUndefined();
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        steps.streamActiveProof(tx, active),
      ),
    ).toBeUndefined();
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        runs.existsForAccessibleChat(tx, scenario.runId, viewer.userId),
      ),
    ).toBe(false);
    expect(
      await fixture.database.withTenant(viewerTenant, (tx) =>
        runs.authorizedChatSnapshot(tx, scenario.runId, viewer.userId),
      ),
    ).toBeNull();
  } finally {
    await app.close();
    await organizations.close();
    await fixture.close();
    await pools.close();
  }
});

test('title invalidation fan-out reaches every connected user who can read the chat and never a denied or non-member (content-free payload)', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-read-access-notify.json',
  );
  environment.AUTH_RATE_RULES_JSON = JSON.stringify(RATE_RULES);
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const pools = createPlatformPools(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const listener = createRoleClient(services.appUrl);
  const opened: Response[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const [owner, viewer, member] = await Promise.all([
      actor(app),
      actor(app),
      actor(app),
    ]);
    const team = await organizations.seedTeam([
      owner.userId,
      viewer.userId,
      member.userId,
    ]);
    for (const current of [owner, viewer, member])
      await switchOrg(origin, current.headers, team.id);
    const scenario = await seedAccessScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      editor: owner.userId,
      viewer: viewer.userId,
    });
    await listener.connect();
    await listener.query('LISTEN lexon_chat_title');
    const notifications: unknown[] = [];
    listener.on('notification', (message) => {
      try {
        notifications.push(JSON.parse(message.payload ?? ''));
      } catch {
        // Malformed payloads are caught by the shape assertion below.
        notifications.push(message.payload);
      }
    });

    const connect = (headers: Record<string, string>) =>
      fetch(`${origin}/api/chats/events`, { headers });
    const ownerStream = await connect(owner.headers);
    const viewerStream = await connect(viewer.headers);
    const memberStream = await connect(member.headers);
    opened.push(ownerStream, viewerStream, memberStream);
    expect(ownerStream.status).toBe(200);
    expect(viewerStream.status).toBe(200);
    expect(memberStream.status).toBe(200);
    const ownerReader = ownerStream.body!.getReader();
    const viewerReader = viewerStream.body!.getReader();
    const memberReader = memberStream.body!.getReader();
    await expect(readEvent(ownerReader)).resolves.toBe(': connected');
    await expect(readEvent(viewerReader)).resolves.toBe(': connected');
    await expect(readEvent(memberReader)).resolves.toBe(': connected');

    const rename = (title: string) =>
      fetch(`${origin}/api/chats/${scenario.projectChatId}`, {
        method: 'PATCH',
        headers: { ...owner.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    expect((await rename('project alpha renamed')).status).toBe(204);
    const expected = {
      version: 1,
      type: 'chat.invalidated',
      chatId: scenario.projectChatId,
    };
    expect(JSON.parse(await readEvent(ownerReader))).toEqual(expected);
    // The project member can read the chat — they receive the same event.
    expect(JSON.parse(await readEvent(viewerReader))).toEqual(expected);
    // The org member without project standing must not learn the chatId.
    await expectNoEvent(memberReader);
    // The notify payload itself is content-free: exactly {orgId, chatId}.
    const waitForNotify = async () => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const hit = notifications.find(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' &&
            item !== null &&
            (item as Record<string, unknown>).chatId === scenario.projectChatId,
        );
        if (hit) {
          expect(Object.keys(hit).sort()).toEqual(['chatId', 'orgId']);
          expect(hit.orgId).toBe(team.id);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('No lexon_chat_title notification observed');
    };
    await expect(waitForNotify()).resolves.toBeUndefined();

    // Deny the viewer: the next rename reaches the owner only.
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: viewer.userId,
      setByUserId: owner.userId,
    });
    expect((await rename('project alpha renamed again')).status).toBe(204);
    expect(JSON.parse(await readEvent(ownerReader))).toEqual(expected);
    await expectNoEvent(viewerReader);
    await expectNoEvent(memberReader);
    await Promise.all([
      ownerReader.cancel(),
      viewerReader.cancel(),
      memberReader.cancel(),
    ]);
  } finally {
    for (const response of opened)
      await response.body?.cancel().catch(() => {});
    await listener.end().catch(() => undefined);
    await app.close();
    await organizations.close();
    await pools.close();
  }
});
