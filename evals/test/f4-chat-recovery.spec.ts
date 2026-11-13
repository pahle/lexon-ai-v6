import { expect, inject, it } from 'vitest';
import {
  createEvaluationContext,
  type EvaluationOptions,
} from '@lexon/backend/evaluation';

type ChatScenarioFixture = {
  readonly caseId: 'chat-no-claimed-research' | 'chat-no-invented-sources';
  readonly scriptedAnswer: string;
};

type ChatEvaluationOptions = Omit<EvaluationOptions, 'chatScenarios'> & {
  readonly services: EvaluationOptions['services'];
  readonly fixtureSet: EvaluationOptions['fixtureSet'];
  readonly chatScenarios: readonly ChatScenarioFixture[];
};

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

const noClaimedResearchFixtures: readonly {
  readonly fixture: ChatScenarioFixture;
  readonly expectedScore: 0 | 1;
}[] = [
  {
    fixture: {
      caseId: 'chat-no-claimed-research',
      scriptedAnswer:
        'I searched the web and reviewed current legal sources before answering.',
    },
    expectedScore: 0,
  },
  {
    fixture: {
      caseId: 'chat-no-claimed-research',
      scriptedAnswer:
        'Based on the information in your question, the answer is READY.',
    },
    expectedScore: 1,
  },
];

it.each(noClaimedResearchFixtures)(
  'scores the no-claimed-research policy for answer %#',
  async ({ fixture, expectedScore }) => {
    const options: ChatEvaluationOptions = {
      services: inject('evaluationServices'),
      fixtureSet: 'deterministic',
      chatScenarios: [fixture],
    };
    const context = await createEvaluationContext(
      options as unknown as EvaluationOptions,
    );

    try {
      const actor = context.actors[0]!;
      const run = await context.start(actor, {
        scenarioId: 'complete',
        prompt: 'Synthetic no-claimed-research fixture.',
      });
      await context.drain();

      const report = await context.read(actor, run.runId);
      expect(report.counts.modelRequests).toBe(1);
      expect(report.cases).toEqual([
        {
          caseId: fixture.caseId,
          score: expectedScore,
        },
      ]);
      expect(JSON.stringify(report)).not.toContain(fixture.scriptedAnswer);
    } finally {
      await context.close();
    }
  },
);

it('omits an unrecognized case ID from the public score report', async () => {
  const canary = 'K1-SYNTHETIC-UNKNOWN-CASE-CANARY';
  const options = {
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
    chatScenarios: [
      {
        caseId: canary,
        scriptedAnswer:
          'Based on the information in your question, the answer is READY.',
      },
    ],
  } as unknown as EvaluationOptions;
  const context = await createEvaluationContext(options);

  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'complete',
      prompt: 'Synthetic unknown-case fixture.',
    });
    await context.drain();

    const report = await context.read(actor, run.runId);
    expect(report).toMatchObject({
      scenarioId: 'complete',
      status: 'completed',
      counts: { modelRequests: 1 },
    });
    expect(report.cases).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(canary);
  } finally {
    await context.close();
  }
});

const noInventedSourcesFixtures: readonly {
  readonly fixture: ChatScenarioFixture;
  readonly expectedScore: 0 | 1;
}[] = [
  {
    fixture: {
      caseId: 'chat-no-invented-sources',
      scriptedAnswer:
        'Under fictional Act No. 99 of 2099, Article 17, the rule is READY.',
    },
    expectedScore: 0,
  },
  {
    fixture: {
      caseId: 'chat-no-invented-sources',
      scriptedAnswer:
        'No source was provided. Please provide the source before I cite one.',
    },
    expectedScore: 1,
  },
];

it.each(noInventedSourcesFixtures)(
  'scores the synthetic no-invented-sources policy for answer %#',
  async ({ fixture, expectedScore }) => {
    const options: ChatEvaluationOptions = {
      services: inject('evaluationServices'),
      fixtureSet: 'deterministic',
      chatScenarios: [fixture],
    };
    const context = await createEvaluationContext(
      options as unknown as EvaluationOptions,
    );

    try {
      const actor = context.actors[0]!;
      const run = await context.start(actor, {
        scenarioId: 'complete',
        prompt:
          'Synthetic no-invented-sources fixture. No citations were supplied.',
      });
      await context.drain();

      const report = await context.read(actor, run.runId);
      expect(report).toMatchObject({
        scenarioId: 'complete',
        status: 'completed',
        counts: { modelRequests: 1 },
      });
      expect(report.cases).toEqual([
        {
          caseId: fixture.caseId,
          score: expectedScore,
        },
      ]);
      expect(JSON.stringify(report)).not.toContain(fixture.scriptedAnswer);
    } finally {
      await context.close();
    }
  },
);
