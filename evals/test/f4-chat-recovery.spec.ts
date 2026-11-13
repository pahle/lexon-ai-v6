import { expect, inject, it } from 'vitest';
import { createEvaluationContext } from '@lexon/backend/evaluation';

it('defaults deterministic evaluation cases to an empty list', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });

  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'complete',
      prompt: 'Reply with the single word READY.',
    });
    await context.drain();

    const report = await context.read(actor, run.runId);
    const reportWithCases = report as typeof report & {
      cases: ReadonlyArray<{ caseId: string; score: number }>;
    };

    expect(reportWithCases.cases).toEqual([]);
    expect(report).toMatchObject({
      scenarioId: 'complete',
      score: 1,
      status: 'completed',
      safeCode: null,
      counts: { modelRequests: 1 },
    });
  } finally {
    await context.close();
  }
});
