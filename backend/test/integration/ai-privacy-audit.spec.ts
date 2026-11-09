import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { TenantDatabase } from '../../src/infrastructure/db/index.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import {
  AuditService,
  appendAuthAudit,
} from '../../src/modules/audit/index.js';

test('AI audit stores safe metadata transactionally and rejects prompt fields', async ({
  services,
}) => {
  const inspect = createAuditInspector(services);
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 5000,
  });
  const orgId = randomUUID();
  const actorUserId = randomUUID();
  const runId = randomUUID();
  const event = {
    version: 1 as const,
    eventId: randomUUID(),
    type: 'chat.run_started.v1' as const,
    occurredAt: new Date().toISOString(),
    outcome: 'success' as const,
    orgId,
    actorUserId,
    metadata: {
      runId,
      model: 'openai/gpt-6-luna',
      provider: 'azure/us',
      status: 'started' as const,
    },
  };
  const audit = new AuditService();
  try {
    const before = await inspect.count('chat.run_started.v1');
    await expect(
      db.withTenant({ orgId, userId: actorUserId }, async (tx) => {
        await audit.append(tx, event);
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await inspect.count('chat.run_started.v1')).toBe(before);

    await db.withTenant({ orgId, userId: actorUserId }, (tx) =>
      audit.append(tx, event),
    );
    expect(await inspect.count('chat.run_started.v1')).toBe(before + 1);
    await expect(
      db.withTenant({ orgId, userId: actorUserId }, (tx) =>
        audit.append(tx, {
          ...event,
          eventId: randomUUID(),
          metadata: { ...event.metadata, prompt: 'AUDIT_PROMPT_SENTINEL' },
        } as never),
      ),
    ).rejects.toThrow('Invalid audit event');
    const validToolMetadata = {
      runId,
      stepId: randomUUID(),
      operationId: randomUUID(),
      model: 'openai/gpt-6-luna',
      provider: 'azure/us',
      status: 'proposed',
    };
    for (const metadata of [
      { ...validToolMetadata, stepId: null },
      { ...validToolMetadata, operationId: null },
      { ...validToolMetadata, model: null },
      { ...validToolMetadata, provider: null },
      { ...validToolMetadata, model: 123 },
      { ...validToolMetadata, provider: true },
    ])
      await expect(
        inspect.appendDirect({
          eventId: randomUUID(),
          version: 1,
          type: 'chat.tool_operation.v1',
          occurredAt: new Date().toISOString(),
          outcome: 'success',
          orgId,
          actorUserId,
          metadata,
        }),
      ).rejects.toThrow('Invalid AI audit event');
  } finally {
    await Promise.all([inspect.close(), db.close()]);
  }
});

test('auth transaction writer cannot append AI audit authority', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    await expect(
      proof.integration.transaction((tx) =>
        appendAuthAudit(tx, {
          version: 1,
          eventId: randomUUID(),
          type: 'chat.run_started.v1',
          occurredAt: new Date().toISOString(),
          outcome: 'success',
          orgId: randomUUID(),
          actorUserId: randomUUID(),
          metadata: {
            runId: randomUUID(),
            model: 'openai/gpt-6-luna',
            provider: 'azure/us',
            status: 'started',
          },
        }),
      ),
    ).rejects.toThrow();
  } finally {
    await proof.close();
  }
});
