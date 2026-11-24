import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { OperationDecisionResultSchema } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import type { INestApplication } from '@nestjs/common';
import {
  TenantDatabase,
  AiRunRepository,
  AiStepRepository,
  AiOperationRepository,
  hashOperationArgs,
  requireSession,
} from '../../src/infrastructure/db/index.js';

// §6.4 owner ruling A: a send while a panel is open resolves the paused
// operation in ONE tenant tx (op CAS -> settle leftovers -> supersede audit ->
// run completed + run_finished audit -> store message -> new run queued), then
// the normal send path continues. A lost op CAS falls through to the normal
// "one active answer" CHAT_CONFLICT.

const questionArgs = {
  questions: [
    {
      questionId: 'q1',
      text: 'Which filing deadline applies?',
      kind: 'single',
      options: [{ label: '30 days' }, { label: '60 days' }],
    },
    {
      questionId: 'q2',
      text: 'Which documents are available?',
      kind: 'multiple',
      options: [
        { label: 'Contract' },
        { label: 'Addendum' },
        { label: 'Correspondence' },
      ],
    },
    {
      questionId: 'q3',
      text: 'Any additional context?',
      kind: 'text',
    },
  ],
};

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

type Fixture = Awaited<ReturnType<typeof createChatFixture>>;

async function countQuery(
  fixture: Fixture,
  text: string,
  values: readonly unknown[],
): Promise<number> {
  const result = await fixture.inspect.query(text, values);
  return (result.rows[0] as { count: number }).count;
}

async function operationRows(fixture: Fixture, runId: string) {
  const result = await fixture.inspect.query(
    `SELECT id::text AS id,status::text,decision::text,result,kind::text,
            tool_name,decision_by_user_id::text,
            completed_at IS NOT NULL AS completed,expires_at IS NULL AS expiry_cleared
       FROM app.ai_operations WHERE run_id=$1 ORDER BY call_occurrence`,
    [runId],
  );
  return result.rows as {
    id: string;
    status: string;
    decision: string | null;
    result: unknown;
    kind: string;
    tool_name: string;
    decision_by_user_id: string | null;
    completed: boolean;
    expiry_cleared: boolean;
  }[];
}

/** Same paused-run seed as operation-decision.spec.ts (see §6.4 fixture note). */
async function seedPausedRun(
  app: INestApplication,
  headers: Record<string, string>,
  options: {
    kind: 'approval' | 'question';
    args?: unknown;
    pendingOps?: number;
  },
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
    assistantMessageId: string;
    runId: string;
  };
  const tenant = await identityOf(origin, headers);
  const args =
    options.args ?? (options.kind === 'question' ? questionArgs : approvalArgs);
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
      // Step claims carry a fencing token; a seeded step starts at fence 0.
      await client.query(
        `UPDATE app.ai_steps SET state='awaiting_approval', fence=fence+1
         WHERE id=$1`,
        [step.id],
      );
      const snapshotHash = createHash('sha256')
        .update(`paused-${options.kind}-${randomUUID()}`)
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
        toolName: options.kind === 'question' ? 'ask_user' : 'rename_chat',
        toolVersion: 1,
        mode: 'transactional',
        args,
        argsHash: hashOperationArgs(args),
        snapshotHash,
        approvalRequired: true,
        kind: options.kind,
      });
      for (let index = 0; index < (options.pendingOps ?? 0); index += 1) {
        const pendingArgs = { read: `leftover-${index}` };
        await operations.persist(tx, claim, {
          callOccurrence: index + 1,
          toolName: 'fixture-read',
          toolVersion: 1,
          mode: 'read',
          args: pendingArgs,
          argsHash: hashOperationArgs(pendingArgs),
          snapshotHash: createHash('sha256')
            .update(`pending-${randomUUID()}`)
            .digest('hex'),
          approvalRequired: false,
        });
      }
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

function sendMessage(
  origin: string,
  headers: Record<string, string>,
  chatId: string,
  body: Record<string, unknown>,
) {
  return fetch(`${origin}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function decideCall(
  origin: string,
  headers: Record<string, string>,
  runId: string,
  operationId: string,
  body: unknown,
) {
  return fetch(
    `${origin}/api/runs/${runId}/operations/${operationId}/decision`,
    {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

async function runRecord(
  app: INestApplication,
  tenant: { orgId: string; userId: string },
  runId: string,
) {
  return app.get(TenantDatabase).withTenant(tenant, async (tx) => {
    const run = await new AiRunRepository().find(tx, runId);
    return run
      ? {
          status: run.status,
          runVersion: run.runVersion,
          partialOutput: run.partialOutput,
          finalOutput: run.finalOutput,
        }
      : null;
  });
}

async function activeAnswer(fixture: Fixture, chatId: string) {
  return (await fixture.inspect.chat(chatId)) as {
    active_answer_run_id: string | null;
  } | null;
}

test('send while a question panel is open dismisses the call, completes the run and starts a new one', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-send-paused-1.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  const audit = createAuditInspector(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, { kind: 'question' });
    const finishedBefore = await audit.count('chat.run_finished.v1');
    const questionBefore = await audit.count('chat.question_decided.v1');

    const response = await sendMessage(origin, headers, seeded.chatId, {
      userMessageId: randomUUID(),
      parentMessageId: seeded.assistantMessageId,
      text: 'Never mind — different question',
      effort: 'max',
    });
    expect(response.status).toBe(201);
    const mutation = (await response.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    expect(mutation.runId).not.toBe(seeded.runId);

    // The question call recorded the in-chat answer for every question.
    const operations = await operationRows(fixture, seeded.runId);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: seeded.operationId,
      status: 'dismissed',
      decision: 'dismiss',
      decision_by_user_id: seeded.tenant.userId,
      result: { answered_in_chat: true },
      completed: true,
      expiry_cleared: true,
    });
    // The dead run is completed with its partial text kept — no resume.
    const dead = await runRecord(app, seeded.tenant, seeded.runId);
    expect(dead).toMatchObject({ status: 'completed' });
    expect(dead!.finalOutput).toBe(dead!.partialOutput);
    expect(
      await countQuery(
        fixture,
        `SELECT count(*)::int AS count FROM ops.outbox
         WHERE type='run.resume.v1' AND payload->>'runId'=$1`,
        [seeded.runId],
      ),
    ).toBe(0);
    // Supersede audit rows: decided event with reason + terminal run_finished.
    const decidedRows = await fixture.inspect.query(
      `SELECT metadata->>'status' AS status,metadata->>'reason' AS reason,
              outcome,actor_user_id::text AS actor
         FROM ops.audit_events
        WHERE type='chat.question_decided.v1' AND metadata->>'operationId'=$1`,
      [seeded.operationId],
    );
    expect(decidedRows.rows).toEqual([
      {
        status: 'dismissed',
        reason: 'superseded_by_message',
        outcome: 'success',
        actor: seeded.tenant.userId,
      },
    ]);
    expect(await audit.count('chat.question_decided.v1')).toBe(
      questionBefore + 1,
    );
    const finishedRows = await fixture.inspect.query(
      `SELECT metadata->>'status' AS status,outcome
         FROM ops.audit_events
        WHERE type='chat.run_finished.v1' AND metadata->>'runId'=$1`,
      [seeded.runId],
    );
    expect(finishedRows.rows).toEqual([
      { status: 'completed', outcome: 'success' },
    ]);
    expect(await audit.count('chat.run_finished.v1')).toBe(finishedBefore + 1);
    // The new run is queued, linked and holds the chat's active pointer.
    expect(await runRecord(app, seeded.tenant, mutation.runId)).toMatchObject({
      status: 'queued',
    });
    expect(await activeAnswer(fixture, seeded.chatId)).toMatchObject({
      active_answer_run_id: mutation.runId,
    });
    expect(
      await countQuery(
        fixture,
        `SELECT count(*)::int AS count FROM ops.outbox
         WHERE type='run.start.v1' AND payload->>'runId'=$1`,
        [mutation.runId],
      ),
    ).toBe(1);
    const snapshot = await fixture.inspect.chatSendSnapshot(seeded.chatId);
    expect(snapshot).toMatchObject({
      messages: '4',
      answers: '2',
      runs: '2',
      message_audit: '2',
    });
  } finally {
    await app.close();
    await fixture.close();
    await audit.close();
  }
});

test('send while an approval panel is open rejects the call with {denied:superseded} and the rename never runs', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-send-paused-2.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  const audit = createAuditInspector(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, {
      kind: 'approval',
      pendingOps: 2,
    });
    const finishedBefore = await audit.count('chat.run_finished.v1');

    const response = await sendMessage(origin, headers, seeded.chatId, {
      userMessageId: randomUUID(),
      parentMessageId: seeded.assistantMessageId,
      text: 'Skip that — send this instead',
      effort: 'high',
    });
    expect(response.status).toBe(201);
    const mutation = (await response.json()) as { runId: string };

    const operations = await operationRows(fixture, seeded.runId);
    expect(operations).toHaveLength(3);
    expect(operations[0]).toMatchObject({
      id: seeded.operationId,
      status: 'rejected',
      decision: 'reject',
      decision_by_user_id: seeded.tenant.userId,
      result: { denied: 'superseded' },
      completed: true,
      expiry_cleared: true,
    });
    // Leftover pending read ops settle failed + {not_run:'superseded_by_message'}
    // with NO decision columns.
    for (const leftover of operations.slice(1)) {
      expect(leftover).toMatchObject({
        tool_name: 'fixture-read',
        status: 'failed',
        decision: null,
        decision_by_user_id: null,
        result: { not_run: 'superseded_by_message' },
        completed: true,
        expiry_cleared: true,
      });
    }
    expect(await runRecord(app, seeded.tenant, seeded.runId)).toMatchObject({
      status: 'completed',
    });
    const decidedRows = await fixture.inspect.query(
      `SELECT metadata->>'status' AS status,metadata->>'reason' AS reason
         FROM ops.audit_events
        WHERE type='chat.approval_decided.v1' AND metadata->>'operationId'=$1`,
      [seeded.operationId],
    );
    expect(decidedRows.rows).toEqual([
      { status: 'rejected', reason: 'superseded_by_message' },
    ]);
    expect(await audit.count('chat.run_finished.v1')).toBe(finishedBefore + 1);
    // The rename never ran: the chat keeps the seeded title.
    const chat = await activeAnswer(fixture, seeded.chatId);
    expect(chat).toMatchObject({ active_answer_run_id: mutation.runId });
    const title = await fixture.inspect.query(
      `SELECT title FROM app.chats WHERE id=$1`,
      [seeded.chatId],
    );
    expect((title.rows[0] as { title: string }).title).not.toBe(
      approvalArgs.newTitle,
    );
  } finally {
    await app.close();
    await fixture.close();
    await audit.close();
  }
});

test('a decided operation makes the send fall through to CHAT_CONFLICT; a losing decide still returns the stored outcome', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-send-paused-3.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);

    // Interleaving A: the decision lands first — the send sees a resumed
    // (still active) run and gets today's normal CHAT_CONFLICT.
    const first = await seedPausedRun(app, headers, { kind: 'approval' });
    const decided = await decideCall(
      origin,
      headers,
      first.runId,
      first.operationId,
      { snapshotHash: first.snapshotHash, action: 'approve' },
    );
    expect(decided.status).toBe(200);
    const blocked = await sendMessage(origin, headers, first.chatId, {
      userMessageId: randomUUID(),
      parentMessageId: first.assistantMessageId,
      text: 'Too late',
      effort: 'high',
    });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe('CHAT_CONFLICT');
    expect(await runRecord(app, first.tenant, first.runId)).toMatchObject({
      status: 'running',
    });

    // Interleaving B: the send lands first — the losing decide returns the
    // stored supersede outcome (idempotent 200).
    const second = await seedPausedRun(app, headers, { kind: 'approval' });
    const sent = await sendMessage(origin, headers, second.chatId, {
      userMessageId: randomUUID(),
      parentMessageId: second.assistantMessageId,
      text: 'I win',
      effort: 'high',
    });
    expect(sent.status).toBe(201);
    const losing = await decideCall(
      origin,
      headers,
      second.runId,
      second.operationId,
      { snapshotHash: second.snapshotHash, action: 'approve' },
    );
    expect(losing.status).toBe(200);
    const losingOutcome = OperationDecisionResultSchema.parse(
      await losing.json(),
    );
    expect(losingOutcome).toMatchObject({
      operationId: second.operationId,
      status: 'rejected',
      decision: 'reject',
    });
    const operations = await operationRows(fixture, second.runId);
    expect(operations[0]).toMatchObject({
      status: 'rejected',
      decision: 'reject',
      result: { denied: 'superseded' },
    });
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('approve + send raced concurrently have exactly one winner', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-send-paused-4.json',
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
    const seeded = await seedPausedRun(app, headers, { kind: 'approval' });

    const [decision, send] = await Promise.all([
      decideCall(origin, headers, seeded.runId, seeded.operationId, {
        snapshotHash: seeded.snapshotHash,
        action: 'approve',
      }).then(async (response) => ({
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      })),
      sendMessage(origin, headers, seeded.chatId, {
        userMessageId: randomUUID(),
        parentMessageId: seeded.assistantMessageId,
        text: 'Racing send',
        effort: 'high',
      }).then(async (response) => ({
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      })),
    ]);
    const operations = await operationRows(fixture, seeded.runId);
    const op = operations[0]!;
    const deadRun = await runRecord(app, seeded.tenant, seeded.runId);
    const resumeCount = await countQuery(
      fixture,
      `SELECT count(*)::int AS count FROM ops.outbox
       WHERE type='run.resume.v1' AND payload->>'runId'=$1`,
      [seeded.runId],
    );

    if (op.decision === 'approve') {
      // Decide won: approved op, run resuming, send conflicts, rename runs
      // at most once (single resume outbox).
      expect(decision.status).toBe(200);
      expect(decision.body).toMatchObject({
        operationId: seeded.operationId,
        status: 'approved',
        decision: 'approve',
      });
      expect(send.status).toBe(409);
      expect((send.body.error as { code: string }).code).toBe('CHAT_CONFLICT');
      expect(op.status).toBe('approved');
      expect(deadRun).toMatchObject({ status: 'running' });
      expect(resumeCount).toBe(1);
    } else {
      // Send won: superseded op, dead run completed, send 201, no resume.
      expect(op).toMatchObject({
        status: 'rejected',
        decision: 'reject',
        result: { denied: 'superseded' },
      });
      expect(decision.status).toBe(200);
      expect(decision.body).toMatchObject({
        operationId: seeded.operationId,
        status: 'rejected',
        decision: 'reject',
      });
      expect(send.status).toBe(201);
      expect(deadRun).toMatchObject({ status: 'completed' });
      expect(resumeCount).toBe(0);
      expect((send.body.runId as string) !== seeded.runId).toBe(true);
    }
  } finally {
    await app.close();
    await fixture.close();
  }
});
