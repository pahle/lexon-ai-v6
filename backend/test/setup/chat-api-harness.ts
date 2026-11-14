import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { identityApiHarness } from './identity-api-harness.js';
import type { FileServices } from './provided-context.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { createAiHarness } from './ai-harness.js';
import { ModelAllowlistSchema } from '../../src/infrastructure/ai/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';
import type { RunProfile } from '../../src/modules/chat/index.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { CHAT_PROFILES } from '../../src/modules/chat/chat-profiles.js';
import { ChatHistoryContextProvider } from '../../src/modules/chat/chat-history-context.js';
import { CancelService } from '../../src/modules/chat/cancel.service.js';
import {
  CancelSignals,
  RunStreams,
} from '../../src/infrastructure/queue/index.js';
import {
  AiStepRepository,
  AiRunRepository,
  RunActorFactsRepository,
  type RunStepJobEnvelope,
} from '../../src/infrastructure/db/index.js';
import { IdentitySummarySchema } from '@lexon/contracts';

const model = 'openai/gpt-6-luna';
const profile: RunProfile = {
  id: 'chat-storage-test',
  version: 1,
  allowedModels: [model],
  defaultModel: model,
  queue: 'ai-interactive',
  priority: 1,
  maxIterations: 1,
  tokenBudget: 8192,
  maxOutputTokens: 32,
  contextBudgets: {},
  capabilities: [],
};

/** Real API plus tenant repository and worker fixtures sharing the file database. */
export async function createChatApiHarness(
  services: FileServices,
  hooks: {
    readonly afterActiveProof?: () => Promise<void>;
    readonly forceFirstActiveProofStale?: boolean;
    readonly authRateRulesJson?: string;
  } = {},
) {
  const api = await identityApiHarness(
    services,
    undefined,
    hooks.authRateRulesJson,
  );
  let storage: Awaited<ReturnType<typeof createChatFixture>> | undefined;
  try {
    storage = await createChatFixture(services);
  } catch (error) {
    await api.close();
    throw error;
  }
  const authorization = new RunAuthorizationService();
  const signals = new CancelSignals({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    databaseUrl: services.appUrl,
    database: storage.database,
    runs: new AiRunRepository(),
  });
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  let forcedActiveProofStale = false;
  const streams = new RunStreams({
    url: services.valkey.streamsUrl,
    prefix: services.queuePrefix,
    authority: {
      authorizeActive: async (claim) => {
        if (hooks.forceFirstActiveProofStale && !forcedActiveProofStale) {
          forcedActiveProofStale = true;
          return undefined;
        }
        const proof = await storage!.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamActiveProof(tx, claim),
        );
        if (proof) await hooks.afterActiveProof?.();
        return proof;
      },
      advanceStreamGeneration: (claim, observed) =>
        storage!.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.advanceStreamGeneration(tx, claim, observed),
          { timeoutMs: 500 },
        ),
      authorizeTerminal: (claim) =>
        storage!.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamTerminalProof(tx, claim),
        ),
      advanceTerminalStreamGeneration: (claim, observed) =>
        storage!.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.advanceTerminalStreamGeneration(tx, claim, observed),
          { timeoutMs: 500 },
        ),
      authorizeCommitted: (claim, event) =>
        storage!.database.withTenant(
          { orgId: claim.orgId, userId: claim.userId },
          (tx) => steps.streamCommittedProof(tx, claim, event),
        ),
      reconcile: (entries) =>
        Promise.all(
          entries.map(async (entry) => {
            const result = await storage!.database.withTenant(
              { orgId: entry.orgId, userId: entry.userId },
              (tx) => runs.streamRegistryState(tx, entry.runId, entry.userId),
            );
            return result.state === 'terminal'
              ? {
                  runId: entry.runId,
                  state: 'terminal' as const,
                  claim: result.claim,
                }
              : { runId: entry.runId, state: result.state };
          }),
        ),
    },
  });
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const engine = await createAiHarness(
    {
      database: storage.database,
      capacity: storage.capacity,
      capacityConfig: storage.capacityConfig,
      allowlist,
      authorization,
      close: async () => {},
    },
    {
      profiles: [profile, CHAT_PROFILES.chat],
      contexts: [new ChatHistoryContextProvider(storage.database)],
      tools: [],
    },
    storage.model.gateway,
    undefined,
    { cancelSignals: signals, streams },
  );
  const cancelService = new CancelService(
    storage.database,
    engine.runs,
    engine.steps,
    new RunActorFactsRepository(),
    authorization,
    streams,
    signals,
  );

  async function withActor<T>(
    ctx: { orgId: string; userId: string },
    work: (actor: RunActor) => Promise<T>,
  ): Promise<T> {
    const summary = {
      version: 1 as const,
      platformAdmin: false,
      user: {
        version: 1 as const,
        id: ctx.userId,
        name: 'Chat API test actor',
        email: `${ctx.userId}@example.test`,
        emailVerified: true,
        twoFactorEnabled: false,
        onboardingCompleted: true,
      },
      organization: {
        version: 1 as const,
        id: ctx.orgId,
        name: 'Chat API test organization',
        slug: 'chat-api-test',
        kind: 'personal' as const,
        state: 'active' as const,
        require2fa: false,
        role: 'owner' as const,
        createdAt: new Date().toISOString(),
      },
    };
    const request = {};
    const identities = new RequestIdentity();
    identities.prepare(
      request,
      {
        identity: {
          userId: ctx.userId,
          sessionId: randomUUID(),
          activeOrganizationId: ctx.orgId,
          channel: 'cookie',
          platformAdmin: false,
          mfaVerifiedAt: null,
          reauthenticatedAt: null,
        },
        tenant: {
          orgId: ctx.orgId,
          userId: ctx.userId,
          role: 'owner' as const,
        },
        summary: IdentitySummarySchema.parse(summary),
      },
      new Headers(),
    );
    return identities.run(request, () =>
      authorization.withActor(currentVerifiedIdentity(), work),
    );
  }

  return {
    client: {
      identity: {
        user: api.user,
        enroll: api.enroll,
        call: api.call,
      },
      chat: storage.chat,
      directRunOutputAs: storage.chat.directRunOutputAs,
      directSetStepTextAs: storage.chat.directSetStepTextAs,
      setRunResourcesAs: storage.chat.setRunResourcesAs,
      checkpointFor: storage.chat.checkpointFor,
      insertSyntheticAttemptFor: storage.chat.insertSyntheticAttemptFor,
      deactivateAttemptFor: storage.chat.deactivateAttemptFor,
      runWithoutTenant: storage.chat.runWithoutTenant,
      deletedCancellationFactsAs: storage.chat.deletedCancellationFactsAs,
      deletedCancellationFactsWithoutTenant:
        storage.chat.deletedCancellationFactsWithoutTenant,
      chatRunAssociatedAs: storage.chat.chatRunAssociatedAs,
      chatRunAssociatedWithoutTenant:
        storage.chat.chatRunAssociatedWithoutTenant,
      directRelatedRunContent: storage.chat.directRelatedRunContent,
      deleteAssociationAs: storage.chat.deleteAssociationAs,
      expireStepLeaseAs: storage.chat.expireStepLeaseAs,
      async startAnswer(
        ctx: { orgId: string; userId: string },
        chatId: string,
        prompt: string,
      ) {
        return withActor(ctx, (actor) =>
          engine.start(actor, {
            profileId: profile.id,
            prompt,
            resourceIds: [chatId],
          }),
        );
      },
      async cancelFor(ctx: { orgId: string; userId: string }, runId: string) {
        await withActor(ctx, (actor) => cancelService.cancel(actor, runId));
      },
    },
    inspect: storage.inspect,
    streams,
    model: storage.model,
    database: storage.database,
    holdStepClaimGuard: storage.holdStepClaimGuard,
    waitForClaimLockWaiters: storage.waitForClaimLockWaiters,
    engine,
    associateStartedAnswer: storage.chat.associateFor,
    associateTitleRun: storage.chat.associateTitleFor,
    jobForAnswer(
      ctx: { orgId: string; userId: string },
      runId: string,
    ): RunStepJobEnvelope {
      return {
        outboxId: stepJobId(runId, 1),
        type: 'run.start.v1',
        ctx,
        payload: { runId, sequence: 1, expectedVersion: 1 },
      };
    },
    async close() {
      await Promise.all([
        api.close(),
        engine.close(),
        streams.close(),
        storage!.close(),
        signals.close(),
      ]);
    },
  };
}
