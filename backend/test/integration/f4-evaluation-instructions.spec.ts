import { expect, inject, it, vi } from 'vitest';
import * as ai from '../../src/infrastructure/ai/index.js';
import { AiRunRepository } from '../../src/infrastructure/db/index.js';
import { createEvaluationContext } from '../../src/evaluation/index.js';
import { CHAT_INSTRUCTIONS } from '../../src/modules/chat/chat-instructions.js';

it('sends and persists the versioned chat instructions in a deterministic evaluation', async () => {
  const observedSystemInstructions: string[] = [];
  const persistedInstructionVersions: unknown[] = [];
  let targetRunId: string | undefined;

  const originalGatewayFactory = ai.createSdkScriptedModelGateway;
  const gatewayFactorySpy = vi
    .spyOn(ai, 'createSdkScriptedModelGateway')
    .mockImplementation((responseFor, onRequest, afterResponse) =>
      originalGatewayFactory(
        (input) => {
          for (const message of input.messages)
            if (
              message.role === 'system' &&
              typeof message.content === 'string'
            )
              observedSystemInstructions.push(message.content);
          return responseFor(input);
        },
        onRequest,
        afterResponse,
      ),
    );

  const originalFind = AiRunRepository.prototype.find;
  const runFindSpy = vi
    .spyOn(AiRunRepository.prototype, 'find')
    .mockImplementation(async function (this: AiRunRepository, tx, runId) {
      const run = await originalFind.call(this, tx, runId);
      if (runId === targetRunId && run) {
        const config = run.resolvedConfig;
        persistedInstructionVersions.push(
          typeof config === 'object' &&
            config !== null &&
            'instructionVersion' in config
            ? config.instructionVersion
            : undefined,
        );
      }
      return run;
    });

  const context = await createEvaluationContext({
    services: inject('infrastructure'),
    fixtureSet: 'deterministic',
    chatScenarios: [
      {
        caseId: 'chat-no-claimed-research',
        scriptedAnswer: 'A synthetic answer without a research claim.',
      },
    ],
  });

  try {
    const actor = context.actors[0]!;
    const run = await context.start(actor, {
      scenarioId: 'complete',
      prompt: 'Synthetic chat instruction fixture.',
    });
    targetRunId = run.runId;
    await context.drain();
    const report = await context.read(actor, run.runId);

    expect.soft(report.counts.modelRequests).toBe(1);
    expect.soft(observedSystemInstructions).toContain(CHAT_INSTRUCTIONS.text);
    expect
      .soft(persistedInstructionVersions)
      .toContain(CHAT_INSTRUCTIONS.version);
  } finally {
    await context.close();
    runFindSpy.mockRestore();
    gatewayFactorySpy.mockRestore();
  }
});
