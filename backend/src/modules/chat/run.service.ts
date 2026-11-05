import { randomUUID } from 'node:crypto';
import type { AiConfig } from '../../config/ai-config.js';
import type { ModelAllowlistSchema } from '../../infrastructure/ai/index.js';
import {
  AiRunRepository,
  AiStepRepository,
  AiCapacityRepository,
  OutboxRepository,
  RunActorFactsRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';
import type { RunRegistry } from './run-registry.js';
import { stepJobId } from './step-job-id.js';

type Allowlist = typeof ModelAllowlistSchema extends {
  parse(value: unknown): infer T;
}
  ? T
  : never;

export class RunService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: AiRunRepository,
    private readonly steps: AiStepRepository,
    private readonly outbox: OutboxRepository,
    private readonly facts: RunActorFactsRepository,
    private readonly authorization: RunAuthorizationService,
    private readonly registry: RunRegistry,
    private readonly capacity: AiCapacityRepository,
    private readonly capacityConfig: AiConfig,
    private readonly allowlist: Allowlist,
  ) {}

  async start(
    actor: RunActor,
    input: { readonly profileId: string; readonly prompt: string },
  ): Promise<{ runId: string }> {
    this.authorization.assertLiveActor(actor);
    const profile = this.registry.profile(input.profileId);
    if (!profile || typeof input.prompt !== 'string' || !input.prompt.trim())
      throw new Error('AI run request denied');
    if (Buffer.byteLength(input.prompt, 'utf8') > 16_384)
      throw new Error('AI run request denied');
    const modelId = profile.defaultModel;
    const routes = this.allowlist.models.filter(
      (route) =>
        route.id === modelId && profile.allowedModels.includes(route.id),
    );
    if (routes.length !== 1)
      throw new Error('AI model route is not uniquely reviewed');
    const route = routes[0]!;
    const outputBudgetTokens = profile.maxOutputTokens;
    const inputBudgetTokens = profile.tokenBudget - outputBudgetTokens;
    if (inputBudgetTokens < 1) throw new Error('AI run budget is invalid');
    await this.capacity.configure(this.capacityConfig);
    const runId = randomUUID();
    const stepId = randomUUID();
    const ctx = { orgId: actor.orgId, userId: actor.userId };
    await this.database.withTenant(ctx, async (tx) => {
      const actorFacts = await this.facts.read(tx, {
        orgId: actor.orgId,
        userId: actor.userId,
      });
      if (!actorFacts) throw new Error('AI run request denied');
      const decision = await this.authorization.authorize(
        tx,
        actorFacts,
        { profileId: profile.id, capabilities: profile.capabilities },
        'start',
      );
      if (!decision.allowed) throw new Error('AI run request denied');
      await this.runs.insert(tx, {
        id: runId,
        orgId: actor.orgId,
        initiatingUserId: actor.userId,
        initiatingSessionId: actor.sessionId,
        initiatingMfaVerifiedAt: actor.mfaVerifiedAt,
        profileId: profile.id,
        profileVersion: profile.version,
        resolvedConfig: {
          provider: route.provider,
          region: route.region,
          zeroDataRetention: route.zeroDataRetention,
          reviewedAt: route.reviewedAt,
          queue: profile.queue,
          priority: profile.priority,
          maxOutputTokens: profile.maxOutputTokens,
          tokenBudget: profile.tokenBudget,
        },
        modelId,
        inputText: input.prompt,
        inputBudgetTokens,
        outputBudgetTokens,
      });
      await this.steps.insertInitial(tx, { id: stepId, runId });
      await this.outbox.append(
        tx,
        {
          type: 'run.start.v1',
          ctx,
          payload: { runId, sequence: 1, expectedVersion: 1 },
        },
        {
          id: stepJobId(runId, 1),
          queue: profile.queue,
          priority: profile.priority,
        },
      );
    });
    return { runId };
  }
}
