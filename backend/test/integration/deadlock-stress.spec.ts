import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import type { INestApplication } from '@nestjs/common';
import {
  TenantDatabase,
  AiRunRepository,
  AiStepRepository,
  AiOperationRepository,
  hashOperationArgs,
  requireSession,
} from '../../src/infrastructure/db/index.js';

const approvalArgs = { newTitle: 'Renamed while paused' };

async function identityOf(
  origin: string,
  headers: Record<string, string>,
): Promise<{ orgId: string; userId: string }> {
  const identity = (await (
    await fetch(`${origin}/api/identity`, { headers })
  ).json()) as { user: { id: string }; organization: { id: string } };
  return { orgId: identity.organization.id, userId: identity.user.id };
}

async function seedPausedRun(
  app: INestApplication,
  headers: Record<string, string>,
) {
  const origin = await app.getUrl();
  const chatId = randomUUID();
  const userMessageId = randomUUID();
  const created = await fetch(`${origin}/api/chats`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      chatId,
      userMessageId,
      requestId: randomUUID(),
      text: 'Paused send fixture',
      effort: 'high',
    }),
  });
  expect(created.status).toBe(201);
  const mutation = (await created.json()) as {
    runId: string;
    assistantMessageId: string;
  };
  const tenant = await identityOf(origin, headers);
  const operation = await app
    .get(TenantDatabase)
    .withTenant(tenant, async (tx) => {
      const runs = new AiRunRepository();
      const steps = new AiStepRepository();
      const operations = new AiOperationRepository();
      const step = await steps.find(tx, {
        runId: mutation.runId,
        sequence: 1,
      });
      if (!step) throw new Error('Fixture step missing');
      const { client } = requireSession(tx);
      await client.query(
        `UPDATE app.ai_steps SET state='awaiting_approval', fence=fence+1
         WHERE id=$1`,
        [step.id],
      );
      const snapshotHash = createHash('sha256')
        .update(`paused-${randomUUID()}`)
        .digest('hex');
      const claim = {
        runId: mutation.runId,
        orgId: tenant.orgId,
        userId: tenant.userId,
        stepId: step.id,
        sequence: 1,
        expectedVersion: step.expectedVersion,
        fence: step.fence + 1,
        leaseUntil: new Date(),
      };
      const persisted = await operations.persist(tx, claim, {
        callOccurrence: 0,
        toolName: 'rename_chat',
        toolVersion: 1,
        mode: 'transactional',
        args: approvalArgs,
        argsHash: hashOperationArgs(approvalArgs),
        snapshotHash,
        approvalRequired: true,
        kind: 'approval',
      });
      if (
        !(await runs.transition(tx, {
          runId: mutation.runId,
          expectedVersion: 1,
          from: 'queued',
          to: 'running',
        })) ||
        !(await runs.transition(tx, {
          runId: mutation.runId,
          expectedVersion: 2,
          from: 'running',
          to: 'awaiting_approval',
          nextSequence: 2,
        }))
      )
        throw new Error('Fixture run transition failed');
      return persisted;
    });
  return {
    chatId,
    userMessageId,
    assistantMessageId: mutation.assistantMessageId,
    runId: mutation.runId,
    operationId: operation.id,
    snapshotHash: operation.snapshotHash,
    tenant,
  };
}

test('raced decide + send never deadlocks (stress)', async ({ services }) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-deadlock-stress.json',
  );
  environment.AUTH_RATE_RULES_JSON = JSON.stringify({
    signup: { account: 4, ip: 10_000, windowSeconds: 600 },
    signin: { account: 8, ip: 10_000, windowSeconds: 60 },
    'verification-resend': { account: 4, ip: 10_000, windowSeconds: 600 },
  });
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const failures: string[] = [];
    const iterations = Number(process.env.STRESS_ITERATIONS ?? 60);
    for (let index = 0; index < iterations; index += 1) {
      const seeded = await seedPausedRun(app, headers);
      const [decision, send] = await Promise.all([
        fetch(
          `${origin}/api/runs/${seeded.runId}/operations/${seeded.operationId}/decision`,
          {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({
              snapshotHash: seeded.snapshotHash,
              action: 'approve',
            }),
          },
        ).then(async (response) => ({
          status: response.status,
          body: await response.text(),
        })),
        fetch(`${origin}/api/chats/${seeded.chatId}/messages`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            userMessageId: randomUUID(),
            parentMessageId: seeded.assistantMessageId,
            text: 'Racing send',
            effort: 'high',
          }),
        }).then(async (response) => ({
          status: response.status,
          body: await response.text(),
        })),
      ]);
      for (const [name, result] of [
        ['decision', decision],
        ['send', send],
      ] as const) {
        if (result.status === 500)
          failures.push(
            `iter ${index} ${name}: 500 ${result.body.slice(0, 200)}`,
          );
      }
      // Queued runs never drain in this api-only harness — wipe the org's
      // run + chat rows (migrator role bypasses RLS, FKs cascade) or the
      // 6-run org capacity check kills the next seed.
      await fixture.inspect.query(`DELETE FROM app.ai_runs WHERE org_id=$1`, [
        seeded.tenant.orgId,
      ]);
      await fixture.inspect.query(`DELETE FROM app.chats WHERE org_id=$1`, [
        seeded.tenant.orgId,
      ]);
    }
    expect(failures).toEqual([]);
  } finally {
    // fixture.close() ends the migrator inspector before the template DB
    // drops — otherwise its orphaned 'error' events surface as unhandled
    // test exceptions in CI.
    await fixture.close();
    await app.close();
  }
}, 600_000);
