import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { projectDeny } from '../../src/infrastructure/db/testing/project-fixture.js';
import { createTestApi } from '../setup/test-api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { securityHarness } from '../setup/security-harness.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { OrganizationSwitchService } from '../../src/modules/organizations/organization-switch.service.js';
import { ProjectPageSchema, ProjectSummarySchema } from '@lexon/contracts';

// F6 task 5: Matters CRUD + instructions over the 0043 access model —
// owner/editor/viewer roles gate writes, and every read path returns the
// identical 404 for nonexistent, non-member and denied targets.

const password = 'Projects-crud-42!';

const jsonHeaders = (cookieHeaders: Headers) => {
  const headers = new Headers(cookieHeaders);
  headers.set('content-type', 'application/json');
  // The request policy refuses cookie-authenticated writes without the
  // configured public origin (CSRF).
  headers.set('origin', 'http://localhost:3000');
  return headers;
};

async function boot(services: Parameters<typeof createAuthFixture>[0]) {
  const env = createAuthEnvironment(services, '/tmp/lexon-projects.json');
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  return { app, origin, env };
}

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

test('project create, list, detail, settings and instructions honor the access matrix', async ({
  services,
}) => {
  const { app, origin, env } = await boot(services);
  const proof = await createAuthFixture(services, {
    secret: env.AUTH_SECRET,
  });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const [owner, editor, member, outsider] = await Promise.all(
      ['Owner', 'Editor', 'Member', 'Outsider'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([
      owner.userId,
      editor.userId,
      member.userId,
    ]);
    for (const user of [owner, editor, member])
      await activate(proof, user, team.id);

    const create = await fetch(`${origin}/api/projects`, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({
        name: 'Acme v. Globex',
        matterNumber: 'M-2026-01',
        practiceArea: 'litigation',
      }),
    });
    if (create.status !== 201)
      console.log('CREATE-ERR', await create.clone().text());
    expect(create.status).toBe(201);
    const created = ProjectSummarySchema.parse(await create.json());
    expect(created).toMatchObject({
      name: 'Acme v. Globex',
      matterNumber: 'M-2026-01',
      practiceArea: 'litigation',
      myRole: 'owner',
      memberCount: 0,
      chatCount: 0,
    });
    expect(created.owner.userId).toBe(owner.userId);

    // The project lives under the caller's active org: member management
    // and denies target users of the same organization.
    const addEditor = await fetch(
      `${origin}/api/projects/${created.id}/members`,
      {
        method: 'POST',
        headers: jsonHeaders(owner.cookieHeaders),
        body: JSON.stringify({ userId: editor.userId, role: 'editor' }),
      },
    );
    expect(addEditor.status).toBe(201);

    const list = await fetch(`${origin}/api/projects?sort=activity&limit=5`, {
      headers: owner.cookieHeaders,
    });
    expect(list.status).toBe(200);
    const page = ProjectPageSchema.parse(await list.json());
    expect(page.items.map((item) => item.id)).toContain(created.id);
    expect(
      page.pageInfo.nextCursor === null ||
        typeof page.pageInfo.nextCursor === 'string',
    ).toBe(true);

    const detail = await fetch(`${origin}/api/projects/${created.id}`, {
      headers: editor.cookieHeaders,
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as Record<string, unknown>;
    expect(detailBody.instructions).toBeNull();
    expect(detailBody.myRole).toBe('editor');

    // Editor may write instructions; viewer may not; non-member 404s.
    const instructions = await fetch(
      `${origin}/api/projects/${created.id}/instructions`,
      {
        method: 'PATCH',
        headers: jsonHeaders(editor.cookieHeaders),
        body: JSON.stringify({ instructions: 'Serve within 30 days.' }),
      },
    );
    expect(instructions.status).toBe(200);

    const detailAfter = await fetch(`${origin}/api/projects/${created.id}`, {
      headers: owner.cookieHeaders,
    });
    expect((await detailAfter.json()).instructions).toBe(
      'Serve within 30 days.',
    );

    const memberInstructions = await fetch(
      `${origin}/api/projects/${created.id}/instructions`,
      {
        method: 'PATCH',
        headers: jsonHeaders(member.cookieHeaders),
        body: JSON.stringify({ instructions: 'nope' }),
      },
    );
    expect(memberInstructions.status).toBe(404);

    const outsiderDetail = await fetch(`${origin}/api/projects/${created.id}`, {
      headers: outsider.cookieHeaders,
    });
    expect(outsiderDetail.status).toBe(404);
    const ghostDetail = await fetch(`${origin}/api/projects/${randomUUID()}`, {
      headers: outsider.cookieHeaders,
    });
    expect(ghostDetail.status).toBe(404);

    // Settings: owner only; editor gets 403, non-member gets the same 404.
    const editorSettings = await fetch(`${origin}/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(editor.cookieHeaders),
      body: JSON.stringify({ matterNumber: 'M-2026-02' }),
    });
    expect(editorSettings.status).toBe(403);
    const ownerSettings = await fetch(`${origin}/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ matterNumber: 'M-2026-02' }),
    });
    expect(ownerSettings.status).toBe(200);
    expect((await ownerSettings.json()).matterNumber).toBe('M-2026-02');
  } finally {
    await pools.close();
    await app.close();
  }
});

test('denied members get the identical 404 on every project read route', async ({
  services,
}) => {
  const { app, origin, env } = await boot(services);
  const proof = await createAuthFixture(services, {
    secret: env.AUTH_SECRET,
  });
  const organizations = createOrganizationInspector(services);
  const pools = createPlatformPools(services);
  try {
    const [owner, member] = await Promise.all(
      ['Owner', 'Member'].map((name) =>
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
      body: JSON.stringify({ name: 'Walled matter' }),
    });
    const project = (await create.json()) as { id: string };
    const add = await fetch(`${origin}/api/projects/${project.id}/members`, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ userId: member.userId, role: 'viewer' }),
    });
    expect(add.status).toBe(201);
    // Member can read until the deny lands.
    expect(
      (
        await fetch(`${origin}/api/projects/${project.id}`, {
          headers: member.cookieHeaders,
        })
      ).status,
    ).toBe(200);
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: project.id,
      userId: member.userId,
      setByUserId: owner.userId,
    });
    const paths = [
      `/api/projects/${project.id}`,
      `/api/projects/${project.id}/chats`,
      `/api/projects/${project.id}/members`,
      `/api/projects/${project.id}/instructions`,
    ];
    for (const path of paths) {
      const read = await fetch(`${origin}${path}`, {
        headers: member.cookieHeaders,
      });
      const write = await fetch(`${origin}${path}`, {
        method: 'PATCH',
        headers: jsonHeaders(member.cookieHeaders),
        body: JSON.stringify({}),
      });
      expect(read.status).toBe(404);
      expect(write.status).toBe(404);
    }
    // Nonexistent project returns the same 404 byte-shape.
    const ghost = await fetch(`${origin}/api/projects/${randomUUID()}`, {
      headers: member.cookieHeaders,
    });
    expect(ghost.status).toBe(404);
    const deniedBody = (await (
      await fetch(`${origin}/api/projects/${project.id}`, {
        headers: member.cookieHeaders,
      })
    ).json()) as Record<string, unknown>;
    const ghostBody = (await ghost.json()) as Record<string, unknown>;
    // Identical 404 shape — only the per-request id may differ.
    expect({ ...deniedBody, requestId: '' }).toEqual({
      ...ghostBody,
      requestId: '',
    });
  } finally {
    await pools.close();
    await app.close();
  }
});
