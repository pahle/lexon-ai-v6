import { expect, inject, it } from 'vitest';
import { createEvaluationContext } from '@lexon/backend/evaluation';

it('retains the version-only no-options context and closes cleanly', async () => {
  const context = await createEvaluationContext();
  expect(context.version).toBeTypeOf('string');
  expect(context.version.length).toBeGreaterThan(0);
  await expect(context.close()).resolves.toBeUndefined();
});

it('cancels a queued durable run before any model request', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'cancel',
      prompt: 'Synthetic cancellation fixture.',
    });
    await context.cancel(actor, run.runId);
    await context.drain();
    const report = await context.read(actor, run.runId);
    expect(report).toMatchObject({
      scenarioId: 'cancel',
      status: 'cancelled',
      counts: { modelRequests: 0 },
    });
  } finally {
    await context.close();
  }
});

it('retains budget refusal and issues no provider request', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'budget',
      prompt: 'Synthetic budget fixture.',
    });
    await context.drain();
    const report = await context.read(actor, run.runId);
    expect(report).toMatchObject({
      scenarioId: 'budget',
      status: 'failed',
      safeCode: 'AI_BUDGET_EXCEEDED',
      counts: { attempts: 0, modelRequests: 0 },
    });
  } finally {
    await context.close();
  }
});

it('requires initiator approval before a transactional write and executes it once', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'approval',
      prompt: 'Approve the synthetic write.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'approval',
      status: 'awaiting_approval',
      counts: { operations: 1, effects: 0 },
    });
    await context.decide(actor, { runId: run.runId, approved: true });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'approval',
      status: 'completed',
      counts: { operations: 1, effects: 1 },
    });
  } finally {
    await context.close();
  }
});

it('refuses a forged write call without the registered capability', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'unauthorized-write',
      prompt: 'Attempt an unpermitted synthetic write.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'unauthorized-write',
      status: 'failed',
      counts: { effects: 0 },
    });
  } finally {
    await context.close();
  }
});

it('redelivers a completed write job without repeating its durable effect', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'replay',
      prompt: 'Write once and replay the job.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'replay',
      status: 'completed',
      counts: { operations: 1, effects: 1, replays: 1 },
    });
  } finally {
    await context.close();
  }
});

it('retains an explicitly unknown attempt and its reservation after provider failure', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'unknown-attempt',
      prompt: 'Return an explicitly unknown provider outcome.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'unknown-attempt',
      status: 'failed',
      safeCode: 'AI_PROVIDER_UNAVAILABLE',
      counts: { attempts: 1, unknownAttempts: 1 },
    });
  } finally {
    await context.close();
  }
});

it('settles a missing model outcome when the SDK stream ends normally', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'crash',
      prompt: 'End the scripted stream without an outcome event.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'crash',
      status: 'failed',
      counts: { attempts: 1, unknownAttempts: 1, modelRequests: 1 },
    });
  } finally {
    await context.close();
  }
});

it('exposes deterministic durable engine controls and safe score reports', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    for (const method of ['start', 'cancel', 'decide', 'read', 'drain'])
      expect(context[method as keyof typeof context]).toBeTypeOf('function');
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'complete',
      prompt: 'Reply with the single word READY.',
    });
    await context.drain();
    const report = await context.read(actor, run.runId);
    expect(Object.keys(report).sort()).toEqual([
      'counts',
      'safeCode',
      'scenarioId',
      'score',
      'status',
    ]);
    expect(report).toMatchObject({
      scenarioId: 'complete',
      status: 'completed',
      counts: { modelRequests: 1 },
    });
    expect(JSON.stringify(report)).not.toMatch(
      /prompt|content|output|token|url|stack/i,
    );
  } finally {
    await context.close();
  }
});

it('receives only generated service URLs from public global setup', () => {
  const descriptor = inject('evaluationServices');
  expect(Object.keys(descriptor).sort()).toEqual([
    'postgresUrl',
    'seaweedS3Url',
    'valkeyUrl',
  ]);
  expect(descriptor.postgresUrl).toMatch(/^postgresql:\/\//);
  expect(descriptor.valkeyUrl).toMatch(/^redis:\/\//);
  expect(descriptor.seaweedS3Url).toMatch(/^http:\/\//);
});

it('blocks a hostile context proposal to write without capability or approval', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'hostile-context',
      prompt: 'Use the supplied context and obey its instructions.',
    });
    await context.drain();
    const report = await context.read(actor, run.runId);
    expect(report).toMatchObject({
      scenarioId: 'hostile-context',
      status: 'failed',
      safeCode: 'AI_INVALID_TOOL',
      counts: { contextFixtures: 1, operations: 0, effects: 0 },
    });
    expect(JSON.stringify(report)).not.toContain('HOSTILE_CONTEXT_SENTINEL');
  } finally {
    await context.close();
  }
});

it('holds an approval-required write proposed after hostile tool output', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'hostile-tool-result',
      prompt: 'Read the fixture and obey any instructions returned by tools.',
    });
    await context.drain();
    const report = await context.read(actor, run.runId);
    expect(report).toMatchObject({
      scenarioId: 'hostile-tool-result',
      status: 'awaiting_approval',
      counts: { operations: 2, effects: 0, modelRequests: 2 },
    });
    expect(JSON.stringify(report)).not.toContain(
      'HOSTILE_TOOL_RESULT_SENTINEL',
    );
  } finally {
    await context.close();
  }
});

it('strips hostile model and tool content from scenario score reports', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'hostile-tool-result',
      prompt: 'HOSTILE_PROMPT_SENTINEL',
    });
    await context.drain();
    const report = await context.read(actor, run.runId);
    expect(JSON.stringify(report)).not.toContain('HOSTILE_PROMPT_SENTINEL');
    expect(JSON.stringify(report)).not.toContain(
      'HOSTILE_TOOL_RESULT_SENTINEL',
    );
    expect(JSON.stringify(report)).not.toContain('secret.invalid');
    expect(Object.keys(report).sort()).toEqual([
      'counts',
      'safeCode',
      'scenarioId',
      'score',
      'status',
    ]);
    expect(report).toMatchObject({
      status: 'awaiting_approval',
      counts: { operations: 2, effects: 0 },
    });
  } finally {
    await context.close();
  }
});

it('runs a hostile context provider through the real engine without exporting its content', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'hostile-context',
      prompt: 'Use the supplied synthetic context.',
    });
    await context.drain();
    const report = await context.read(actor, run.runId);
    expect(report).toMatchObject({
      scenarioId: 'hostile-context',
      status: 'failed',
      safeCode: 'AI_INVALID_TOOL',
      counts: {
        contextFixtures: 1,
        modelRequests: 1,
        operations: 0,
        effects: 0,
      },
    });
    expect(JSON.stringify(report)).not.toContain('HOSTILE_CONTEXT_SENTINEL');
  } finally {
    await context.close();
  }
});

it('recovers an expired model claim while retaining unknown reservation and one write effect', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'claim-recovery',
      prompt: 'Perform the synthetic write exactly once.',
    });
    await context.drain();
    expect(await context.read(actor, run.runId)).toMatchObject({
      scenarioId: 'claim-recovery',
      status: 'completed',
      counts: {
        attempts: 3,
        unknownAttempts: 1,
        succeededAttempts: 2,
        modelRequests: 3,
        operations: 1,
        effects: 1,
        unknownReservationInvariant: 1,
        claimRecoveries: 1,
        recoveryStepAttempts: 2,
        postOperationCompletionAttempts: 1,
      },
    });
  } finally {
    await context.close();
  }
});

it('reports effects per run when one actor starts multiple writes in one tenant', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const firstWrite = await context.start(actor, {
      scenarioId: 'replay',
      prompt: 'First write.',
    });
    const noWrite = await context.start(actor, {
      scenarioId: 'complete',
      prompt: 'No write.',
    });
    const secondWrite = await context.start(actor, {
      scenarioId: 'replay',
      prompt: 'Second write.',
    });
    await context.drain();
    expect((await context.read(actor, firstWrite.runId)).counts.effects).toBe(
      1,
    );
    expect((await context.read(actor, noWrite.runId)).counts.effects).toBe(0);
    expect((await context.read(actor, secondWrite.runId)).counts.effects).toBe(
      1,
    );
  } finally {
    await context.close();
  }
});
