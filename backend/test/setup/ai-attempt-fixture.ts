import {
  AiAttemptRepository,
  type TenantSession,
} from '../../src/infrastructure/db/index.js';
import { AttemptService } from '../../src/modules/usage/attempt.service.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import type { FileServices } from './provided-context.js';

export interface AttemptHarnessOptions {
  readonly inputBudgetTokens?: number;
  readonly outputBudgetTokens?: number;
}

export async function createAttemptHarness(
  services: FileServices,
  options: AttemptHarnessOptions = {},
) {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0, {
      inputBudgetTokens: options.inputBudgetTokens ?? 4000,
      outputBudgetTokens: options.outputBudgetTokens ?? 2000,
    });
    const claim = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: false,
    });
    return {
      claim,
      inputBudgetTokens: run.inputBudgetTokens,
      outputBudgetTokens: run.outputBudgetTokens,
      runId: run.id,
      tokenBudget: run.inputBudgetTokens + run.outputBudgetTokens,
      newService: () => new AttemptService(),
      withTenant<T>(work: (tx: TenantSession) => Promise<T>): Promise<T> {
        return ai.withTenant(0, work);
      },
      async listAttempts() {
        return ai.withTenant(0, (tx) =>
          new AiAttemptRepository().list(tx, run.id),
        );
      },
      async close() {
        await ai.close();
      },
    };
  } catch (error) {
    await ai.close();
    throw error;
  }
}
