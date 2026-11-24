import { expect, inject, it } from 'vitest';
import { createEvaluationContext } from '@lexon/backend/evaluation';

it('pauses the rename and applies it exactly once on owner approval', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'rename-approval',
      prompt: 'Rename this chat to something clearer.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'rename-approval',
      status: 'awaiting_approval',
      counts: {
        operations: 1,
        undecidedOperations: 1,
        effects: 0,
        decisionAudits: 0,
        modelRequests: 1,
      },
    });
    await context.decide(actor, { runId: run.runId, approved: true });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'rename-approval',
      status: 'completed',
      counts: {
        operations: 1,
        succeededOperations: 1,
        undecidedOperations: 0,
        effects: 1,
        decisionAudits: 1,
        modelRequests: 2,
      },
    });
  } finally {
    await context.close();
  }
});

it('leaves no effect when the owner rejects the rename', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'rename-approval',
      prompt: 'Rename this chat to something clearer.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'rename-approval',
      status: 'awaiting_approval',
      counts: {
        operations: 1,
        undecidedOperations: 1,
        effects: 0,
        decisionAudits: 0,
      },
    });
    await context.decide(actor, { runId: run.runId, approved: false });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'rename-approval',
      status: 'completed',
      counts: {
        operations: 1,
        rejectedOperations: 1,
        undecidedOperations: 0,
        effects: 0,
        decisionAudits: 1,
        modelRequests: 2,
      },
    });
  } finally {
    await context.close();
  }
});

it('proposes nothing when the prompt does not ask for a rename', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'rename-approval',
      prompt: 'Summarize this filing.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'rename-approval',
      status: 'completed',
      counts: { operations: 0, undecidedOperations: 0, effects: 0 },
    });
  } finally {
    await context.close();
  }
});
