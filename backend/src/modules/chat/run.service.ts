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
  assertTenantSession,
  type TenantSession,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { RunAuthorizationService } from '../identity-access/index.js';
import type { RunRegistry } from './run-registry.js';
import type { RunProfile } from './run-contracts.js';
import {
  DEFAULT_MAX_ATTEMPTS_PER_STEP,
  DEFAULT_MAX_TOOL_PROPOSALS_PER_GENERATION,
  RUN_REGISTRATION_LIMITS,
} from './run-contracts.js';
import { stepJobId } from './step-job-id.js';
import { AuditService } from '../audit/index.js';

type Allowlist = typeof ModelAllowlistSchema extends {
  parse(value: unknown): infer T;
}
  ? T
  : never;

export interface StartRunInput {
  readonly profileId: string;
  readonly prompt: string;
  readonly effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly resourceIds?: readonly string[];
}

export class RunService {
  private readonly audit = new AuditService();
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
    input: StartRunInput,
  ): Promise<{ runId: string }> {
    this.authorization.assertLiveActor(actor);
    await this.capacity.configure(this.capacityConfig);
    const ctx = { orgId: actor.orgId, userId: actor.userId };
    return this.database.withTenant(ctx, (tx) =>
      this.startWithin(tx, actor, input),
    );
  }

  async startWithin(
    tx: TenantSession,
    actor: RunActor,
    input: StartRunInput,
  ): Promise<{ runId: string }> {
    this.authorization.assertLiveActor(actor);
    assertTenantSession(this.database, tx, {
      orgId: actor.orgId,
      userId: actor.userId,
    });
    const profile = this.registry.profile(input.profileId);
    if (
      !profile ||
      typeof input.prompt !== 'string' ||
      !input.prompt.trim() ||
      (input.resourceIds !== undefined &&
        (!Array.isArray(input.resourceIds) || input.resourceIds.length > 0))
    )
      throw new Error('AI run request denied');
    if (Buffer.byteLength(input.prompt, 'utf8') > 16_384)
      throw new Error('AI run request denied');
    const reasoning = profile.reasoning;
    const effort = reasoning ? (input.effort ?? reasoning.default) : undefined;
    if (
      (reasoning && (!effort || !reasoning.allowed.includes(effort))) ||
      (!reasoning && input.effort !== undefined)
    )
      throw new Error('AI run request denied');
    const modelId = profile.defaultModel;
    const routes = this.allowlist.models.filter(
      (route) =>
        route.id === modelId && profile.allowedModels.includes(route.id),
    );
    if (routes.length !== 1)
      throw new Error('AI model route is not uniquely reviewed');
    const route = routes[0]!;
    const outputBudgetTokens = reasoning
      ? (reasoning.outputLimits[effort!] ?? 0)
      : profile.maxOutputTokens;
    const tokenBudget = reasoning
      ? (reasoning.runBudgets[effort!] ?? 0)
      : profile.tokenBudget;
    if (
      !Number.isSafeInteger(outputBudgetTokens) ||
      !Number.isSafeInteger(tokenBudget)
    )
      throw new Error('AI run budget is invalid');
    const inputBudgetTokens = tokenBudget - outputBudgetTokens;
    if (inputBudgetTokens < 1) throw new Error('AI run budget is invalid');
    const runId = randomUUID();
    const stepId = randomUUID();
    const ctx = { orgId: actor.orgId, userId: actor.userId };
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
        profileSnapshot: snapshotProfile(profile),
        provider: route.provider,
        region: route.region,
        zeroDataRetention: route.zeroDataRetention,
        reviewedAt: route.reviewedAt,
        queue: profile.queue,
        priority: profile.priority,
        maxOutputTokens: outputBudgetTokens,
        tokenBudget,
        ...(effort ? { resolvedEffort: effort } : {}),
        ...(profile.instructions
          ? {
              instructionVersion: profile.instructions.version,
              instructions: profile.instructions,
            }
          : {}),
        maxEstimatedInputTokens: profile.maxEstimatedInputTokens ?? null,
        resourceIds: input.resourceIds ?? [],
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
    await this.audit.append(tx, {
      version: 1,
      eventId: randomUUID(),
      type: 'chat.run_started.v1',
      occurredAt: new Date().toISOString(),
      outcome: 'success',
      orgId: actor.orgId,
      actorUserId: actor.userId,
      metadata: {
        runId,
        model: modelId,
        provider: route.provider,
        status: 'started',
      },
    });
    return { runId };
  }
}

function snapshotProfile(profile: RunProfile) {
  return Object.freeze({
    ...profile,
    ...(profile.instructions
      ? { instructions: Object.freeze({ ...profile.instructions }) }
      : {}),
    ...(profile.reasoning
      ? {
          reasoning: Object.freeze({
            ...profile.reasoning,
            allowed: Object.freeze([...profile.reasoning.allowed]),
            outputLimits: Object.freeze({ ...profile.reasoning.outputLimits }),
            runBudgets: Object.freeze({ ...profile.reasoning.runBudgets }),
          }),
        }
      : {}),
    allowedModels: Object.freeze([...profile.allowedModels]),
    contextBudgets: Object.freeze({ ...profile.contextBudgets }),
    capabilities: Object.freeze([...profile.capabilities]),
    maxAttemptsPerStep:
      profile.maxAttemptsPerStep ?? DEFAULT_MAX_ATTEMPTS_PER_STEP,
    maxToolProposalsPerGeneration:
      profile.maxToolProposalsPerGeneration ??
      DEFAULT_MAX_TOOL_PROPOSALS_PER_GENERATION,
    childBounds: profile.childBounds
      ? Object.freeze({ ...profile.childBounds })
      : null,
    maxToolInputBytes:
      profile.maxToolInputBytes ?? RUN_REGISTRATION_LIMITS.maxInputBytes,
    maxToolResultBytes:
      profile.maxToolResultBytes ?? RUN_REGISTRATION_LIMITS.maxResultBytes,
    maxToolTimeoutMs:
      profile.maxToolTimeoutMs ?? RUN_REGISTRATION_LIMITS.maxTimeoutMs,
  });
}
