import { expect, inject, it } from 'vitest';
import { createEvaluationContext } from '@lexon/backend/evaluation';

it('uses the deadline calculator for a date computation', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'deadline',
      prompt: 'Compute the deadline ten working days after 2026-01-15.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'deadline',
      status: 'completed',
      counts: {
        operations: 1,
        succeededOperations: 1,
        undecidedOperations: 0,
        effects: 0,
        modelRequests: 2,
      },
    });
  } finally {
    await context.close();
  }
});

it('produces no calculator op when the answer is scripted as mental arithmetic', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'deadline',
      prompt: 'Answer WITHOUT TOOLS: ten working days after 2026-01-15?',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'deadline',
      status: 'completed',
      counts: { operations: 0, modelRequests: 1 },
    });
  } finally {
    await context.close();
  }
});
