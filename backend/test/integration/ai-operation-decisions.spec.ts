import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiOperationRepository,
  hashOperationArgs,
  type OperationProposal,
} from '../../src/infrastructure/db/index.js';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';

async function persistOp(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  tenantIndex: number,
  options: {
    kind?: OperationProposal['kind'];
    approvalRequired?: boolean;
  } = {},
) {
  const run = await ai.start(tenantIndex);
  await ai.seedPendingStep(tenantIndex, run.id);
  const claim = await ai.claim(tenantIndex, run.id, 1, 1, 5_000);
  expect(claim).not.toBeNull();
  const repository = new AiOperationRepository();
  const args = { value: `${options.kind ?? 'approval'}-${tenantIndex}` };
  const operation = await ai.withTenant(tenantIndex, async (tx) => {
    const op = await repository.persist(tx, claim!, {
      callOccurrence: 0,
      toolName: 'fixture-write',
      toolVersion: 1,
      mode: 'transactional',
      args,
      argsHash: hashOperationArgs(args),
      snapshotHash: canonicalOperationHash({
        toolId: 'fixture-write',
        toolVersion: 1,
        args,
      }),
      approvalRequired: options.approvalRequired ?? true,
      ...(options.kind ? { kind: options.kind } : {}),
    });
    // Free the claim slot — an org may hold at most two live claimed steps
    // (ai-step.repository.ts liveClaims guard) and this helper is reused.
    await ai.expireClaimLeaseInSession(tx, claim!);
    return op;
  });
  return { run, operation, repository, tenant: ai.tenants[tenantIndex]! };
}

async function ageExpiry(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  tenantIndex: number,
  operationId: string,
) {
  await ai.withTenantSession(tenantIndex, (tx, client) =>
    client.query(
      `UPDATE app.ai_operations
       SET expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1`,
      [operationId],
    ),
  );
}

test('answer and dismiss land the stored result by kind', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const answered = await persistOp(ai, 0, { kind: 'question' });
    expect(answered.operation.kind).toBe('question');
    expect(answered.operation.expiresAt).not.toBeNull();
    const answers = {
      answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
    };
    const decided = await ai.withTenant(0, (tx) =>
      answered.repository.decideApproval(tx, {
        runId: answered.run.id,
        operationId: answered.operation.id,
        snapshotHash: answered.operation.snapshotHash,
        userId: answered.tenant.userId,
        decision: 'answer',
        result: answers,
      }),
    );
    expect(decided).not.toBeNull();
    expect(decided).toMatchObject({
      status: 'answered',
      decision: 'answer',
      result: answers,
      expiresAt: null,
    });
    expect(decided!.decidedAt).not.toBeNull();
    expect(decided!.decidedByUserId).toBe(answered.tenant.userId);
    expect(decided!.completedAt).not.toBeNull();

    const dismissed = await persistOp(ai, 0, { kind: 'question' });
    const dismissResult = await ai.withTenant(0, (tx) =>
      dismissed.repository.decideApproval(tx, {
        runId: dismissed.run.id,
        operationId: dismissed.operation.id,
        snapshotHash: dismissed.operation.snapshotHash,
        userId: dismissed.tenant.userId,
        decision: 'dismiss',
      }),
    );
    expect(dismissResult).toMatchObject({
      status: 'dismissed',
      decision: 'dismiss',
      result: { answered_in_chat: true },
      expiresAt: null,
    });
    expect(dismissResult!.decidedAt).not.toBeNull();
    expect(dismissResult!.completedAt).not.toBeNull();

    // The kind-aware CAS refuses actions outside the op kind.
    const approval = await persistOp(ai, 0, { kind: 'approval' });
    const wrongKind = await ai.withTenant(0, (tx) =>
      approval.repository.decideApproval(tx, {
        runId: approval.run.id,
        operationId: approval.operation.id,
        snapshotHash: approval.operation.snapshotHash,
        userId: approval.tenant.userId,
        decision: 'answer',
        result: answers,
      }),
    );
    expect(wrongKind).toBeNull();
    const question = await persistOp(ai, 0, { kind: 'question' });
    const wrongKindQuestion = await ai.withTenant(0, (tx) =>
      question.repository.decideApproval(tx, {
        runId: question.run.id,
        operationId: question.operation.id,
        snapshotHash: question.operation.snapshotHash,
        userId: question.tenant.userId,
        decision: 'approve',
      }),
    );
    expect(wrongKindQuestion).toBeNull();
  } finally {
    await ai.close();
  }
});

test('expire stamps the kind-shaped result and actor-less decision state', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const approval = await persistOp(ai, 0, { kind: 'approval' });
    await ageExpiry(ai, 0, approval.operation.id);
    const expiredApproval = await ai.withTenant(0, (tx) =>
      approval.repository.expire(tx, {
        runId: approval.run.id,
        operationId: approval.operation.id,
      }),
    );
    expect(expiredApproval).toMatchObject({
      status: 'expired',
      decision: null,
      decidedByUserId: null,
      result: { expired: 'approval' },
      expiresAt: null,
    });
    expect(expiredApproval!.decidedAt).not.toBeNull();
    expect(expiredApproval!.completedAt).not.toBeNull();

    const question = await persistOp(ai, 1, { kind: 'question' });
    await ageExpiry(ai, 1, question.operation.id);
    const expiredQuestion = await ai.withTenant(1, (tx) =>
      question.repository.expire(tx, {
        runId: question.run.id,
        operationId: question.operation.id,
      }),
    );
    expect(expiredQuestion).toMatchObject({
      status: 'expired',
      decision: null,
      decidedByUserId: null,
      result: { unanswered: true },
      expiresAt: null,
    });
    expect(expiredQuestion!.decidedAt).not.toBeNull();
    expect(expiredQuestion!.completedAt).not.toBeNull();
  } finally {
    await ai.close();
  }
});

test('CAS loss on an already-decided op is a no-op on every path', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const question = await persistOp(ai, 0, { kind: 'question' });
    const first = await ai.withTenant(0, (tx) =>
      question.repository.decideApproval(tx, {
        runId: question.run.id,
        operationId: question.operation.id,
        snapshotHash: question.operation.snapshotHash,
        userId: question.tenant.userId,
        decision: 'dismiss',
      }),
    );
    expect(first?.status).toBe('dismissed');
    // Same decision again, a conflicting decision, and the expiry sweep all
    // lose the CAS on a row that is no longer awaiting a decision.
    for (const decision of ['dismiss', 'answer'] as const) {
      const again = await ai.withTenant(0, (tx) =>
        question.repository.decideApproval(tx, {
          runId: question.run.id,
          operationId: question.operation.id,
          snapshotHash: question.operation.snapshotHash,
          userId: question.tenant.userId,
          decision,
          ...(decision === 'answer' ? { result: { answers: [] } } : {}),
        }),
      );
      expect(again).toBeNull();
    }
    // A dismissed op carries expires_at=NULL (lifecycle CHECK), so the
    // sweep's expires_at<=now gate plus the status gate both lose the CAS.
    const expiredAfterDecision = await ai.withTenant(0, (tx) =>
      question.repository.expire(tx, {
        runId: question.run.id,
        operationId: question.operation.id,
      }),
    );
    expect(expiredAfterDecision).toBeNull();
    // An op already expired cannot be decided or expired a second time.
    const approval = await persistOp(ai, 0, { kind: 'approval' });
    await ageExpiry(ai, 0, approval.operation.id);
    const expired = await ai.withTenant(0, (tx) =>
      approval.repository.expire(tx, {
        runId: approval.run.id,
        operationId: approval.operation.id,
      }),
    );
    expect(expired?.status).toBe('expired');
    const secondExpiry = await ai.withTenant(0, (tx) =>
      approval.repository.expire(tx, {
        runId: approval.run.id,
        operationId: approval.operation.id,
      }),
    );
    expect(secondExpiry).toBeNull();
    const decideAfterExpiry = await ai.withTenant(0, (tx) =>
      approval.repository.decideApproval(tx, {
        runId: approval.run.id,
        operationId: approval.operation.id,
        snapshotHash: approval.operation.snapshotHash,
        userId: approval.tenant.userId,
        decision: 'approve',
      }),
    );
    expect(decideAfterExpiry).toBeNull();
  } finally {
    await ai.close();
  }
});
