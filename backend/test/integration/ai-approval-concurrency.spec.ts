import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { ApprovalService } from '../../src/modules/chat/approval.service.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiOperationRepository,
  hashOperationArgs,
} from '../../src/infrastructure/db/index.js';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';

test('simultaneous approve and reject decisions have one winner', async ({
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
    const args = { value: 'single winner' };
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
    const results = await Promise.all(
      (['approve', 'reject'] as const).map((decision) =>
        ai.withTenant(0, (tx) =>
          repository.decideApproval(tx, {
            runId: run.id,
            operationId: operation.id,
            snapshotHash: operation.snapshotHash,
            userId: ai.tenants[0]!.userId,
            decision,
          }),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  } finally {
    await ai.close();
  }
});
