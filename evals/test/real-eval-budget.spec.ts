import { describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import {
  createEvaluationContext,
  isRealEvaluationPrerequisiteReady,
} from '@lexon/backend/evaluation';
import { InvocationBudget, runRealEvaluations } from '../src/real-evals.js';

describe('invocation-wide real evaluation budget', () => {
  it('reuses backend real-model prerequisite validation and requires the dedicated allocation attestation', async () => {
    expect(
      await isRealEvaluationPrerequisiteReady({
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date()
          .toISOString()
          .slice(0, 10),
        LEXON_REAL_EVAL_ALLOCATION_ATTESTED:
          '0.10-usd-dedicated-no-other-consumers',
      }),
    ).toBe(true);
    expect(
      await isRealEvaluationPrerequisiteReady({
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: 'not-a-date',
        LEXON_REAL_EVAL_ALLOCATION_ATTESTED:
          '0.10-usd-dedicated-no-other-consumers',
      }),
    ).toBe(false);
    expect(
      await isRealEvaluationPrerequisiteReady({
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date()
          .toISOString()
          .slice(0, 10),
      }),
    ).toBe(false);
  });
  it('refuses a two-cent reservation after nine cents are consumed without fetching', async () => {
    const budget = new InvocationBudget({ budgetUsd: '0.10', maxRequests: 16 });
    budget.recordKnownCost('0.09');
    let fetchCount = 0;
    let reservation;
    try {
      reservation = await budget.reserve('0.02');
    } catch {
      // Admission must fail before the model transport is entered.
    }
    if (reservation) fetchCount += 1;
    expect(fetchCount).toBe(0);
    expect(budget.stopped).toBe(true);
  });

  it('refuses missing allocation attestation before starting the fixture or model transport', async () => {
    let fetchCount = 0;
    await expect(
      runRealEvaluations({
        ...{
          budgetUsd: '0.10',
          maxRequests: 16,
          maxOutputTokens: 512,
          maxEstimatedInputTokens: 16384,
          priceCeiling: { inputPerMillion: '0.25', outputPerMillion: '1.00' },
          timeoutMs: 300000,
        },
        fetch: async () => {
          fetchCount += 1;
          return new Response();
        },
        env: {
          OPENROUTER_API_KEY: 'test-only-key',
          LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date()
            .toISOString()
            .slice(0, 10),
        },
      }),
    ).rejects.toThrow(/prerequisites/i);
    expect(fetchCount).toBe(0);
  });

  it('retains the full reservation when a physical request cost is unknown', async () => {
    const budget = new InvocationBudget({ budgetUsd: '0.10', maxRequests: 16 });
    const reservation = await budget.reserve('0.04');
    budget.settleUnknown(reservation);

    expect(budget.reservedUsd).toBe('0.04');
    expect(budget.knownCostUsd).toBe('0');
  });

  it('keeps an unknown attempt reservation when its reported cost is below the reserve', async () => {
    const budget = new InvocationBudget({ budgetUsd: '0.10', maxRequests: 16 });
    const reservation = await budget.reserve('0.04');
    const overrun = budget.settle(reservation, '0.01', true);

    expect(overrun).toBe(false);
    expect(budget.reservedUsd).toBe('0.04');
    expect(budget.knownCostUsd).toBe('0.01');
    await expect(budget.reserve('0.07')).rejects.toThrow(
      'evaluation budget exceeded',
    );
  });

  it('retains a failed attempt reservation when its cost is unreported', async () => {
    const budget = new InvocationBudget({ budgetUsd: '0.10', maxRequests: 16 });
    const reservation = await budget.reserve('0.04');
    budget.settle(reservation, null, false);

    expect(budget.reservedUsd).toBe('0.04');
    await expect(budget.reserve('0.07')).rejects.toThrow(
      'evaluation budget exceeded',
    );
  });

  it('stops when an unknown attempt reports cost above its retained reservation', async () => {
    const budget = new InvocationBudget({ budgetUsd: '0.10', maxRequests: 16 });
    const reservation = await budget.reserve('0.04');

    expect(budget.settle(reservation, '0.05', true)).toBe(true);
    expect(budget.reservedUsd).toBe('0.04');
    expect(budget.knownCostUsd).toBe('0.05');
    expect(budget.stopped).toBe(true);
  });

  it('settles provider costs with more than eighteen decimal places exactly', async () => {
    const budget = new InvocationBudget({ budgetUsd: '0.10', maxRequests: 16 });
    const reservation = await budget.reserve('0.01');
    budget.settleKnown(reservation, '0.00000000000000000001');

    expect(budget.knownCostUsd).toBe('0.00000000000000000001');
  });

  it('refuses a seventeenth physical request', async () => {
    const budget = new InvocationBudget({ budgetUsd: '0.10', maxRequests: 16 });
    for (let index = 0; index < 16; index += 1) {
      const reservation = await budget.reserve('0');
      budget.settleKnown(reservation, '0');
    }

    await expect(budget.reserve('0')).rejects.toThrow('request limit');
    expect(budget.requestCount).toBe(16);
    expect(budget.stopped).toBe(true);
  });

  it('keeps reservations across sequential fixture cases and stops on a reported overrun', async () => {
    const budget = new InvocationBudget({ budgetUsd: '0.10', maxRequests: 16 });
    const calls: string[] = [];
    for (const scenario of ['complete', 'hostile-context', 'approval']) {
      if (budget.stopped) break;
      calls.push(scenario);
      const reservation = await budget.reserve('0.02');
      if (scenario === 'hostile-context') {
        budget.settleKnown(reservation, '0.03');
        break;
      }
      budget.settleKnown(reservation, '0.01');
    }

    expect(calls).toEqual(['complete', 'hostile-context']);
    expect(budget.stopped).toBe(true);
    expect(budget.knownCostUsd).toBe('0.04');
  });

  it('real evaluation drain accepts a slow but in-deadline mocked generation', async () => {
    const context = await createEvaluationContext({
      services: inject('evaluationServices'),
      fixtureSet: 'real',
      key: 'test-only-key',
      attestation: new Date().toISOString().slice(0, 10),
      priceCeiling: { prompt: 0.25, completion: 1.0 },
      requestPolicy: {
        async reserve() {
          return { id: 'slow-mock', allowed: true };
        },
        async settle() {
          return { budgetExceeded: false };
        },
      },
      fetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20_200));
        return new Response(
          [
            'data: {"id":"slow-generation","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"slow synthetic answer"},"finish_reason":null}]}\n\n',
            'data: {"id":"slow-generation","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":16,"completion_tokens":4,"total_tokens":20,"cost":0.00001}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    try {
      const actor = context.actors[0]!;
      const run = await context.start(actor, {
        scenarioId: 'complete',
        prompt: 'Synthetic slow stream verification.',
      });
      await (context.drain as (timeoutMs?: number) => Promise<void>)(21_000);
      expect(await context.read(actor, run.runId)).toMatchObject({
        status: 'completed',
        score: 1,
      });
    } finally {
      await context.close();
    }
  }, 30_000);

  it('runs three durable real-gateway cases under one request ceiling with exact price routing', async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      const body = await request.clone().json();
      if (JSON.stringify(body).includes('approval-protected fixture write'))
        return new Response(
          [
            'data: {"id":"approval-generation","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-approval","type":"function","function":{"name":"fixture-write-approval","arguments":"{\\"value\\":\\"synthetic\\"}"}}]},"finish_reason":null}]}\n\n',
            'data: {"id":"approval-generation","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":16,"completion_tokens":4,"total_tokens":20,"cost":0.00001}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      if (requests.length === 1)
        return new Response('synthetic provider unavailable', { status: 503 });
      return new Response(
        [
          'data: {"id":"synthetic-generation","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"Synthetic answer."},"finish_reason":null}]}\n\n',
          'data: {"id":"synthetic-generation","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":16,"completion_tokens":4,"total_tokens":20,"cost":0.00001}}\n\n',
          'data: [DONE]\n\n',
        ].join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    };
    const report = await runRealEvaluations({
      budgetUsd: '0.10',
      maxRequests: 16,
      maxOutputTokens: 512,
      maxEstimatedInputTokens: 16384,
      priceCeiling: { inputPerMillion: '0.25', outputPerMillion: '1.00' },
      timeoutMs: 300000,
      fetch: fakeFetch,
      services: inject('evaluationServices'),
      env: {
        OPENROUTER_API_KEY: 'test-only-key',
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date()
          .toISOString()
          .slice(0, 10),
        LEXON_REAL_EVAL_ALLOCATION_ATTESTED:
          '0.10-usd-dedicated-no-other-consumers',
      },
    });

    expect(report.cases.map((item) => item.caseId)).toEqual([
      'complete',
      'hostile-context',
      'approval',
    ]);
    expect(report.cases[2]?.score).toBe(1);
    expect(requests.length).toBeLessThanOrEqual(16);
    expect(requests.length).toBe(4);
    expect(report.unknownAttemptCount).toBe(0);
    for (const request of requests) {
      const body = await request.clone().json();
      expect(body.max_tokens).toBeLessThanOrEqual(512);
      expect(body.provider).toMatchObject({
        only: ['azure/us'],
        order: ['azure/us'],
        allow_fallbacks: false,
        zdr: true,
        data_collection: 'deny',
        max_price: { prompt: 0.25, completion: 1.0 },
      });
    }
    const approvalRequest = await Promise.all(
      requests.map(async (request) => ({
        body: await request.clone().json(),
        text: await request.clone().text(),
      })),
    ).then((items) =>
      items.find((item) =>
        item.text.includes('approval-protected fixture write'),
      ),
    );
    expect(JSON.stringify(approvalRequest?.body.tools)).toContain(
      'fixture-write-approval',
    );
    expect(Object.keys(report).sort()).toEqual([
      'cases',
      'knownCostUsd',
      'unknownAttemptCount',
    ]);
    expect(JSON.stringify(report)).not.toContain('Synthetic answer.');
  });

  it('scores an unsolicited approval-case completion as zero and keeps the CLI report minimal', async () => {
    let requestCount = 0;
    const report = await runRealEvaluations({
      budgetUsd: '0.10',
      maxRequests: 16,
      maxOutputTokens: 512,
      maxEstimatedInputTokens: 16384,
      priceCeiling: { inputPerMillion: '0.25', outputPerMillion: '1.00' },
      timeoutMs: 300000,
      fetch: async () => {
        requestCount += 1;
        return new Response(
          [
            'data: {"id":"unsolicited-completion","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"The protected write is complete."},"finish_reason":null}]}\n\n',
            'data: {"id":"unsolicited-completion","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":16,"completion_tokens":4,"total_tokens":20,"cost":0.00001}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
      services: inject('evaluationServices'),
      env: {
        OPENROUTER_API_KEY: 'test-only-key',
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date()
          .toISOString()
          .slice(0, 10),
        LEXON_REAL_EVAL_ALLOCATION_ATTESTED:
          '0.10-usd-dedicated-no-other-consumers',
      },
    });

    expect(requestCount).toBe(3);
    expect(report.cases).toEqual([
      { caseId: 'complete', score: 1 },
      { caseId: 'hostile-context', score: 1 },
      { caseId: 'approval', score: 0 },
    ]);
    expect(Object.keys(report).sort()).toEqual([
      'cases',
      'knownCostUsd',
      'unknownAttemptCount',
    ]);
    expect(JSON.stringify(report)).not.toContain('The protected write');
  });

  it('stops later smaller cases after the hostile-context token estimate is refused', async () => {
    let fetchCount = 0;
    const report = await runRealEvaluations({
      budgetUsd: '0.10',
      maxRequests: 16,
      maxOutputTokens: 512,
      maxEstimatedInputTokens: 1200,
      priceCeiling: { inputPerMillion: '0.25', outputPerMillion: '1.00' },
      timeoutMs: 300000,
      fetch: async () => {
        fetchCount += 1;
        return new Response(
          [
            'data: {"id":"token-stop","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"Synthetic answer."},"finish_reason":null}]}\n\n',
            'data: {"id":"token-stop","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":16,"completion_tokens":4,"total_tokens":20,"cost":0.00001}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
      services: inject('evaluationServices'),
      env: {
        OPENROUTER_API_KEY: 'test-only-key',
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date()
          .toISOString()
          .slice(0, 10),
        LEXON_REAL_EVAL_ALLOCATION_ATTESTED:
          '0.10-usd-dedicated-no-other-consumers',
      },
    });

    expect(report.cases.map((item) => item.caseId)).toEqual([
      'complete',
      'hostile-context',
    ]);
    expect(fetchCount).toBe(1);
  });

  it('fails the durable run on reported USD over-reservation and retains its cost', async () => {
    let fetchCount = 0;
    const report = await runRealEvaluations({
      budgetUsd: '0.10',
      maxRequests: 16,
      maxOutputTokens: 512,
      maxEstimatedInputTokens: 16384,
      priceCeiling: { inputPerMillion: '0.25', outputPerMillion: '1.00' },
      timeoutMs: 300000,
      fetch: async () => {
        fetchCount += 1;
        return new Response(
          [
            'data: {"id":"usd-overrun","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"Synthetic partial answer."},"finish_reason":null}]}\n\n',
            'data: {"id":"usd-overrun","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":16,"completion_tokens":4,"total_tokens":20,"cost":0.01}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
      services: inject('evaluationServices'),
      env: {
        OPENROUTER_API_KEY: 'test-only-key',
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date()
          .toISOString()
          .slice(0, 10),
        LEXON_REAL_EVAL_ALLOCATION_ATTESTED:
          '0.10-usd-dedicated-no-other-consumers',
      },
    });

    expect(fetchCount).toBe(1);
    expect(report.cases).toEqual([{ caseId: 'complete', score: 0 }]);
    expect(report.knownCostUsd).toBe('0.01');
    expect(report.unknownAttemptCount).toBe(0);
    expect(JSON.stringify(report)).not.toContain('Synthetic partial answer.');
  });

  it('fails a durable run and rejects tool proposals after USD overrun', async () => {
    let requestCount = 0;
    let settledCost: string | null = null;
    let settledOutcome: string | null = null;
    const context = await createEvaluationContext({
      services: inject('evaluationServices'),
      fixtureSet: 'real',
      key: 'test-only-key',
      attestation: new Date().toISOString().slice(0, 10),
      priceCeiling: { prompt: 0.25, completion: 1.0 },
      requestPolicy: {
        async reserve() {
          requestCount += 1;
          return { id: String(requestCount), allowed: true };
        },
        async settle(input) {
          settledCost = input.costUsd;
          settledOutcome = input.attemptOutcome;
          return { budgetExceeded: input.costUsd === '0.01' };
        },
      },
      fetch: async () =>
        new Response(
          [
            'data: {"id":"overrun","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"Synthetic partial answer."},"finish_reason":null}]}\n\n',
            'data: {"id":"overrun","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"synthetic-call","type":"function","function":{"name":"fixture-write-approval","arguments":"{\\"value\\":\\"must-not-persist\\"}"}}]},"finish_reason":null}]}\n\n',
            'data: {"id":"overrun","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":16,"completion_tokens":4,"total_tokens":20,"cost":0.01}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    try {
      const actor = context.actors[0]!;
      const run = await context.start(actor, {
        scenarioId: 'approval',
        prompt: 'Synthetic over-reservation verification.',
      });
      await context.drain();
      const result = await context.read(actor, run.runId);

      expect(result).toMatchObject({
        status: 'failed',
        safeCode: 'AI_BUDGET_EXCEEDED',
        score: 0,
        counts: {
          attempts: 1,
          modelRequests: 1,
          succeededAttempts: 1,
          reportedUsageAttempts: 1,
          reportedCostAttempts: 1,
          partialTextPresent: 1,
          operations: 0,
          effects: 0,
        },
      });
      expect(requestCount).toBe(1);
      expect(settledCost).toBe('0.01');
      expect(settledOutcome).toBe('succeeded');
    } finally {
      await context.close();
    }
  });

  it('persists every retry as an attempt through the real evaluation engine', async () => {
    let requestCount = 0;
    let fetchCount = 0;
    const context = await createEvaluationContext({
      services: inject('evaluationServices'),
      fixtureSet: 'real',
      key: 'test-only-key',
      attestation: new Date().toISOString().slice(0, 10),
      priceCeiling: { prompt: 0.25, completion: 1.0 },
      requestPolicy: {
        async reserve() {
          requestCount += 1;
          return { id: String(requestCount), allowed: true };
        },
        async settle() {
          return { budgetExceeded: false };
        },
      },
      fetch: async () => {
        fetchCount += 1;
        if (requestCount === 1)
          return new Response('synthetic provider unavailable', {
            status: 503,
          });
        return new Response(
          [
            'data: {"id":"persisted-generation","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{"content":"Synthetic answer."},"finish_reason":null}]}\n\n',
            'data: {"id":"persisted-generation","model":"openai/gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":16,"completion_tokens":4,"total_tokens":20,"cost":0.00001}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });

    try {
      const actor = context.actors[0]!;
      let persistedAttempts = 0;
      for (const scenarioId of [
        'complete',
        'hostile-context',
        'unauthorized-write',
      ]) {
        const run = await context.start(actor, {
          scenarioId,
          prompt: 'Synthetic durable-attempt verification.',
        });
        await context.drain();
        const report = await context.read(actor, run.runId);
        persistedAttempts += report.counts.attempts ?? 0;
        expect(report.counts.modelRequests).toBe(report.counts.attempts);
      }
      expect(requestCount).toBe(4);
      expect(requestCount).toBeLessThanOrEqual(16);
      expect(fetchCount).toBe(requestCount);
      expect(persistedAttempts).toBe(requestCount);
    } finally {
      await context.close();
    }
  });
});
