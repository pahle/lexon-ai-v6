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

it('retains an unknown physical attempt and its reservation after a simulated crash', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'unknown-attempt',
      prompt: 'Simulate a worker crash after receiving a response.',
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

it('accounts for a worker losing the completed SDK response before engine outcome settlement', async () => {
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'crash',
      prompt: 'Simulate worker loss after the provider response.',
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
    expect(report.counts.operations).toBe(1);
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
      status: 'completed',
      counts: { contextFixtures: 1, modelRequests: 1 },
    });
    expect(JSON.stringify(report)).not.toContain('HOSTILE_CONTEXT_SENTINEL');
  } finally {
    await context.close();
  }
});
