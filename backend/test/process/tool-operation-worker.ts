import 'reflect-metadata';
import { z } from 'zod';
import {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import type { StepClaim } from '../../src/infrastructure/db/index.js';
import { recordAiTestToolEffect } from '../../src/infrastructure/db/testing/ai-fixture.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import {
  RunRegistry,
  StepCoordinator,
  ToolExecutor,
} from '../../src/modules/chat/index.js';
import { JobExecutor } from '../../src/modules/platform/index.js';
import { AttemptService } from '../../src/modules/usage/index.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';

interface WorkerInput {
  readonly appUrl: string;
  readonly tenant: { readonly orgId: string; readonly userId: string };
  readonly claim: Omit<StepClaim, 'leaseUntil'> & {
    readonly leaseUntil: Date | string;
  };
  readonly operationId: string;
}

process.once('message', async (input: WorkerInput) => {
  const database = new TenantDatabase({
    appUrl: input.appUrl,
    poolMax: 2,
    statementTimeoutMs: 10_000,
  });
  try {
    const claim: StepClaim = {
      ...input.claim,
      leaseUntil: new Date(input.claim.leaseUntil),
    };
    const registry = new RunRegistry();
    registry.register({
      profiles: [
        {
          id: 'executor-test-profile',
          version: 1,
          allowedModels: ['openai/gpt-6-luna'],
          defaultModel: 'openai/gpt-6-luna',
          queue: 'ai-interactive',
          priority: 5,
          maxIterations: 3,
          tokenBudget: 4000,
          maxOutputTokens: 100,
          contextBudgets: {},
          capabilities: [],
        },
      ],
      contexts: [],
      tools: [
        {
          id: 'fixture-write',
          version: 1,
          kind: 'write',
          inputSchema: z.strictObject({ value: z.string() }),
          requiresApproval: false,
          timeoutMs: 1000,
          maxResultBytes: 512,
          capabilities: [],
          idempotency: { mode: 'transactional' },
          async execute(value, context) {
            const row = value as { value: string };
            await recordAiTestToolEffect(
              context.tenant,
              context.operationId,
              row.value,
            );
            return { stored: row.value };
          },
        },
      ],
    });
    const operations = new AiOperationRepository();
    const runs = new AiRunRepository();
    const steps = new AiStepRepository();
    const executor = new ToolExecutor(
      operations,
      runs,
      steps,
      new RunActorFactsRepository(),
      new RunAuthorizationService(),
      registry,
    );
    const coordinator = new StepCoordinator(
      database,
      runs,
      steps,
      new AttemptService(),
      new OutboxRepository(),
      new JobExecutor(database),
      30_000,
      operations,
    );
    const job = {
      outboxId: stepJobId(claim.runId, claim.sequence),
      type: 'run.advance.v1' as const,
      ctx: input.tenant,
      payload: {
        runId: claim.runId,
        sequence: claim.sequence,
        expectedVersion: claim.expectedVersion,
      },
    };
    let toolResult: Awaited<ReturnType<ToolExecutor['execute']>> | undefined;
    const committed = await coordinator.commit(job, claim, {
      state: 'committed',
      text: '',
      data: { operationId: input.operationId },
      advancement: 'continuation',
      terminal: false,
      outcome: 'succeeded',
      transactionTimeoutMs: 1000,
      transactionWork: async (tx, signal) => {
        toolResult = await executor.execute(
          tx,
          claim,
          input.operationId,
          signal,
        );
        if (toolResult.status !== 'succeeded')
          throw new Error('AI tool execution unavailable');
      },
    });
    if (committed !== 'committed' || !toolResult)
      throw new Error('AI tool continuation unavailable');
    process.send?.({ checkpoint: 'operation-committed', result: toolResult });
    await new Promise<never>(() => undefined);
  } catch {
    process.send?.({ checkpoint: 'operation-failed' });
    await database.close();
    process.exitCode = 1;
  }
});
