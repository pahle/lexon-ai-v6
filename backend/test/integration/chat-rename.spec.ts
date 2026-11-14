import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { RenameChatInputSchema, UuidSchema } from '@lexon/contracts';
import { AuditService } from '../../src/modules/audit/audit.service.js';

test('chat rename route trims, limits and keeps owner and tenant authorization', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-chat-rename-health.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const foreign = await apiHeaders(app);
    const identityResponse = await fetch(`${origin}/api/identity`, {
      headers: owner,
    });
    const identity = (await identityResponse.json()) as {
      orgId?: string;
      userId?: string;
      organization?: { id: string };
      user?: { id: string };
    };
    const tenant = {
      orgId: identity.organization?.id ?? identity.orgId!,
      userId: identity.user?.id ?? identity.userId!,
    };
    const chatId = randomUUID();
    expect(UuidSchema.safeParse(chatId).success).toBe(true);
    expect(
      RenameChatInputSchema.safeParse({ title: 'Owner title' }).success,
    ).toBe(true);
    await fixture.chat.createFor(tenant, chatId, 'Original title');
    expect(
      (await fetch(`${origin}/api/chats/${chatId}`, { headers: owner })).status,
    ).toBe(200);

    const renamed = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Owner title' }),
    });
    expect(renamed.status, await renamed.clone().text()).toBe(204);
    const tree = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: owner,
    });
    expect((await tree.json()).title).toBe('Owner title');

    const boundaryTitle = 'B'.repeat(120);
    const boundary = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ title: boundaryTitle }),
    });
    expect(boundary.status, await boundary.clone().text()).toBe(204);

    const renameAudits = await fixture.inspect.query(
      `SELECT type,metadata FROM ops.audit_events
       WHERE type='chat.renamed.v1' AND metadata->>'chatId'=$1
       ORDER BY occurred_at,event_id`,
      [chatId],
    );
    expect(renameAudits.rows).toEqual([
      { type: 'chat.renamed.v1', metadata: { chatId } },
      { type: 'chat.renamed.v1', metadata: { chatId } },
    ]);
    expect(JSON.stringify(renameAudits.rows)).not.toContain('Owner title');
    expect(JSON.stringify(renameAudits.rows)).not.toContain(boundaryTitle);

    const tooLong = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...owner, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '😀'.repeat(121) }),
    });
    expect(tooLong.status).toBe(400);
    const unchanged = await fetch(`${origin}/api/chats/${chatId}`, {
      headers: owner,
    });
    expect((await unchanged.json()).title).toBe(boundaryTitle);

    const hidden = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...foreign, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Foreign title' }),
    });
    expect(hidden.status).toBe(404);
    const noSession = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: owner.origin! },
      body: JSON.stringify({ title: 'No session' }),
    });
    expect(noSession.status).toBe(401);
    expect(
      (
        await fixture.inspect.query(
          `SELECT event_id FROM ops.audit_events
           WHERE type='chat.renamed.v1' AND metadata->>'chatId'=$1`,
          [chatId],
        )
      ).rows,
    ).toHaveLength(2);
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('a rename audit append failure rolls the title change back', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(
        services,
        '/tmp/lexon-chat-rename-audit-health.json',
      ),
    ),
  );
  const fixture = await createChatFixture(services);
  let restoreAudit: (() => void) | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const identity = (await (
      await fetch(`${origin}/api/identity`, { headers })
    ).json()) as {
      orgId?: string;
      userId?: string;
      organization?: { id: string };
      user?: { id: string };
    };
    const tenant = {
      orgId: identity.organization?.id ?? identity.orgId!,
      userId: identity.user?.id ?? identity.userId!,
    };
    const chatId = randomUUID();
    await fixture.chat.createFor(tenant, chatId, 'Original title');

    const originalAppend = AuditService.prototype.append;
    const failure = vi
      .spyOn(AuditService.prototype, 'append')
      .mockImplementation(async function (this: AuditService, tx, event) {
        if (String(event.type) === 'chat.renamed.v1')
          throw new Error('injected rename audit failure');
        await originalAppend.call(this, tx, event);
      });
    restoreAudit = () => failure.mockRestore();

    const response = await fetch(`${origin}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated title' }),
    });
    expect(response.status).toBe(500);
    const tree = await fetch(`${origin}/api/chats/${chatId}`, { headers });
    expect((await tree.json()).title).toBe('Original title');
    expect(
      (
        await fixture.inspect.query(
          `SELECT event_id FROM ops.audit_events
           WHERE type='chat.renamed.v1' AND metadata->>'chatId'=$1`,
          [chatId],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    restoreAudit?.();
    await app.close();
    await fixture.close();
  }
});
