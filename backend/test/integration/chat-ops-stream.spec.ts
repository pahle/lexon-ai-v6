import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import {
  CHAT_STREAM_RECOVERY_HEADER,
  ChatPageSchema,
  ChatSnapshotFrameSchema,
  ChatTreeSchema,
} from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import type { INestApplication } from '@nestjs/common';
import {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
  TenantDatabase,
  hashOperationArgs,
  requireSession,
  type CommittedStreamReference,
} from '../../src/infrastructure/db/index.js';
import { RunStreams } from '../../src/infrastructure/queue/index.js';
import { createScriptedModelGateway } from '../../src/infrastructure/ai/index.js';
import type { ModelEvent } from '../../src/infrastructure/ai/index.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import {
  createProductionRunRegistry,
  ChatHistoryContextProvider,
  StepCoordinator,
  StepExecutor,
} from '../../src/modules/chat/index.js';
import { stepJobId } from '../../src/modules/chat/step-job-id.js';
import { JobExecutor } from '../../src/modules/platform/job-executor.js';
import { AttemptService } from '../../src/modules/usage/index.js';
import { OperationExpirySweep } from '../../src/modules/chat/expiry-sweep.js';

const questionArgs = {
  questions: [
    {
      questionId: 'q1',
      text: 'Which filing deadline applies?',
      kind: 'single',
      options: [{ label: '30 days' }, { label: '60 days' }],
    },
  ],
};

const approvalArgs = { newTitle: 'Renamed while paused' };

// ~6 KB of multibyte text (2000 chars × 3 bytes): over the 4 KiB event cap
// while under the 16 KiB stored-args limit — the cap counts bytes, not chars.
const oversizedQuestionArgs = {
  questions: [
    {
      questionId: 'q1',
      text: '…'.repeat(2000),
      kind: 'single',
      options: [{ label: 'First' }, { label: 'Second' }],
    },
  ],
};

async function identityOf(
  origin: string,
  headers: Record<string, string>,
): Promise<{ orgId: string; userId: string }> {
  const identity = (await (
    await fetch(`${origin}/api/identity`, { headers })
  ).json()) as { user: { id: string }; organization: { id: string } };
  return { orgId: identity.organization.id, userId: identity.user.id };
}

async function createChat(
  origin: string,
  headers: Record<string, string>,
): Promise<{
  chatId: string;
  userMessageId: string;
  runId: string;
  assistantMessageId: string;
}> {
  const chatId = randomUUID();
  const userMessageId = randomUUID();
  const created = await fetch(`${origin}/api/chats`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      chatId,
      userMessageId,
      requestId: randomUUID(),
      text: 'Paused ops stream fixture',
      effort: 'high',
    }),
  });
  expect(created.status).toBe(201);
  const mutation = (await created.json()) as {
    assistantMessageId: string;
    runId: string;
  };
  return {
    chatId,
    userMessageId,
    runId: mutation.runId,
    assistantMessageId: mutation.assistantMessageId,
  };
}

interface PausedSeed {
  chatId: string;
  assistantMessageId: string;
  runId: string;
  operationId: string;
  snapshotHash: string;
  pendingOperationIds: string[];
  step: {
    id: string;
    sequence: number;
    expectedVersion: number;
    fence: number;
  };
  tenant: { orgId: string; userId: string };
}

/**
 * Parks an API-created chat run on a real paused step: claims step 1 (so the
 * op rows bind a claimed fence), optionally creates the run's Valkey stream
 * state via a `start` event, then persists the paused op plus leftover
 * pending ops and walks the run queued → running → awaiting_approval.
 */
async function seedPausedRun(
  app: INestApplication,
  headers: Record<string, string>,
  options: {
    kind: 'approval' | 'question';
    args?: unknown;
    pendingOps?: number;
    publishStart?: boolean;
    expiredHoursAgo?: number;
  },
): Promise<PausedSeed> {
  const origin = await app.getUrl();
  const chat = await createChat(origin, headers);
  const tenant = await identityOf(origin, headers);
  const database = app.get(TenantDatabase);
  const steps = new AiStepRepository();
  const runs = new AiRunRepository();
  const operations = new AiOperationRepository();
  const claim = await database.withTenant(tenant, async (tx) => {
    const claimed = await steps.claim(tx, {
      runId: chat.runId,
      sequence: 1,
      expectedVersion: 1,
      leaseMs: 60_000,
    });
    if (!claimed) throw new Error('Fixture step claim failed');
    return claimed.claim;
  });
  if (options.publishStart) {
    expect(
      await app.get(RunStreams).publish(claim, {
        version: 1,
        runId: chat.runId,
        type: 'start',
        messageId: chat.runId,
      }),
    ).toBe('written');
  }
  const args =
    options.args ?? (options.kind === 'question' ? questionArgs : approvalArgs);
  const pendingOperationIds: string[] = [];
  const operation = await database.withTenant(tenant, async (tx) => {
    const { client } = requireSession(tx);
    await client.query(
      `UPDATE app.ai_steps SET state='awaiting_approval' WHERE id=$1`,
      [claim.stepId],
    );
    const persisted = await operations.persist(tx, claim, {
      callOccurrence: 0,
      toolName: options.kind === 'question' ? 'ask_user' : 'rename_chat',
      toolVersion: 1,
      mode: 'transactional',
      args,
      argsHash: hashOperationArgs(args),
      snapshotHash: createHash('sha256')
        .update(`paused-${options.kind}-${randomUUID()}`)
        .digest('hex'),
      approvalRequired: true,
      kind: options.kind,
    });
    for (let index = 0; index < (options.pendingOps ?? 0); index += 1) {
      const pendingArgs = { read: `leftover-${index}` };
      const pending = await operations.persist(tx, claim, {
        callOccurrence: index + 1,
        toolName: 'fixture-read',
        toolVersion: 1,
        mode: 'read',
        args: pendingArgs,
        argsHash: hashOperationArgs(pendingArgs),
        snapshotHash: createHash('sha256')
          .update(`pending-${randomUUID()}`)
          .digest('hex'),
        approvalRequired: false,
      });
      pendingOperationIds.push(pending.id);
    }
    if (
      !(await runs.transition(tx, {
        runId: chat.runId,
        expectedVersion: 1,
        from: 'queued',
        to: 'running',
      })) ||
      !(await runs.transition(tx, {
        runId: chat.runId,
        expectedVersion: 2,
        from: 'running',
        to: 'awaiting_approval',
        nextSequence: 2,
      }))
    )
      throw new Error('Fixture run transition failed');
    if (options.expiredHoursAgo)
      await client.query(
        `UPDATE app.ai_operations
         SET expires_at=clock_timestamp()-interval '1 hour' * $2 WHERE id=$1`,
        [persisted.id, options.expiredHoursAgo],
      );
    return persisted;
  });
  return {
    chatId: chat.chatId,
    assistantMessageId: chat.assistantMessageId,
    runId: chat.runId,
    operationId: operation.id,
    snapshotHash: operation.snapshotHash,
    pendingOperationIds,
    step: {
      id: claim.stepId,
      sequence: claim.sequence,
      expectedVersion: claim.expectedVersion,
      fence: claim.fence,
    },
    tenant,
  };
}

function sendMessage(
  origin: string,
  headers: Record<string, string>,
  chatId: string,
  body: Record<string, unknown>,
) {
  return fetch(`${origin}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function decideCall(
  origin: string,
  headers: Record<string, string>,
  runId: string,
  operationId: string,
  body: unknown,
) {
  return fetch(
    `${origin}/api/runs/${runId}/operations/${operationId}/decision`,
    {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

async function readEvent(
  stream: SseBuffer | ReadableStreamDefaultReader<Uint8Array>,
) {
  return Promise.race([
    readEventFrame(stream),
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for SSE event')),
        3000,
      );
      timeout.unref();
    }),
  ]);
}

interface SseBuffer {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  pending: string;
}

function sseBuffer(reader: ReadableStreamDefaultReader<Uint8Array>): SseBuffer {
  return { reader, decoder: new TextDecoder(), pending: '' };
}

async function readEventFrame(
  stream: SseBuffer | ReadableStreamDefaultReader<Uint8Array>,
) {
  const buffer = 'pending' in stream ? stream : sseBuffer(stream);
  for (;;) {
    const separator = buffer.pending.indexOf('\n\n');
    if (separator >= 0) {
      const frame = buffer.pending.slice(0, separator);
      buffer.pending = buffer.pending.slice(separator + 2);
      if (frame.startsWith(': ')) return frame;
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      if (data) return data.slice('data: '.length);
      continue;
    }
    const { done, value } = await buffer.reader.read();
    if (done) throw new Error('SSE stream closed before event');
    buffer.pending += buffer.decoder.decode(value, { stream: true });
  }
}

async function expectNoEvent(
  stream: SseBuffer | ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  const buffer = 'pending' in stream ? stream : sseBuffer(stream);
  if (buffer.pending.includes('\n\n'))
    throw new Error('Expected a quiet stream but a frame is buffered');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    buffer.reader.read().then(() => 'event'),
    new Promise<'quiet'>((resolve) => {
      timeout = setTimeout(() => resolve('quiet'), 150);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  expect(result).toBe('quiet');
}

/** Collects run-stream frames until `snapshot-end`, then detaches. */
async function readSnapshotFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<unknown[]> {
  const buffer = sseBuffer(reader);
  const frames: unknown[] = [];
  for (let index = 0; index < 64; index += 1) {
    const data = await readEvent(buffer);
    if (typeof data !== 'string') continue;
    const parsed = JSON.parse(data) as { type?: string };
    frames.push(parsed);
    if (parsed.type === 'snapshot-end') return frames;
  }
  throw new Error('Snapshot frames did not terminate');
}

async function runStreamEvents(
  prefix: string,
  url: string,
  runId: string,
): Promise<Record<string, unknown>[]> {
  const redis = new Redis(url);
  try {
    const entries = await redis.xrange(
      `${prefix}:{run-streams}:${runId}:events`,
      '-',
      '+',
    );
    return entries.map(([, fields]) => {
      const eventIndex = fields.indexOf('event');
      return JSON.parse(fields[eventIndex + 1]!) as Record<string, unknown>;
    });
  } finally {
    redis.disconnect();
  }
}

test('snapshot recovery drops oversized operation payloads but keeps ids and hash', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-ops-stream-cap.json'),
    ),
  );
  const opened: Response[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, {
      kind: 'question',
      args: oversizedQuestionArgs,
    });
    const response = await fetch(`${origin}/api/runs/${seeded.runId}/events`, {
      headers: { ...headers, [CHAT_STREAM_RECOVERY_HEADER]: 'snapshot' },
    });
    opened.push(response);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const frames = (await readSnapshotFrames(reader)).map((frame) =>
      ChatSnapshotFrameSchema.parse(frame),
    );
    const start = frames.find((frame) => frame.type === 'snapshot-start');
    expect(start).toBeDefined();
    const operationFrame = frames.find(
      (frame) => frame.type === 'snapshot-operation',
    );
    expect(operationFrame).toBeDefined();
    if (operationFrame?.type !== 'snapshot-operation')
      throw new Error('missing operation frame');
    expect(operationFrame.operation).toMatchObject({
      operationId: seeded.operationId,
      kind: 'question',
      status: 'awaiting_approval',
      approvalRequired: true,
      snapshotHash: seeded.snapshotHash,
      toolName: 'ask_user',
    });
    expect(operationFrame.operation).not.toHaveProperty('input');
    expect(operationFrame.operation).not.toHaveProperty('display');
    expect(operationFrame.operation).not.toHaveProperty('output');
    // The tool part survives identically capped: ids, tool name and outcome.
    const toolPart = frames.find(
      (frame) => frame.type === 'snapshot-part' && frame.partType === 'tool',
    );
    expect(toolPart).toBeDefined();
    if (toolPart?.type !== 'snapshot-part' || toolPart.partType !== 'tool')
      throw new Error('missing tool part');
    expect(toolPart).toMatchObject({
      id: seeded.operationId,
      toolCallId: seeded.operationId,
      toolName: 'ask_user',
      operationId: seeded.operationId,
      outcome: 'awaiting_approval',
      final: true,
    });
    expect(toolPart).not.toHaveProperty('input');
    expect(toolPart).not.toHaveProperty('output');
    await reader.cancel();
  } finally {
    for (const response of opened)
      await response.body?.cancel().catch(() => {});
    await app.close();
  }
});

test('snapshot recovery replays tool parts with input and output intact', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-ops-stream-replay.json'),
    ),
  );
  const opened: Response[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, {
      kind: 'question',
      pendingOps: 1,
    });
    const response = await fetch(`${origin}/api/runs/${seeded.runId}/events`, {
      headers: { ...headers, [CHAT_STREAM_RECOVERY_HEADER]: 'snapshot' },
    });
    opened.push(response);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const frames = (await readSnapshotFrames(reader)).map((frame) =>
      ChatSnapshotFrameSchema.parse(frame),
    );
    const toolParts = frames.filter(
      (frame) => frame.type === 'snapshot-part' && frame.partType === 'tool',
    );
    expect(toolParts).toHaveLength(2);
    const paused = toolParts.find(
      (frame) =>
        frame.type === 'snapshot-part' &&
        frame.partType === 'tool' &&
        frame.operationId === seeded.operationId,
    );
    if (paused?.type !== 'snapshot-part' || paused.partType !== 'tool')
      throw new Error('missing paused tool part');
    expect(paused).toMatchObject({
      id: seeded.operationId,
      toolCallId: seeded.operationId,
      toolName: 'ask_user',
      operationId: seeded.operationId,
      outcome: 'awaiting_approval',
      final: true,
    });
    expect(paused.input).toEqual(questionArgs);
    const leftover = toolParts.find(
      (frame) =>
        frame.type === 'snapshot-part' &&
        frame.partType === 'tool' &&
        frame.operationId === seeded.pendingOperationIds[0],
    );
    if (leftover?.type !== 'snapshot-part' || leftover.partType !== 'tool')
      throw new Error('missing leftover tool part');
    expect(leftover).toMatchObject({
      toolName: 'fixture-read',
      outcome: 'pending',
    });
    expect(leftover.input).toEqual({ read: 'leftover-0' });
    const operationFrames = frames.filter(
      (frame) => frame.type === 'snapshot-operation',
    );
    expect(operationFrames).toHaveLength(2);
    const pausedSummary = operationFrames.find(
      (frame) =>
        frame.type === 'snapshot-operation' &&
        frame.operation.operationId === seeded.operationId,
    );
    if (pausedSummary?.type !== 'snapshot-operation')
      throw new Error('missing paused summary');
    expect(pausedSummary.operation).toMatchObject({
      operationId: seeded.operationId,
      kind: 'question',
      status: 'awaiting_approval',
      snapshotHash: seeded.snapshotHash,
      toolName: 'ask_user',
      input: questionArgs,
    });
    await reader.cancel();
  } finally {
    for (const response of opened)
      await response.body?.cancel().catch(() => {});
    await app.close();
  }
});

test('list flags awaitingUser while paused and the tree carries operation summaries', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-ops-awaiting.json'),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, { kind: 'approval' });

    const listedPaused = ChatPageSchema.parse(
      await (await fetch(`${origin}/api/chats`, { headers })).json(),
    );
    const pausedItem = listedPaused.items.find(
      (item) => item.id === seeded.chatId,
    );
    expect(pausedItem?.awaitingUser).toBe(true);

    const treePaused = ChatTreeSchema.parse(
      await (
        await fetch(`${origin}/api/chats/${seeded.chatId}`, { headers })
      ).json(),
    );
    const assistant = treePaused.messages.find(
      (message) => message.role === 'assistant',
    );
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role !== 'assistant')
      throw new Error('missing assistant message');
    expect(assistant.operations).toHaveLength(1);
    expect(assistant.operations[0]).toMatchObject({
      operationId: seeded.operationId,
      kind: 'approval',
      status: 'awaiting_approval',
      approvalRequired: true,
      snapshotHash: seeded.snapshotHash,
      toolName: 'rename_chat',
      input: approvalArgs,
      display: { currentTitle: 'Paused ops stream fixture' },
    });

    const decided = await decideCall(
      origin,
      headers,
      seeded.runId,
      seeded.operationId,
      { snapshotHash: seeded.snapshotHash, action: 'reject' },
    );
    expect(decided.status).toBe(200);

    const listedDecided = ChatPageSchema.parse(
      await (await fetch(`${origin}/api/chats`, { headers })).json(),
    );
    const decidedItem = listedDecided.items.find(
      (item) => item.id === seeded.chatId,
    );
    expect(decidedItem?.awaitingUser).toBe(false);

    const treeDecided = ChatTreeSchema.parse(
      await (
        await fetch(`${origin}/api/chats/${seeded.chatId}`, { headers })
      ).json(),
    );
    const decidedAssistant = treeDecided.messages.find(
      (message) => message.role === 'assistant',
    );
    if (decidedAssistant?.role !== 'assistant')
      throw new Error('missing assistant message');
    expect(decidedAssistant.operations[0]).toMatchObject({
      operationId: seeded.operationId,
      status: 'rejected',
    });
    expect(decidedAssistant.operations[0]?.decidedAt).not.toBeNull();
  } finally {
    await app.close();
  }
});

test('a superseding send emits operation-status and tool-output events on the dead run stream', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-ops-supersede.json'),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, {
      kind: 'approval',
      pendingOps: 1,
      publishStart: true,
    });

    const response = await sendMessage(origin, headers, seeded.chatId, {
      userMessageId: randomUUID(),
      parentMessageId: seeded.assistantMessageId,
      text: 'Skip that entirely',
      effort: 'high',
    });
    expect(response.status).toBe(201);

    const events = await runStreamEvents(
      services.queuePrefix,
      services.valkey.streamsUrl,
      seeded.runId,
    );
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('start');
    const settledStatus = events.find(
      (event) =>
        event.type === 'operation-status' &&
        event.operationId === seeded.operationId,
    );
    expect(settledStatus).toMatchObject({
      version: 1,
      runId: seeded.runId,
      type: 'operation-status',
      operationId: seeded.operationId,
      status: 'rejected',
    });
    const denied = events.find(
      (event) =>
        event.type === 'tool-output-denied' &&
        event.toolCallId === seeded.operationId,
    );
    expect(denied).toMatchObject({
      version: 1,
      runId: seeded.runId,
      type: 'tool-output-denied',
      toolCallId: seeded.operationId,
    });
    const leftoverStatus = events.find(
      (event) =>
        event.type === 'operation-status' &&
        event.operationId === seeded.pendingOperationIds[0],
    );
    expect(leftoverStatus).toMatchObject({
      type: 'operation-status',
      status: 'failed',
    });
    const leftoverOutput = events.find(
      (event) =>
        event.type === 'tool-output-available' &&
        event.operationId === seeded.pendingOperationIds[0],
    );
    expect(leftoverOutput).toMatchObject({
      type: 'tool-output-available',
      toolCallId: seeded.pendingOperationIds[0],
      output: { not_run: 'superseded_by_message' },
    });
    expect(types.slice(-2)).toEqual(['status', 'finish']);
  } finally {
    await app.close();
  }
});

test('committed stream proofs authorize operation lifecycle events against the paused step', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-ops-proofs.json'),
    ),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const headers = await apiHeaders(app);
    const seeded = await seedPausedRun(app, headers, { kind: 'question' });
    const database = app.get(TenantDatabase);
    const claim: CommittedStreamReference = {
      runId: seeded.runId,
      orgId: seeded.tenant.orgId,
      userId: seeded.tenant.userId,
      stepId: seeded.step.id,
      sequence: seeded.step.sequence,
      expectedVersion: seeded.step.expectedVersion,
      fence: seeded.step.fence,
      committedRunVersion: 3,
      committedStatus: 'awaiting_approval',
    };
    const steps = new AiStepRepository();
    const proof = (event: Record<string, unknown>) =>
      database.withTenant(seeded.tenant, (tx) =>
        steps.streamCommittedProof(tx, claim, event as never),
      );

    // Any op row authorizes its input event.
    expect(
      await proof({
        version: 1,
        runId: seeded.runId,
        type: 'tool-input-available',
        toolCallId: seeded.operationId,
        toolName: 'ask_user',
        operationId: seeded.operationId,
        input: questionArgs,
      }),
    ).toBeDefined();
    // A question op authorizes question-required but never approval-required.
    expect(
      await proof({
        version: 1,
        runId: seeded.runId,
        type: 'question-required',
        operationId: seeded.operationId,
        kind: 'question',
      }),
    ).toBeDefined();
    expect(
      await proof({
        version: 1,
        runId: seeded.runId,
        type: 'approval-required',
        operationId: seeded.operationId,
        kind: 'approval',
      }),
    ).toBeUndefined();
    // Unsettled ops never authorize output events.
    expect(
      await proof({
        version: 1,
        runId: seeded.runId,
        type: 'tool-output-available',
        toolCallId: seeded.operationId,
        operationId: seeded.operationId,
        output: {},
      }),
    ).toBeUndefined();
    expect(
      await proof({
        version: 1,
        runId: seeded.runId,
        type: 'operation-status',
        operationId: seeded.operationId,
        status: 'awaiting_approval',
      }),
    ).toBeDefined();
  } finally {
    await app.close();
  }
});

test('pausing, deciding, superseding and expiring each deliver chat.invalidated on the owner stream', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-ops-invalidate.json'),
    ),
  );
  const opened: Response[] = [];
  try {
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const headers = await apiHeaders(app);
    const tenant = await identityOf(origin, headers);
    const database = app.get(TenantDatabase);

    const eventsResponse = await fetch(`${origin}/api/chats/events`, {
      headers,
    });
    opened.push(eventsResponse);
    expect(eventsResponse.status).toBe(200);
    const reader = eventsResponse.body!.getReader();
    const events = sseBuffer(reader);
    await expect(readEvent(events)).resolves.toBe(': connected');
    const expectInvalidated = async (chatId: string) => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const data = await readEvent(events);
        if (typeof data !== 'string' || data.startsWith(':')) continue;
        const event = JSON.parse(data) as Record<string, unknown>;
        if (event.chatId !== chatId) continue;
        expect(event).toEqual({
          version: 1,
          type: 'chat.invalidated',
          chatId,
        });
        return;
      }
      throw new Error(`No chat.invalidated for ${chatId}`);
    };

    // Pause: a real ask_user proposal commits the paused step; the lifecycle
    // publisher notifies lexon_chat_title at its read-tx commit.
    const paused = await createChat(origin, headers);
    const askUserProposal: Extract<ModelEvent, { type: 'tool-proposal' }> = {
      type: 'tool-proposal',
      toolCallId: 'call-0',
      toolName: 'ask_user',
      input: questionArgs as never,
    };
    const gateway = createScriptedModelGateway([
      {
        events: [
          askUserProposal,
          {
            type: 'usage' as const,
            usage: { inputTokens: 20, outputTokens: 3 },
          },
          {
            type: 'outcome' as const,
            outcome: {
              finishReason: 'tool_calls' as const,
              attemptOutcome: 'succeeded' as const,
              retryable: false,
              usage: { inputTokens: 20, outputTokens: 3 },
            },
          },
        ],
      },
    ]);
    const runs = new AiRunRepository();
    const steps = new AiStepRepository();
    const operations = new AiOperationRepository();
    const outbox = new OutboxRepository();
    const executor = new StepExecutor({
      database,
      runs,
      steps,
      operations,
      facts: new RunActorFactsRepository(),
      authorization: new RunAuthorizationService(),
      coordinator: new StepCoordinator(
        database,
        runs,
        steps,
        new AttemptService(),
        outbox,
        new JobExecutor(database),
        undefined,
        operations,
      ),
      attempts: new AttemptService(),
      registry: createProductionRunRegistry([
        new ChatHistoryContextProvider(database),
      ]),
      gateway,
      streams: app.get(RunStreams),
    });
    await executor.execute(
      {
        outboxId: stepJobId(paused.runId, 1),
        type: 'run.start.v1',
        ctx: tenant,
        payload: { runId: paused.runId, sequence: 1, expectedVersion: 1 },
      },
      { signal: new AbortController().signal },
    );
    await expectInvalidated(paused.chatId);

    // Decide: the decide transaction notifies before commit.
    const deciding = await seedPausedRun(app, headers, { kind: 'approval' });
    const decided = await decideCall(
      origin,
      headers,
      deciding.runId,
      deciding.operationId,
      { snapshotHash: deciding.snapshotHash, action: 'reject' },
    );
    expect(decided.status).toBe(200);
    await expectInvalidated(deciding.chatId);

    // Supersede: the send transaction notifies before commit.
    const superseded = await seedPausedRun(app, headers, { kind: 'approval' });
    const sent = await sendMessage(origin, headers, superseded.chatId, {
      userMessageId: randomUUID(),
      parentMessageId: superseded.assistantMessageId,
      text: 'Skip it',
      effort: 'high',
    });
    expect(sent.status).toBe(201);
    await expectInvalidated(superseded.chatId);

    // Expiry: the sweep's per-candidate transaction notifies before commit.
    const expiring = await seedPausedRun(app, headers, {
      kind: 'approval',
      expiredHoursAgo: 1,
    });
    const sweep = new OperationExpirySweep({
      database,
      runs,
      steps,
      operations: new AiOperationRepository(database),
      facts: new RunActorFactsRepository(),
      authorization: new RunAuthorizationService(),
      outbox,
      registry: createProductionRunRegistry(),
      logger: { warn: () => undefined },
    });
    await sweep.sweep();
    await expectInvalidated(expiring.chatId);
    await expectNoEvent(events);
    await reader.cancel();
  } finally {
    for (const response of opened)
      await response.body?.cancel().catch(() => {});
    await app.close();
  }
});
