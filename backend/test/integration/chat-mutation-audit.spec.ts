import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import type { FileServices } from '../setup/provided-context.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';

async function assertSqlAuditAdmission(
  services: FileServices,
  type: string,
  metadata: Record<string, string>,
) {
  const fixture = await createChatFixture(services);
  try {
    const actorUserId = randomUUID();
    const orgId = randomUUID();
    await fixture.inspect.query(
      `INSERT INTO ops.audit_events
       (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
       VALUES($1,1,$2,clock_timestamp(),'success',$3,$4,$5::jsonb)`,
      [randomUUID(), type, actorUserId, orgId, JSON.stringify(metadata)],
    );
  } finally {
    await fixture.close();
  }
}

test('PostgreSQL audit trigger admits chat.renamed.v1 with IDs only', async ({
  services,
}) => {
  await assertSqlAuditAdmission(services, 'chat.renamed.v1', {
    chatId: randomUUID(),
  });
});

test('PostgreSQL audit trigger admits chat.message_edited.v1 with IDs only', async ({
  services,
}) => {
  await assertSqlAuditAdmission(services, 'chat.message_edited.v1', {
    chatId: randomUUID(),
    messageId: randomUUID(),
  });
});

test('PostgreSQL audit trigger admits chat.message_regenerated.v1 with IDs only', async ({
  services,
}) => {
  await assertSqlAuditAdmission(services, 'chat.message_regenerated.v1', {
    chatId: randomUUID(),
    messageId: randomUUID(),
  });
});

test('PostgreSQL audit trigger rejects title, prompt, and malformed IDs', async ({
  services,
}) => {
  const fixture = await createChatFixture(services);
  try {
    const actorUserId = randomUUID();
    const orgId = randomUUID();
    const chatId = randomUUID();
    for (const event of [
      {
        type: 'chat.renamed.v1',
        metadata: { chatId, title: 'Private title' },
      },
      {
        type: 'chat.message_edited.v1',
        metadata: { chatId, messageId: randomUUID(), text: 'Private prompt' },
      },
      {
        type: 'chat.message_regenerated.v1',
        metadata: { chatId, messageId: randomUUID(), prompt: 'Private prompt' },
      },
    ]) {
      await expect(
        fixture.inspect.query(
          `INSERT INTO ops.audit_events
           (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
           VALUES($1,1,$2,clock_timestamp(),'success',$3,$4,$5::jsonb)`,
          [
            randomUUID(),
            event.type,
            actorUserId,
            orgId,
            JSON.stringify(event.metadata),
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }

    for (const event of [
      { type: 'chat.renamed.v1', metadata: { chatId: 'not-a-uuid' } },
      {
        type: 'chat.message_edited.v1',
        metadata: { chatId, messageId: 'not-a-uuid' },
      },
      {
        type: 'chat.message_regenerated.v1',
        metadata: { chatId, messageId: 'not-a-uuid' },
      },
    ]) {
      await expect(
        fixture.inspect.query(
          `INSERT INTO ops.audit_events
           (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
           VALUES($1,1,$2,clock_timestamp(),'success',$3,$4,$5::jsonb)`,
          [
            randomUUID(),
            event.type,
            actorUserId,
            orgId,
            JSON.stringify(event.metadata),
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  } finally {
    await fixture.close();
  }
});
