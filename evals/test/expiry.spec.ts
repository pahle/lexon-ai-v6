import { expect, inject, it } from 'vitest';
import { createEvaluationContext } from '@lexon/backend/evaluation';

it('expires the pending op, resumes and completes with a notice', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'expiry',
      prompt: 'Request a rename and leave it undecided.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'expiry',
      status: 'completed',
      counts: {
        operations: 1,
        expiredOperations: 1,
        undecidedOperations: 0,
        decisionAudits: 1,
        effects: 0,
        modelRequests: 2,
      },
    });
  } finally {
    await context.close();
  }
});
