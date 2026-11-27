import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import {
  projectDeny,
  projectMemberRemove,
} from '../../src/infrastructure/db/testing/project-fixture.js';

// F6 §5 rows 1/3/4: the sidebar/own-chats list and FTS keep the OwnedChat
// scope — `owner AND (project_id IS NULL OR lexon_project_access<>'none')` —
// so a denied or removed member loses their own project chats everywhere, a
// member never sees another's chats in search, and resolveMatch answers the
// identical 404 to a caller without owner standing on the chat.

interface Actor {
  readonly headers: Record<string, string>;
  readonly userId: string;
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
  ).json()) as { user: { id: string } };
  return { headers, userId: identity.user.id } satisfies Actor;
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

/** Seeds a project with member rows plus owner/viewer project chats whose
 * titles and message bodies all carry the same search needle. Everything is
 * written as lexon_migrator with the chat-owner claim bound for the write
 * fence (project-fixture pattern). */
async function seedSearchScenario(
  pools: ReturnType<typeof createPlatformPools>,
  input: {
    orgId: string;
    owner: string;
    viewer: string;
  },
) {
  const scenario = {
    projectId: randomUUID(),
    projectChatId: randomUUID(),
    standaloneChatId: randomUUID(),
    viewerChatId: randomUUID(),
    projectMessageId: randomUUID(),
    standaloneMessageId: randomUUID(),
    viewerMessageId: randomUUID(),
  };
  const migrator = await pools.migrator.connect();
  try {
    await migrator.query('BEGIN');
    await migrator.query(`SELECT set_config('app.user_id',$1,true)`, [
      input.owner,
    ]);
    await migrator.query(
      `INSERT INTO app.projects(id,org_id,owner_user_id,name,matter_number,practice_area)
       VALUES ($1,$2,$3,'Search matter','F6-099','litigation')`,
      [scenario.projectId, input.orgId, input.owner],
    );
    await migrator.query(
      `INSERT INTO app.project_members(org_id,project_id,user_id,role)
       VALUES ($1,$2,$3,'viewer')`,
      [input.orgId, scenario.projectId, input.viewer],
    );
    await migrator.query(
      `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id) VALUES
       ($1,$2,$3,'meridian alpha project',$4),
       ($5,$2,$3,'meridian alpha standalone',NULL),
       ($6,$2,$7,'meridian alpha member',$4)`,
      [
        scenario.projectChatId,
        input.orgId,
        input.owner,
        scenario.projectId,
        scenario.standaloneChatId,
        scenario.viewerChatId,
        input.viewer,
      ],
    );
    await migrator.query(
      `INSERT INTO app.chat_messages(id,org_id,chat_id,parent_message_id,role,user_text,effort)
       VALUES
       ($1,$2,$3,NULL,'user','meridian alpha project question','high'),
       ($4,$2,$5,NULL,'user','meridian alpha standalone question','high'),
       ($6,$2,$7,NULL,'user','meridian alpha member question','high')`,
      [
        scenario.projectMessageId,
        input.orgId,
        scenario.projectChatId,
        scenario.standaloneMessageId,
        scenario.standaloneChatId,
        scenario.viewerMessageId,
        scenario.viewerChatId,
      ],
    );
    await migrator.query('COMMIT');
    return scenario;
  } catch (error) {
    await migrator.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    migrator.release();
  }
}

test('FTS stays owner-scoped: denied or removed owners lose hits on their own project chats and members never see foreign chats', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-search-access-fts.json',
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
    const scenario = await seedSearchScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      viewer: viewer.userId,
    });
    const search = async (headers: Record<string, string>) => {
      const response = await fetch(`${origin}/api/chats/search`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'meridian alpha' }),
      });
      expect(response.status).toBe(200);
      return (
        (await response.json()) as { items: { chatId: string }[] }
      ).items.map((item) => item.chatId);
    };
    // Owner: own project + standalone chats match; the member's chat never
    // appears because FTS stays owner-scoped.
    const ownerHits = await search(owner.headers);
    expect(ownerHits).toContain(scenario.projectChatId);
    expect(ownerHits).toContain(scenario.standaloneChatId);
    expect(ownerHits).not.toContain(scenario.viewerChatId);
    // Member: only their own project chat matches — never the owner's.
    const viewerHits = await search(viewer.headers);
    expect(viewerHits).toEqual([scenario.viewerChatId]);
    // Deny the owner: their own project chat disappears from their own
    // search while the standalone hit survives (deny is per-project).
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: owner.userId,
      setByUserId: owner.userId,
    });
    const deniedHits = await search(owner.headers);
    expect(deniedHits).not.toContain(scenario.projectChatId);
    expect(deniedHits).toContain(scenario.standaloneChatId);
    // Remove the member's project_members row (no deny): their own project
    // chat loses all hits — the owner arm gives nothing on a project chat.
    await projectMemberRemove(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: viewer.userId,
    });
    expect(await search(viewer.headers)).toEqual([]);
  } finally {
    await app.close();
    await organizations.close();
    await pools.close();
  }
});

test('resolveMatch returns the identical 404 to denied owners and non-owner readers and still resolves for the owner', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-search-access-resolve.json',
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
    const scenario = await seedSearchScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      viewer: viewer.userId,
    });
    const resolve = (headers: Record<string, string>, chatId: string) =>
      fetch(
        `${origin}/api/chats/${chatId}/search-match/${scenario.projectMessageId}`,
        { method: 'POST', headers },
      );
    // The owner resolves a match on their own project chat (POST → 201).
    const resolved = await resolve(owner.headers, scenario.projectChatId);
    expect(resolved.status).toBe(201);
    const baseline = await capture(await resolve(owner.headers, randomUUID()));
    expect(baseline.status).toBe(404);
    // A project member can read the chat but resolveMatch stays owner+access
    // scope — the identical 404.
    expect(
      await capture(await resolve(viewer.headers, scenario.projectChatId)),
    ).toEqual(baseline);
    // A denied owner loses their own project chat on resolveMatch too.
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: owner.userId,
      setByUserId: owner.userId,
    });
    expect(
      await capture(await resolve(owner.headers, scenario.projectChatId)),
    ).toEqual(baseline);
  } finally {
    await app.close();
    await organizations.close();
    await pools.close();
  }
});

test('the own-chats list drops denied project chats and scope=shared never lists project chats', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-chat-search-access-list.json',
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
    const scenario = await seedSearchScenario(pools, {
      orgId: team.id,
      owner: owner.userId,
      viewer: viewer.userId,
    });
    const list = async (headers: Record<string, string>, query = '') => {
      const response = await fetch(`${origin}/api/chats${query}`, { headers });
      expect(response.status).toBe(200);
      return (await response.json()) as {
        items: { id: string; projectName?: string }[];
      };
    };
    const ownerList = await list(owner.headers);
    const byId = new Map(ownerList.items.map((item) => [item.id, item]));
    // Own project chat carries the project name as secondary text; the
    // standalone row does not. Foreign project chats never appear.
    expect(byId.get(scenario.projectChatId)?.projectName).toBe('Search matter');
    expect(byId.get(scenario.standaloneChatId)?.projectName).toBeUndefined();
    expect(byId.get(scenario.viewerChatId)).toBeUndefined();
    // scope=shared is the chat_shares arm only — the member's own project
    // chat and the owner's chats can never appear there.
    const sharedList = await list(viewer.headers, '?scope=shared');
    expect(sharedList.items).toHaveLength(0);
    // Deny the owner: their own project chat vanishes from their list; the
    // standalone chat stays.
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: owner.userId,
      setByUserId: owner.userId,
    });
    const deniedIds = (await list(owner.headers)).items.map((item) => item.id);
    expect(deniedIds).not.toContain(scenario.projectChatId);
    expect(deniedIds).toContain(scenario.standaloneChatId);
    // The member's removed-from-project own chat vanishes from their list.
    await projectMemberRemove(pools.migrator, {
      orgId: team.id,
      projectId: scenario.projectId,
      userId: viewer.userId,
    });
    const removedIds = (await list(viewer.headers)).items.map(
      (item) => item.id,
    );
    expect(removedIds).not.toContain(scenario.viewerChatId);
  } finally {
    await app.close();
    await organizations.close();
    await pools.close();
  }
});
