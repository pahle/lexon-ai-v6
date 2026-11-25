import { expect, inject, it } from 'vitest';
import { createEvaluationContext } from '@lexon/backend/evaluation';

it('asks a question when facts are missing and completes on the owner answer', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'ask-user',
      prompt: 'Which filing applies to this matter?',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'ask-user',
      status: 'awaiting_approval',
      counts: {
        operations: 1,
        undecidedOperations: 1,
        effects: 0,
        modelRequests: 1,
        decisionAudits: 0,
      },
    });
    await context.decide(actor, { runId: run.runId, approved: true });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'ask-user',
      status: 'completed',
      counts: {
        operations: 1,
        answeredOperations: 1,
        undecidedOperations: 0,
        decisionAudits: 1,
        modelRequests: 2,
        effects: 0,
      },
    });
  } finally {
    await context.close();
  }
});

it('answers directly when the prompt carries the facts', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'ask-user',
      prompt:
        'FACTS PROVIDED: the matter is a warehouse lease. Which filing applies?',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'ask-user',
      status: 'completed',
      counts: { operations: 0, undecidedOperations: 0, modelRequests: 1 },
    });
  } finally {
    await context.close();
  }
});

it('records a dismissal when the owner answers in chat', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'ask-user',
      prompt: 'Which filing applies to this matter?',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'ask-user',
      status: 'awaiting_approval',
      counts: { operations: 1, undecidedOperations: 1 },
    });
    await context.decide(actor, { runId: run.runId, approved: false });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'ask-user',
      status: 'completed',
      counts: {
        operations: 1,
        dismissedOperations: 1,
        undecidedOperations: 0,
        decisionAudits: 1,
        modelRequests: 2,
        effects: 0,
      },
    });
  } finally {
    await context.close();
  }
});

it('rejects an unlisted scenarioId', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    await expect(
      context.start(actor, {
        scenarioId: 'unlisted-scenario',
        prompt: 'Synthetic unlisted scenario.',
      }),
    ).rejects.toThrow('Unknown evaluation scenario');
  } finally {
    await context.close();
  }
});
