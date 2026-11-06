import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { ApprovalService } from '../../src/modules/chat/approval.service.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiOperationRepository,
  hashOperationArgs,
} from '../../src/infrastructure/db/index.js';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';

test('approval requires the exact snapshot hash and accepts only one decision', async ({
  services,
}) => {
  expect(ApprovalService).toBeDefined();
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 5_000);
    expect(claim).not.toBeNull();
    const repository = new AiOperationRepository();
    const args = { value: 'approve me' };
    const operation = await ai.withTenant(0, (tx) =>
      repository.persist(tx, claim!, {
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
        approvalRequired: true,
      }),
    );
    const rejected = await ai.withTenant(0, (tx) =>
      repository.decideApproval(tx, {
        runId: run.id,
        operationId: operation.id,
        snapshotHash: '0'.repeat(64),
        userId: ai.tenants[0]!.userId,
        decision: 'approve',
      }),
    );
    expect(rejected).toBeNull();
    const accepted = await ai.withTenant(0, (tx) =>
      repository.decideApproval(tx, {
        runId: run.id,
        operationId: operation.id,
        snapshotHash: operation.snapshotHash,
        userId: ai.tenants[0]!.userId,
        decision: 'approve',
      }),
    );
    expect(accepted).toMatchObject({ status: 'approved', decision: 'approve' });
    const repeated = await ai.withTenant(0, (tx) =>
      repository.decideApproval(tx, {
        runId: run.id,
        operationId: operation.id,
        snapshotHash: operation.snapshotHash,
        userId: ai.tenants[0]!.userId,
        decision: 'reject',
      }),
    );
    expect(repeated).toBeNull();
  } finally {
    await ai.close();
  }
});
