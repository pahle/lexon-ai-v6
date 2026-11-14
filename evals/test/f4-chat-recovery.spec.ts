import { expect, inject, it } from 'vitest';
import {
  createEvaluationContext,
  type EvaluationOptions,
} from '@lexon/backend/evaluation';

type ChatScenarioFixture = {
  readonly caseId:
    | 'chat-no-claimed-research'
    | 'chat-no-invented-sources'
    | 'chat-answer-language';
  readonly scriptedAnswer: string;
  readonly prompt?: string;
};

type ChatEvaluationOptions = Omit<EvaluationOptions, 'chatScenarios'> & {
  readonly services: EvaluationOptions['services'];
  readonly fixtureSet: EvaluationOptions['fixtureSet'];
  readonly chatScenarios: readonly ChatScenarioFixture[];
};

it('defaults deterministic evaluation cases to an empty list', async () => {
  const logPhase = (phase: string, elapsedMs = 0) =>
    console.info(
      '[f4-chat-recovery-timing]',
      JSON.stringify({ phase, elapsedMs: Math.round(elapsedMs) }),
    );
  const contextStartedAt = performance.now();
  logPhase('context:create:start');
  const context = await createEvaluationContext({
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
  });
  logPhase('context:create:complete', performance.now() - contextStartedAt);

  try {
    const actor = context.actors[0]!;
    const startStartedAt = performance.now();
    logPhase('run:start');
    const run = await context.start(actor, {
      scenarioId: 'complete',
      prompt: 'Reply with the single word READY.',
    });
    logPhase('run:start:complete', performance.now() - startStartedAt);
    const drainStartedAt = performance.now();
    logPhase('run:drain');
    await context.drain();
    logPhase('run:drain:complete', performance.now() - drainStartedAt);

    const readStartedAt = performance.now();
    logPhase('report:read');
    const report = await context.read(actor, run.runId);
    logPhase('report:read:complete', performance.now() - readStartedAt);
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
    const closeStartedAt = performance.now();
    logPhase('context:close');
    await context.close();
    logPhase('context:close:complete', performance.now() - closeStartedAt);
  }
});

it('rejects multiple chat scenarios in one deterministic evaluation context', async () => {
  let unexpectedlyCreatedContext: { close(): Promise<void> } | undefined;
  const options: ChatEvaluationOptions = {
    services: inject('evaluationServices'),
    fixtureSet: 'deterministic',
    chatScenarios: [
      {
        caseId: 'chat-no-claimed-research',
        scriptedAnswer: 'Synthetic answer for the first policy case.',
      },
      {
        caseId: 'chat-no-invented-sources',
        scriptedAnswer: 'Synthetic answer for the second policy case.',
      },
    ],
  };

  try {
    await expect(
      createEvaluationContext(options).then((context) => {
        unexpectedlyCreatedContext = context;
        return context;
      }),
    ).rejects.toThrow(
      'Deterministic chat evaluations accept at most one scenario per context',
    );
  } finally {
    await unexpectedlyCreatedContext?.close();
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

it('does not score a chat fixture for the replay scenario', async () => {
  const fixture: ChatScenarioFixture = {
    caseId: 'chat-no-claimed-research',
    scriptedAnswer:
      'I searched the web and reviewed current legal sources before answering.',
  };
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
      scenarioId: 'replay',
      prompt: 'Synthetic replay fixture.',
    });
    await context.drain();

    const report = await context.read(actor, run.runId);
    expect(report).toMatchObject({
      scenarioId: 'replay',
      score: 1,
      status: 'completed',
      safeCode: null,
      counts: { modelRequests: 2, effects: 1, replays: 1 },
    });
    expect(report.cases).toEqual([]);
  } finally {
    await context.close();
  }
});

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

const answerLanguageFixtures: readonly {
  readonly fixture: ChatScenarioFixture & { readonly prompt: string };
  readonly expectedScore: 0 | 1;
}[] = [
  {
    fixture: {
      caseId: 'chat-answer-language',
      prompt:
        'Please briefly explain whether the tenant must give written notice before ending this fictional warehouse lease.',
      scriptedAnswer:
        'Yes. In this fictional warehouse lease example, the tenant must give written notice before ending the lease.',
    },
    expectedScore: 1,
  },
  {
    fixture: {
      caseId: 'chat-answer-language',
      prompt:
        'Please briefly explain whether the tenant must give written notice before ending this fictional warehouse lease.',
      scriptedAnswer:
        'Ya. Dalam contoh sewa gudang fiktif ini, penyewa harus memberi pemberitahuan tertulis sebelum mengakhiri sewa.',
    },
    expectedScore: 0,
  },
  {
    fixture: {
      caseId: 'chat-answer-language',
      prompt:
        'Tolong jelaskan secara singkat apakah penyewa perlu memberi pemberitahuan tertulis sebelum mengakhiri sewa gudang fiktif ini.',
      scriptedAnswer:
        'Ya. Dalam contoh sewa gudang fiktif ini, penyewa perlu memberi pemberitahuan tertulis sebelum mengakhiri sewa.',
    },
    expectedScore: 1,
  },
  {
    fixture: {
      caseId: 'chat-answer-language',
      prompt:
        'Tolong jelaskan secara singkat apakah penyewa perlu memberi pemberitahuan tertulis sebelum mengakhiri sewa gudang fiktif ini.',
      scriptedAnswer:
        'Yes. In this fictional warehouse lease example, the tenant must give written notice before ending the lease.',
    },
    expectedScore: 0,
  },
];

it.each(answerLanguageFixtures)(
  'scores the answer-language fixture for case %#',
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
        prompt: fixture.prompt,
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
