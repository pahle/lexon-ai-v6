import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { OperationDecisionResultSchema } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { totpForUri } from '../setup/totp.js';
import type { INestApplication } from '@nestjs/common';
import {
  TenantDatabase,
  AiRunRepository,
  AiStepRepository,
  AiOperationRepository,
  hashOperationArgs,
  requireSession,
} from '../../src/infrastructure/db/index.js';

// §6.3 owner-only decision route: POST /api/runs/:runId/operations/:opId/decision
// resolves chat -> run -> op in one tenant tx; non-owners get the identical
// random-id 404; decisions are idempotent on the operation id.

const PASSWORD = 'Authenticated-test-api-42!';

const questionArgs = {
  questions: [
    {
      questionId: 'q1',
      text: 'Which filing deadline applies?',
      kind: 'single',
      options: [{ label: '30 days' }, { label: '60 days' }],
      allowFreeText: false,
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

const approvalArgs = { newTitle: 'Renamed by approval' };

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

async function operationRow(fixture: Fixture, operationId: string) {
  const result = await fixture.inspect.query(
    `SELECT status::text,decision::text,result,decision_by_user_id::text,
            decided_at IS NOT NULL AS decided,completed_at IS NOT NULL AS completed,
            expires_at IS NULL AS expiry_cleared
       FROM app.ai_operations WHERE id=$1`,
    [operationId],
  );
  return result.rows[0] as
    | {
        status: string;
        decision: string | null;
        result: unknown;
        decision_by_user_id: string | null;
        decided: boolean;
        completed: boolean;
        expiry_cleared: boolean;
      }
    | undefined;
}

/**
 * Creates a real chat answer run via the API, then seeds the paused state the
 * step commit would have produced: step 1 awaiting_approval, one awaiting op
 * of the requested kind (plus optional pending read ops), run
 * awaiting_approval at next_sequence=2.
 */
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
      text: 'Paused decision fixture',
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
        .update(`decision-${options.kind}-${randomUUID()}`)
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

interface Captured {
  readonly status: number;
  readonly error: unknown;
}
async function capture(response: Response): Promise<Captured> {
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as { error?: unknown }) : null;
  return { status: response.status, error: parsed?.error ?? null };
}

async function runStatus(
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
          finalOutput: run.finalOutput,
        }
      : null;
  });
}

test('owner approve, answer and dismiss resume the run and return the stored outcome', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-op-decision-1.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  const audit = createAuditInspector(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);

    // approve on an approval-kind op
    const approval = await seedPausedRun(app, headers, { kind: 'approval' });
    const decidedBefore = await audit.count('chat.approval_decided.v1');
    const approved = await decideCall(
      origin,
      headers,
      approval.runId,
      approval.operationId,
      { snapshotHash: approval.snapshotHash, action: 'approve' },
    );
    expect(approved.status).toBe(200);
    const approvedResult = OperationDecisionResultSchema.parse(
      await approved.json(),
    );
    expect(approvedResult).toMatchObject({
      operationId: approval.operationId,
      status: 'approved',
      decision: 'approve',
    });
    expect(approvedResult.decidedAt).not.toBeNull();
    expect(await runStatus(app, approval.tenant, approval.runId)).toMatchObject(
      {
        status: 'running',
        runVersion: 4,
      },
    );
    const stepTwo = await app
      .get(TenantDatabase)
      .withTenant(approval.tenant, (tx) =>
        new AiStepRepository().find(tx, {
          runId: approval.runId,
          sequence: 2,
        }),
      );
    expect(stepTwo).toMatchObject({ state: 'pending', expectedVersion: 4 });
    expect(
      await countQuery(
        fixture,
        `SELECT count(*)::int AS count FROM ops.outbox
         WHERE type='run.resume.v1' AND payload->>'runId'=$1`,
        [approval.runId],
      ),
    ).toBe(1);
    expect(await audit.count('chat.approval_decided.v1')).toBe(
      decidedBefore + 1,
    );
    expect(await operationRow(fixture, approval.operationId)).toMatchObject({
      status: 'approved',
      decision: 'approve',
      decision_by_user_id: approval.tenant.userId,
      decided: true,
      expiry_cleared: true,
    });

    // answer on a question-kind op lands the stored answers
    const question = await seedPausedRun(app, headers, { kind: 'question' });
    const answers = [
      { questionId: 'q1', choice: { kind: 'option', index: 1 } },
      { questionId: 'q2', choice: { kind: 'options', indexes: [0, 2] } },
      { questionId: 'q3', choice: { kind: 'skipped' } },
    ];
    const answered = await decideCall(
      origin,
      headers,
      question.runId,
      question.operationId,
      { snapshotHash: question.snapshotHash, action: 'answer', answers },
    );
    expect(answered.status).toBe(200);
    expect(
      OperationDecisionResultSchema.parse(await answered.json()),
    ).toMatchObject({
      operationId: question.operationId,
      status: 'answered',
      decision: 'answer',
    });
    expect(await runStatus(app, question.tenant, question.runId)).toMatchObject(
      {
        status: 'running',
        runVersion: 4,
      },
    );
    expect(await operationRow(fixture, question.operationId)).toMatchObject({
      status: 'answered',
      decision: 'answer',
      result: { answers },
    });
    expect(
      await countQuery(
        fixture,
        `SELECT count(*)::int AS count FROM ops.audit_events
         WHERE type='chat.question_decided.v1' AND metadata->>'operationId'=$1
           AND metadata->>'status'='answered'`,
        [question.operationId],
      ),
    ).toBe(1);

    // dismiss on a question-kind op
    const dismissed = await seedPausedRun(app, headers, { kind: 'question' });
    const dismiss = await decideCall(
      origin,
      headers,
      dismissed.runId,
      dismissed.operationId,
      { snapshotHash: dismissed.snapshotHash, action: 'dismiss' },
    );
    expect(dismiss.status).toBe(200);
    expect(
      OperationDecisionResultSchema.parse(await dismiss.json()),
    ).toMatchObject({
      operationId: dismissed.operationId,
      status: 'dismissed',
      decision: 'dismiss',
    });
    expect(await operationRow(fixture, dismissed.operationId)).toMatchObject({
      status: 'dismissed',
      decision: 'dismiss',
      result: { answered_in_chat: true },
    });
    expect(
      await runStatus(app, dismissed.tenant, dismissed.runId),
    ).toMatchObject({
      status: 'running',
      runVersion: 4,
    });
  } finally {
    await app.close();
    await fixture.close();
    await audit.close();
  }
});

test('malformed answer payloads and kind-mismatched actions are 400s', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-op-decision-2.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, { kind: 'question' });
    const answer = (questionId: string, choice: unknown) => ({
      questionId,
      choice,
    });
    const q1 = (choice: unknown) => answer('q1', choice);
    const q2 = (choice: unknown) => answer('q2', choice);
    const q3 = (choice: unknown) => answer('q3', choice);
    const validQ1 = q1({ kind: 'option', index: 0 });
    const validQ2 = q2({ kind: 'options', indexes: [0] });
    const validQ3 = q3({ kind: 'text', text: 'context' });
    const malformed: Record<string, unknown>[] = [
      // unknown questionId
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [
          answer('no-such-question', { kind: 'option', index: 0 }),
          validQ2,
          validQ3,
        ],
      },
      // out-of-range option index (q1 has 2 options)
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [q1({ kind: 'option', index: 2 }), validQ2, validQ3],
      },
      // duplicate indexes
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [validQ1, q2({ kind: 'options', indexes: [1, 1] }), validQ3],
      },
      // option on a multiple question
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [validQ1, q2({ kind: 'option', index: 0 }), validQ3],
      },
      // options on a single question
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [q1({ kind: 'options', indexes: [0] }), validQ2, validQ3],
      },
      // any option on a text question
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [validQ1, validQ2, q3({ kind: 'option', index: 0 })],
      },
      // empty options
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [validQ1, q2({ kind: 'options', indexes: [] }), validQ3],
      },
      // free text on q1 (allowFreeText:false)
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [q1({ kind: 'text', text: 'free text' }), validQ2, validQ3],
      },
      // text over 500 chars
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [
          validQ1,
          validQ2,
          q3({ kind: 'text', text: 'x'.repeat(501) }),
        ],
      },
      // incomplete coverage (q3 missing)
      {
        snapshotHash: seeded.snapshotHash,
        action: 'answer',
        answers: [validQ1, validQ2],
      },
    ];
    for (const payload of malformed) {
      const response = await decideCall(
        origin,
        headers,
        seeded.runId,
        seeded.operationId,
        payload,
      );
      expect({ payload, status: response.status }).toEqual({
        payload,
        status: 400,
      });
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    }
    // The op must be untouched by every malformed payload.
    expect(await operationRow(fixture, seeded.operationId)).toMatchObject({
      status: 'awaiting_approval',
      decision: null,
    });
    // action not allowed for the kind: approve/reject on a question op.
    for (const action of ['approve', 'reject'] as const) {
      const response = await decideCall(
        origin,
        headers,
        seeded.runId,
        seeded.operationId,
        { snapshotHash: seeded.snapshotHash, action },
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    }
    // answer/dismiss on an approval op is a kind mismatch too.
    const approval = await seedPausedRun(app, headers, { kind: 'approval' });
    for (const body of [
      {
        snapshotHash: approval.snapshotHash,
        action: 'answer',
        answers: [{ questionId: 'q1', choice: { kind: 'skipped' } }],
      },
      { snapshotHash: approval.snapshotHash, action: 'dismiss' },
    ] as const) {
      const response = await decideCall(
        origin,
        headers,
        approval.runId,
        approval.operationId,
        body,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await operationRow(fixture, seeded.operationId)).toMatchObject({
      status: 'awaiting_approval',
      decision: null,
    });
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('a second decision call returns the stored outcome without re-validating', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-op-decision-3.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, { kind: 'approval' });
    const first = await decideCall(
      origin,
      headers,
      seeded.runId,
      seeded.operationId,
      { snapshotHash: seeded.snapshotHash, action: 'approve' },
    );
    expect(first.status).toBe(200);
    const stored = OperationDecisionResultSchema.parse(await first.json());
    // Repeat of the same action: identical stored outcome.
    const repeat = await decideCall(
      origin,
      headers,
      seeded.runId,
      seeded.operationId,
      { snapshotHash: seeded.snapshotHash, action: 'approve' },
    );
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual(stored);
    // A conflicting (but kind-valid) action also returns the stored outcome.
    const conflict = await decideCall(
      origin,
      headers,
      seeded.runId,
      seeded.operationId,
      { snapshotHash: seeded.snapshotHash, action: 'reject' },
    );
    expect(conflict.status).toBe(200);
    expect(await conflict.json()).toEqual(stored);
    // The stored op is still the first decision — no second resume.
    expect(await operationRow(fixture, seeded.operationId)).toMatchObject({
      status: 'approved',
      decision: 'approve',
    });
    expect(
      await countQuery(
        fixture,
        `SELECT count(*)::int AS count FROM ops.outbox
         WHERE type='run.resume.v1' AND payload->>'runId'=$1`,
        [seeded.runId],
      ),
    ).toBe(1);

    // A repeated answer payload is not re-validated: a malformed replay
    // still returns the stored outcome.
    const question = await seedPausedRun(app, headers, { kind: 'question' });
    const firstAnswer = await decideCall(
      origin,
      headers,
      question.runId,
      question.operationId,
      {
        snapshotHash: question.snapshotHash,
        action: 'answer',
        answers: [
          { questionId: 'q1', choice: { kind: 'option', index: 0 } },
          { questionId: 'q2', choice: { kind: 'options', indexes: [0] } },
          { questionId: 'q3', choice: { kind: 'text', text: 'context' } },
        ],
      },
    );
    expect(firstAnswer.status).toBe(200);
    const storedAnswer = OperationDecisionResultSchema.parse(
      await firstAnswer.json(),
    );
    const replayedMalformed = await decideCall(
      origin,
      headers,
      question.runId,
      question.operationId,
      {
        snapshotHash: question.snapshotHash,
        action: 'answer',
        answers: [
          {
            questionId: 'no-such-question',
            choice: { kind: 'option', index: 0 },
          },
        ],
      },
    );
    expect(replayedMalformed.status).toBe(200);
    expect(await replayedMalformed.json()).toEqual(storedAnswer);
  } finally {
    await app.close();
    await fixture.close();
  }
});

test('member, same-org owner, platform admin and other-org callers all get the identical random-id 404', async ({
  services,
}) => {
  const environment = createAuthEnvironment(
    services,
    '/tmp/lexon-op-decision-4.json',
  );
  environment.AUTH_RATE_RULES_JSON = JSON.stringify({
    signup: { account: 8, ip: 10_000, windowSeconds: 600 },
    signin: { account: 8, ip: 10_000, windowSeconds: 60 },
    'verification-resend': { account: 8, ip: 10_000, windowSeconds: 600 },
    totp: { account: 10, ip: 10_000, windowSeconds: 300 },
  });
  const app = await createTestApi(loadRuntimeConfig('api', environment));
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const fixture = await createChatFixture(services);
  const pools = createPlatformPools(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const owner = await apiHeaders(app);
    const member = await apiHeaders(app);
    const peer = await apiHeaders(app);
    const admin = await apiHeaders(app);
    const outsider = await apiHeaders(app);

    const seeded = await seedPausedRun(app, owner, { kind: 'approval' });
    const ids = { runId: seeded.runId, operationId: seeded.operationId };
    const body = { snapshotHash: seeded.snapshotHash, action: 'reject' };

    // Same-org member + same-org owner (non-initiator) on a shared team.
    const ownerId = seeded.tenant.userId;
    const memberId = (await identityOf(origin, member)).userId;
    const peerId = (await identityOf(origin, peer)).userId;
    const team = await organizations.seedTeam([ownerId, memberId, peerId]);
    await organizations.mutateMember(team.members[1]!.id, 'demote');
    for (const headers of [owner, member, peer]) {
      const switched = await fetch(`${origin}/api/organizations/active`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: team.id }),
      });
      expect(switched.status).toBe(200);
    }
    // Platform admin: TOTP-enrolled session + admin role in auth."user".
    const adminId = (await identityOf(origin, admin)).userId;
    const enable = await fetch(`${origin}/api/auth/two-factor/enable`, {
      method: 'POST',
      headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(enable.status).toBe(200);
    const setup = (await enable.json()) as { totpURI: string };
    const verified = await fetch(`${origin}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify({ code: totpForUri(setup.totpURI) }),
    });
    expect(verified.status).toBe(200);
    const adminMfa = {
      cookie: verified.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
      origin: admin.origin ?? '',
    };
    await pools.migrator.query(
      `UPDATE auth."user" SET role='admin' WHERE id=$1`,
      [adminId],
    );

    const baseline = await capture(
      await decideCall(origin, member, randomUUID(), randomUUID(), body),
    );
    expect(baseline.status).toBe(404);
    const actors = [
      ['same-org member', member],
      ['same-org owner', peer],
      ['platform admin', adminMfa],
      ['other-org member', outsider],
    ] as const;
    for (const [label, headers] of actors) {
      const attack = await capture(
        await decideCall(origin, headers, ids.runId, ids.operationId, body),
      );
      expect(attack, label).toEqual(baseline);
    }
    // The op and the run are untouched by every non-owner probe.
    expect(await operationRow(fixture, seeded.operationId)).toMatchObject({
      status: 'awaiting_approval',
      decision: null,
    });
    expect(await runStatus(app, seeded.tenant, seeded.runId)).toMatchObject({
      status: 'awaiting_approval',
      runVersion: 3,
    });
  } finally {
    await app.close();
    await organizations.close();
    await fixture.close();
    await pools.close();
  }
});

test('a stale snapshotHash hits the CAS-loss refusal and a missing op is the identical 404', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-op-decision-5.json'),
    ),
  );
  const fixture = await createChatFixture(services);
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, { kind: 'approval' });
    const stale = createHash('sha256').update('stale-hash').digest('hex');
    const refused = await decideCall(
      origin,
      headers,
      seeded.runId,
      seeded.operationId,
      { snapshotHash: stale, action: 'approve' },
    );
    expect(refused.status).toBe(500);
    expect((await refused.json()).error.code).toBe('INTERNAL_ERROR');
    expect(await operationRow(fixture, seeded.operationId)).toMatchObject({
      status: 'awaiting_approval',
      decision: null,
    });

    // A valid-but-absent operation id resolves exactly like a random run id.
    const baseline = await capture(
      await decideCall(origin, headers, randomUUID(), randomUUID(), {
        snapshotHash: seeded.snapshotHash,
        action: 'approve',
      }),
    );
    expect(baseline.status).toBe(404);
    const absentOp = await capture(
      await decideCall(origin, headers, seeded.runId, randomUUID(), {
        snapshotHash: seeded.snapshotHash,
        action: 'approve',
      }),
    );
    expect(absentOp).toEqual(baseline);
  } finally {
    await app.close();
    await fixture.close();
  }
});
