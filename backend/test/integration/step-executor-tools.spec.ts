import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { z } from 'zod';
import { SafeErrorMessages } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  ChatRepository,
  OutboxRepository,
  requireSession,
  RunActorFactsRepository,
} from '../../src/infrastructure/db/index.js';
import {
  createScriptedModelGateway,
  ModelAllowlistSchema,
  type ModelEvent,
  type ModelGateway,
  type ModelInput,
} from '../../src/infrastructure/ai/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';
import {
  PRODUCTION_ENGINE_REGISTRATIONS,
  RunRegistry,
  StepCoordinator,
  StepExecutor,
  type RunProfile,
  type ToolDefinition,
} from '../../src/modules/chat/index.js';
import { RunService } from '../../src/modules/chat/run.service.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { JobExecutor } from '../../src/modules/platform/job-executor.js';
import { AttemptService } from '../../src/modules/usage/index.js';

const model = 'openai/gpt-6-luna';
const usage = { inputTokens: 20, outputTokens: 3 };

const f5Profile: RunProfile = {
  id: 'f5-tools-test-profile',
  version: 1,
  allowedModels: [model],
  defaultModel: model,
  queue: 'ai-interactive',
  priority: 5,
  maxIterations: 6,
  tokenBudget: 64000,
  maxOutputTokens: 256,
  contextBudgets: {},
  capabilities: ['chat.ask', 'chat.deadline', 'chat.rename'],
};

const readTool: ToolDefinition = {
  id: 'fixture-read',
  version: 1,
  kind: 'read',
  inputSchema: z.strictObject({ query: z.string() }),
  pauseKind: null,
  timeoutMs: 5000,
  maxResultBytes: 16384,
  capabilities: ['chat.deadline'],
  execute: async (input) => ({ lookedUp: (input as { query: string }).query }),
};

const productionTools = PRODUCTION_ENGINE_REGISTRATIONS.tools;
const askUser = () => productionTools.find((tool) => tool.id === 'ask_user')!;
const deadlineCalculator = () =>
  productionTools.find((tool) => tool.id === 'deadline_calculator')!;
const renameChat = () =>
  productionTools.find((tool) => tool.id === 'rename_chat')!;

const questionInput = {
  questions: [
    {
      questionId: 'q1',
      text: 'Which contract type does the counterparty need?',
      kind: 'single',
      options: [{ label: 'NDA' }, { label: 'MSA' }],
    },
  ],
};

function toolScript(
  calls: readonly { toolName: string; input: unknown; callId?: string }[],
) {
  return {
    events: [
      ...calls.map(
        (call, index) =>
          ({
            type: 'tool-proposal' as const,
            toolCallId: call.callId ?? `call-${index}`,
            toolName: call.toolName,
            input: call.input as never,
          }) satisfies Extract<ModelEvent, { type: 'tool-proposal' }>,
      ),
      { type: 'usage' as const, usage },
      {
        type: 'outcome' as const,
        outcome: {
          finishReason: 'tool_calls' as const,
          attemptOutcome: 'succeeded' as const,
          retryable: false,
          usage,
        },
      },
    ],
  };
}

const doneScript = {
  events: [
    { type: 'text' as const, text: 'Done' },
    { type: 'usage' as const, usage },
    {
      type: 'outcome' as const,
      outcome: {
        finishReason: 'stop' as const,
        attemptOutcome: 'succeeded' as const,
        retryable: false,
        usage,
      },
    },
  ],
};

function actorScope(
  tenant: { orgId: string; userId: string },
  auth: RunAuthorizationService,
  work: (actor: RunActor) => Promise<unknown>,
) {
  const request = {};
  const identities = new RequestIdentity();
  identities.prepare(
    request,
    {
      identity: {
        userId: tenant.userId,
        sessionId: randomUUID(),
        activeOrganizationId: tenant.orgId,
        channel: 'cookie',
        platformAdmin: false,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
      },
      tenant: { orgId: tenant.orgId, userId: tenant.userId, role: 'owner' },
      summary: {
        version: 1,
        user: {
          version: 1,
          id: tenant.userId,
          name: 'Fixture',
          email: 'fixture@example.test',
          emailVerified: true,
          twoFactorEnabled: false,
          jobTitle: null,
          onboardingCompleted: true,
        },
        organization: {
          version: 1,
          id: tenant.orgId,
          name: 'Fixture',
          slug: 'fixture',
          kind: 'personal',
          state: 'active',
          require2fa: false,
          role: 'owner',
          createdAt: new Date().toISOString(),
        },
        platformAdmin: false,
        organizationMemberCount: null,
      },
    },
    new Headers(),
  );
  return identities.run(request, () =>
    auth.withActor(currentVerifiedIdentity(), work),
  );
}

async function setup(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  scripts: Parameters<typeof createScriptedModelGateway>[0],
  options: {
    profile?: RunProfile;
    tools?: readonly ToolDefinition[];
    gateway?: ModelGateway;
    resourceIds?: readonly string[];
    captured?: ModelInput[];
  } = {},
) {
  const authorization = new RunAuthorizationService();
  const registry = new RunRegistry();
  registry.register({
    profiles: [options.profile ?? f5Profile],
    contexts: [],
    tools: options.tools ?? [],
  });
  const allowlist = ModelAllowlistSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../config/model-allowlist.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const operations = new AiOperationRepository();
  const outbox = new OutboxRepository();
  const runService = new RunService(
    ai.database,
    runs,
    steps,
    outbox,
    new RunActorFactsRepository(),
    authorization,
    registry,
    ai.capacity,
    ai.capacityConfig,
    allowlist,
  );
  const coordinator = new StepCoordinator(
    ai.database,
    runs,
    steps,
    new AttemptService(),
    outbox,
    new JobExecutor(ai.database),
    undefined,
    operations,
  );
  const captured = options.captured;
  const scripted = createScriptedModelGateway(scripts);
  const gateway: ModelGateway = options.gateway ?? {
    generate(input) {
      captured?.push(input);
      return scripted.generate(input);
    },
  };
  const executor = new StepExecutor({
    database: ai.database,
    runs,
    steps,
    operations,
    facts: new RunActorFactsRepository(),
    authorization,
    coordinator,
    attempts: new AttemptService(),
    registry,
    gateway,
  });
  const tenant = ai.tenants[0]!;
  const created = (await actorScope(tenant, authorization, (actor) =>
    runService.start(actor, {
      profileId: (options.profile ?? f5Profile).id,
      prompt: 'Synthetic prompt',
      ...(options.resourceIds ? { resourceIds: options.resourceIds } : {}),
    }),
  )) as { runId: string };
  return {
    tenant,
    runId: created.runId,
    runs,
    steps,
    operations,
    outbox,
    coordinator,
    executor,
    authorization,
    registry,
  };
}

function job(
  runId: string,
  tenant: { orgId: string; userId: string },
  sequence: number,
  expectedVersion: number,
  type: 'run.start.v1' | 'run.advance.v1' | 'run.resume.v1',
) {
  return {
    outboxId: stepJobId(runId, sequence),
    type,
    ctx: tenant,
    payload: { runId, sequence, expectedVersion },
  } as const;
}

const abort = () => ({ signal: new AbortController().signal });

type Harness = Awaited<ReturnType<typeof setup>>;

async function operationsFor(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  h: Harness,
) {
  return ai.withTenant(0, (tx) =>
    h.operations.forRun(tx, { runId: h.runId, throughSequence: 64 }),
  );
}

async function runFor(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  h: Harness,
) {
  return ai.withTenant(0, (tx) => h.runs.find(tx, h.runId));
}

/** Mirrors the decide path: CAS the decision, transition the run, resume. */
async function decideAndResume(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  h: Harness,
  operationId: string,
  snapshotHash: string,
  decision: 'approve' | 'reject' | 'answer' | 'dismiss',
  result?: unknown,
) {
  const resume = await ai.withTenant(0, async (tx) => {
    const run = await h.runs.find(tx, h.runId);
    if (!run || run.status !== 'awaiting_approval')
      throw new Error('run is not awaiting a decision');
    const decided = await h.operations.decideApproval(tx, {
      runId: h.runId,
      operationId,
      snapshotHash,
      userId: h.tenant.userId,
      decision,
      ...(result !== undefined ? { result } : {}),
    });
    expect(decided).not.toBeNull();
    const sequence = run.nextSequence;
    const expectedVersion = run.runVersion + 1;
    expect(
      await h.runs.transition(tx, {
        runId: h.runId,
        expectedVersion: run.runVersion,
        from: 'awaiting_approval',
        to: 'running',
      }),
    ).toBe(true);
    await h.steps.insertInitial(tx, {
      id: randomUUID(),
      runId: h.runId,
      sequence,
      expectedVersion,
    });
    await h.outbox.append(
      tx,
      {
        type: 'run.resume.v1',
        ctx: h.tenant,
        payload: { runId: h.runId, sequence, expectedVersion },
      },
      { id: stepJobId(h.runId, sequence) },
    );
    return { sequence, expectedVersion };
  });
  await h.executor.execute(
    job(
      h.runId,
      h.tenant,
      resume.sequence,
      resume.expectedVersion,
      'run.resume.v1',
    ),
    abort(),
  );
}

async function advance(
  ai: Awaited<ReturnType<typeof createAiFixture>>,
  h: Harness,
  sequence: number,
) {
  const next = await ai.outboxForRunSequence(0, h.runId, sequence);
  expect(next).toMatchObject({ type: 'run.advance.v1' });
  const payload = next!.payload as {
    sequence: number;
    expectedVersion: number;
  };
  await h.executor.execute(
    job(
      h.runId,
      h.tenant,
      payload.sequence,
      payload.expectedVersion,
      'run.advance.v1',
    ),
    abort(),
  );
}

test('an ask_user proposal pauses the run on a question op with expiry in the same commit', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(
      ai,
      [toolScript([{ toolName: 'ask_user', input: questionInput }])],
      { tools: [askUser()], profile: f5Profile },
    );
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    const run = await runFor(ai, h);
    expect(run).toMatchObject({ status: 'awaiting_approval' });
    const operations = await operationsFor(ai, h);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      toolName: 'ask_user',
      kind: 'question',
      status: 'awaiting_approval',
      approvalRequired: true,
    });
    expect(operations[0]!.expiresAt).not.toBeNull();
    const step = await ai.withTenant(0, (tx) =>
      h.steps.find(tx, { runId: h.runId, sequence: 1 }),
    );
    expect(step).toMatchObject({ state: 'awaiting_approval' });
    // The run waits for the owner — no outbox job for sequence 2 yet.
    expect(await ai.outboxForRunSequence(0, h.runId, 2)).toBeNull();
  } finally {
    await ai.close();
  }
});

test('two pause proposals in one generation pause on the first and fail the second with one_decision_at_a_time', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(
      ai,
      [
        toolScript([
          { toolName: 'ask_user', input: questionInput },
          { toolName: 'rename_chat', input: { newTitle: 'Renamed' } },
        ]),
      ],
      { tools: [askUser(), renameChat()], profile: f5Profile },
    );
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    const operations = await operationsFor(ai, h);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      toolName: 'ask_user',
      kind: 'question',
      status: 'awaiting_approval',
    });
    expect(operations[1]).toMatchObject({
      toolName: 'rename_chat',
      kind: 'approval',
      status: 'failed',
      result: { refused: 'one_decision_at_a_time' },
    });
    expect(operations[1]!.completedAt).not.toBeNull();
    expect(operations[1]!.expiresAt).toBeNull();
    const run = await runFor(ai, h);
    expect(run).toMatchObject({ status: 'awaiting_approval' });
  } finally {
    await ai.close();
  }
});

test('the third ask_user proposal in a run persists failed question_limit and the run continues', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(
      ai,
      [
        toolScript([{ toolName: 'ask_user', input: questionInput }]),
        toolScript([{ toolName: 'ask_user', input: questionInput }]),
        toolScript([{ toolName: 'ask_user', input: questionInput }]),
        doneScript,
      ],
      { tools: [askUser()], profile: f5Profile },
    );
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    const answers = {
      answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
    };
    let operations = await operationsFor(ai, h);
    await decideAndResume(
      ai,
      h,
      operations[0]!.id,
      operations[0]!.snapshotHash,
      'answer',
      answers,
    );
    operations = await operationsFor(ai, h);
    await decideAndResume(
      ai,
      h,
      operations[1]!.id,
      operations[1]!.snapshotHash,
      'answer',
      answers,
    );
    operations = await operationsFor(ai, h);
    expect(operations).toHaveLength(3);
    expect(operations[0]).toMatchObject({ status: 'answered' });
    expect(operations[1]).toMatchObject({ status: 'answered' });
    expect(operations[2]).toMatchObject({
      toolName: 'ask_user',
      kind: 'question',
      status: 'failed',
      result: { refused: 'question_limit', maxPerRun: 2 },
    });
    // Approach F: the refusal is a stored result the model reads — the run
    // keeps going to a closing generation.
    await advance(ai, h, 4);
    expect(await runFor(ai, h)).toMatchObject({ status: 'completed' });
  } finally {
    await ai.close();
  }
});

test('an answered ask_user result reaches the next generation fenced as untrusted tool output', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const captured: ModelInput[] = [];
    const h = await setup(
      ai,
      [
        toolScript([{ toolName: 'ask_user', input: questionInput }]),
        doneScript,
      ],
      { tools: [askUser()], profile: f5Profile, captured },
    );
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    const operations = await operationsFor(ai, h);
    const answers = {
      answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
    };
    await decideAndResume(
      ai,
      h,
      operations[0]!.id,
      operations[0]!.snapshotHash,
      'answer',
      answers,
    );
    expect(await runFor(ai, h)).toMatchObject({ status: 'completed' });
    // The resume generation read the stored decision as a fenced tool result.
    const second = captured[1];
    expect(second).toBeDefined();
    const toolMessages = second!.messages.filter(
      (message) => message.role === 'tool',
    );
    expect(toolMessages).toHaveLength(1);
    const part = (
      toolMessages[0]!.content as unknown as readonly {
        result: { untrusted: string };
      }[]
    )[0]!;
    expect(part.result.untrusted).toContain('BEGIN UNTRUSTED CONTEXT');
    expect(part.result.untrusted).toContain('answered');
    expect(part.result.untrusted).toContain(`Tool result ${operations[0]!.id}`);
  } finally {
    await ai.close();
  }
});

test('a pending read op beside a pause op executes on the resumed continuation', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(
      ai,
      [
        toolScript([
          { toolName: 'fixture-read', input: { query: 'statute' } },
          { toolName: 'ask_user', input: questionInput },
        ]),
        doneScript,
      ],
      {
        tools: [readTool, askUser()],
        profile: { ...f5Profile, capabilities: ['chat.ask', 'chat.deadline'] },
      },
    );
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    let operations = await operationsFor(ai, h);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      toolName: 'fixture-read',
      status: 'pending',
    });
    expect(operations[1]).toMatchObject({
      toolName: 'ask_user',
      status: 'awaiting_approval',
    });
    expect(await runFor(ai, h)).toMatchObject({
      status: 'awaiting_approval',
    });
    // The read is still pending while the run pauses.
    await decideAndResume(
      ai,
      h,
      operations[1]!.id,
      operations[1]!.snapshotHash,
      'answer',
      { answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }] },
    );
    operations = await operationsFor(ai, h);
    expect(operations[0]).toMatchObject({
      toolName: 'fixture-read',
      status: 'succeeded',
    });
    expect(operations[0]!.result).toMatchObject({ lookedUp: 'statute' });
    await advance(ai, h, 3);
    expect(await runFor(ai, h)).toMatchObject({ status: 'completed' });
  } finally {
    await ai.close();
  }
});

test('a deadline_calculator refusal persists the failed op result verbatim and the run continues', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(
      ai,
      [
        toolScript([
          {
            toolName: 'deadline_calculator',
            input: {
              startDate: '2028-06-15',
              amount: 10,
              unit: 'working_days',
              countStartDay: false,
              nonWorkingDayRule: 'none',
            },
          },
        ]),
        doneScript,
      ],
      { tools: [deadlineCalculator()], profile: f5Profile },
    );
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    // The proposal is a read op — it executes on the advance continuation.
    await advance(ai, h, 2);
    const operations = await operationsFor(ai, h);
    expect(operations[0]).toMatchObject({
      toolName: 'deadline_calculator',
      status: 'failed',
      result: {
        refused: 'outside_calendar_range',
        coveredYears: [2026, 2027],
      },
    });
    await advance(ai, h, 3);
    expect(await runFor(ai, h)).toMatchObject({ status: 'completed' });
  } finally {
    await ai.close();
  }
});

test('an approved rename_chat executes once on resume and stamps the previous title', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const chatId = randomUUID();
    await ai.withTenant(0, (tx) =>
      new ChatRepository().insert(tx, chatId, 'Original title'),
    );
    const h = await setup(
      ai,
      [
        toolScript([
          { toolName: 'rename_chat', input: { newTitle: 'Renamed chat' } },
        ]),
        doneScript,
      ],
      {
        tools: [renameChat()],
        profile: { ...f5Profile, capabilities: ['chat.rename'] },
        resourceIds: [chatId],
      },
    );
    // lockLiveForRun only claims a resourceIds run once the run is linked
    // to the chat it names.
    await ai.withTenant(0, async (tx) => {
      if (!(await new ChatRepository().lockLive(tx, chatId)))
        throw new Error('Chat fixture unavailable');
      const { client } = requireSession(tx);
      await client.query(
        `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
         VALUES($1,$2,$3,'answer')`,
        [h.tenant.orgId, chatId, h.runId],
      );
    });
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    let operations = await operationsFor(ai, h);
    expect(operations[0]).toMatchObject({
      toolName: 'rename_chat',
      kind: 'approval',
      status: 'awaiting_approval',
    });
    expect(await runFor(ai, h)).toMatchObject({
      status: 'awaiting_approval',
    });
    await decideAndResume(
      ai,
      h,
      operations[0]!.id,
      operations[0]!.snapshotHash,
      'approve',
    );
    operations = await operationsFor(ai, h);
    expect(operations[0]).toMatchObject({
      status: 'succeeded',
      result: { renamed: true, previousTitle: 'Original title' },
    });
    const chat = await ai.withTenant(0, (tx) =>
      new ChatRepository().readLive(tx, chatId),
    );
    expect(chat).toMatchObject({
      title: 'Renamed chat',
      titleSource: 'user',
    });
  } finally {
    await ai.close();
  }
});

test('a proposal for a tool outside the run capabilities fails the run AI_INVALID_TOOL', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(
      ai,
      [toolScript([{ toolName: 'ask_user', input: questionInput }])],
      {
        tools: [askUser()],
        profile: { ...f5Profile, capabilities: [] },
      },
    );
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    const run = await runFor(ai, h);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'AI_INVALID_TOOL',
    });
  } finally {
    await ai.close();
  }
});

test('a run that burned its iterations on tool pauses fails AI_ITERATION_LIMIT with the standard surface', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const h = await setup(
      ai,
      [
        toolScript([{ toolName: 'ask_user', input: questionInput }]),
        toolScript([{ toolName: 'ask_user', input: questionInput }]),
      ],
      {
        tools: [askUser()],
        profile: { ...f5Profile, maxIterations: 2 },
      },
    );
    await h.executor.execute(
      job(h.runId, h.tenant, 1, 1, 'run.start.v1'),
      abort(),
    );
    const answers = {
      answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
    };
    let operations = await operationsFor(ai, h);
    await decideAndResume(
      ai,
      h,
      operations[0]!.id,
      operations[0]!.snapshotHash,
      'answer',
      answers,
    );
    operations = await operationsFor(ai, h);
    await decideAndResume(
      ai,
      h,
      operations[1]!.id,
      operations[1]!.snapshotHash,
      'answer',
      answers,
    );
    const run = await runFor(ai, h);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'AI_ITERATION_LIMIT',
    });
    expect(SafeErrorMessages.AI_ITERATION_LIMIT).toBe(
      'The AI could not complete this request. Please try again.',
    );
  } finally {
    await ai.close();
  }
});
