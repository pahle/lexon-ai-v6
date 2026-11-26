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
import {
  OrgMemberSearchResultSchema,
  ProjectMemberSummarySchema,
} from '@lexon/contracts';

// F6 task 5: project member management — owner-only writes, target must be
// an org member and not denied, and every mutation emits the access-change
// invalidation to the affected user on the same notification mechanism.

const password = 'Project-members-42!';

const jsonHeaders = (cookieHeaders: Headers) => {
  const headers = new Headers(cookieHeaders);
  headers.set('content-type', 'application/json');
  // The request policy refuses cookie-authenticated writes without the
  // configured public origin (CSRF).
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

test('member add, role change and remove enforce owner-only writes and emit access-change invalidations', async ({
  services,
}) => {
  const env = createAuthEnvironment(
    services,
    '/tmp/lexon-project-members.json',
  );
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
      body: JSON.stringify({ name: 'Members matter' }),
    });
    const project = (await create.json()) as { id: string };
    const membersUrl = `${origin}/api/projects/${project.id}/members`;

    // Owner adds editor — 201 + member summary (name/email via the org port).
    const add = await fetch(membersUrl, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ userId: editor.userId, role: 'editor' }),
    });
    expect(add.status).toBe(201);
    const added = ProjectMemberSummarySchema.parse(await add.json());
    expect(added).toMatchObject({
      userId: editor.userId,
      role: 'editor',
    });

    // Non-owner cannot mutate membership: editor adding member → 403.
    const forbidden = await fetch(membersUrl, {
      method: 'POST',
      headers: jsonHeaders(editor.cookieHeaders),
      body: JSON.stringify({ userId: member.userId, role: 'viewer' }),
    });
    expect(forbidden.status).toBe(403);

    // Targets outside the org are refused; denied targets are refused.
    const nonMember = await fetch(membersUrl, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ userId: outsider.userId, role: 'viewer' }),
    });
    expect(nonMember.status).toBe(422);
    await projectDeny(pools.migrator, {
      orgId: team.id,
      projectId: project.id,
      userId: member.userId,
      setByUserId: owner.userId,
    });
    const denied = await fetch(membersUrl, {
      method: 'POST',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ userId: member.userId, role: 'viewer' }),
    });
    expect(denied.status).toBe(422);

    // Role change owner→viewer? owner is never a member row: PATCH on owner
    // is a no-op 404; editor demoted to viewer succeeds.
    const demoteOwner = await fetch(`${membersUrl}/${owner.userId}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(demoteOwner.status).toBe(404);
    const demote = await fetch(`${membersUrl}/${editor.userId}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.cookieHeaders),
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(demote.status).toBe(200);

    // List shows current members.
    const list = await fetch(membersUrl, {
      headers: owner.cookieHeaders,
    });
    const listed = (await list.json()) as {
      items: Array<{ userId: string; role: string }>;
    };
    expect(listed.items).toEqual([
      expect.objectContaining({ userId: editor.userId, role: 'viewer' }),
    ]);

    // Removal emits chat.invalidated to the removed member's live stream.
    const stream = await fetch(`${origin}/api/chats/events`, {
      headers: editor.cookieHeaders,
    });
    opened.push(stream);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    const readEvent = () =>
      Promise.race([
        (async () => {
          let text = '';
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
            4000,
          );
          timeout.unref();
        }),
      ]);
    expect(await readEvent()).toBe(': connected');
    const remove = await fetch(`${membersUrl}/${editor.userId}`, {
      method: 'DELETE',
      headers: jsonHeaders(owner.cookieHeaders),
    });
    expect(remove.status).toBe(204);
    const event = JSON.parse(await readEvent()) as Record<string, unknown>;
    expect(event).toEqual({
      version: 1,
      type: 'chat.invalidated',
      chatId: null,
    });
    // Removed member now 404s on the project.
    const gone = await fetch(`${origin}/api/projects/${project.id}`, {
      headers: editor.cookieHeaders,
    });
    expect(gone.status).toBe(404);
  } finally {
    for (const response of opened)
      await response.body?.cancel().catch(() => undefined);
    await pools.close();
    await app.close();
  }
});

test('org member search returns picker rows for the member-add target', async ({
  services,
}) => {
  const env = createAuthEnvironment(services, '/tmp/lexon-member-search.json');
  const app = await createTestApi(loadRuntimeConfig('api', env));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const proof = await createAuthFixture(services, {
    secret: env.AUTH_SECRET,
  });
  const organizations = createOrganizationInspector(services);
  try {
    const [owner, member] = await Promise.all(
      ['Matter Owner', 'Matter Member'].map((name) =>
        proof.signIn({
          body: { name, email: `${randomUUID()}@example.test`, password },
        }),
      ),
    );
    const team = await organizations.seedTeam([owner.userId, member.userId]);
    for (const user of [owner, member]) await activate(proof, user, team.id);
    const response = await fetch(`${origin}/api/org/members/search?q=Matter`, {
      headers: owner.cookieHeaders,
    });
    expect(response.status).toBe(200);
    const result = OrgMemberSearchResultSchema.parse(await response.json());
    expect(result.items.map((item) => item.userId)).toEqual(
      expect.arrayContaining([owner.userId, member.userId]),
    );
  } finally {
    await app.close();
  }
});
