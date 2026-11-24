import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ModelEvent } from '../../src/infrastructure/ai/index.js';
import {
  canonicalJson,
  hashOperationArgs,
  type OperationRecord,
} from '../../src/infrastructure/db/index.js';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';
import {
  prepareOperationProposals,
  RunRegistry,
  toolResultsAsMessages,
  type ToolDefinition,
} from '../../src/modules/chat/index.js';
import { AskUserToolInputSchema } from '@lexon/contracts';

const readTool = {
  id: 'fixture-read',
  version: 1,
  kind: 'read',
  inputSchema: z.strictObject({ query: z.string() }),
  pauseKind: null,
  timeoutMs: 5000,
  maxResultBytes: 16384,
  capabilities: ['fixture.read'],
  execute: async () => ({ ok: true }),
} as const satisfies ToolDefinition;

const questionTool = {
  id: 'ask_user',
  version: 1,
  kind: 'pause',
  interaction: 'question',
  inputSchema: AskUserToolInputSchema,
  pauseKind: 'question',
  idempotency: { mode: 'transactional' },
  maxPerRun: 2,
  timeoutMs: 5000,
  maxResultBytes: 16384,
  capabilities: ['chat.ask'],
} as const satisfies ToolDefinition;

const approvalTool = {
  id: 'fixture-write',
  version: 1,
  kind: 'write',
  inputSchema: z.strictObject({ value: z.string() }),
  pauseKind: 'approval',
  idempotency: { mode: 'transactional' },
  timeoutMs: 5000,
  maxResultBytes: 16384,
  capabilities: ['fixture.write'],
  execute: async () => ({ ok: true }),
} as const satisfies ToolDefinition;

const tools: readonly ToolDefinition[] = [readTool, questionTool, approvalTool];
const capabilities = ['fixture.read', 'chat.ask', 'fixture.write'];

function registry(extra: readonly ToolDefinition[] = []) {
  const runRegistry = new RunRegistry();
  runRegistry.register({
    profiles: [
      {
        id: 'test-profile',
        version: 1,
        allowedModels: ['provider/model'],
        defaultModel: 'provider/model',
        queue: 'ai-interactive',
        priority: 5,
        maxIterations: 6,
        tokenBudget: 1000,
        maxOutputTokens: 128,
        contextBudgets: {},
        capabilities,
      },
    ],
    contexts: [],
    tools: [...tools, ...extra],
  });
  return runRegistry;
}

function proposal(
  toolName: string,
  input: unknown,
  toolCallId = `${toolName}-call`,
): Extract<ModelEvent, { type: 'tool-proposal' }> {
  return {
    type: 'tool-proposal',
    toolCallId,
    toolName,
    input: input as never,
  };
}

const questionInput = {
  questions: [
    {
      questionId: 'q1',
      text: 'Which contract type?',
      kind: 'single',
      options: [{ label: 'NDA' }, { label: 'MSA' }],
    },
  ],
};

function priorOp(toolName: string): OperationRecord {
  return {
    id: 'op-prior',
    orgId: 'org',
    runId: 'run',
    stepId: 'step',
    callOccurrence: 0,
    toolName,
    toolVersion: 1,
    mode: 'read',
    args: {},
    argsHash: hashOperationArgs({}),
    snapshotHash: 'a'.repeat(64),
    approvalRequired: false,
    kind: 'question',
    status: 'answered',
    result: null,
    errorCode: null,
    createdAt: new Date(),
    completedAt: new Date(),
    expiresAt: null,
    decision: 'answer',
    decidedByUserId: 'user',
    decidedAt: new Date(),
  };
}

describe('prepareOperationProposals', () => {
  it('propagates kind from the tool definition and pauses a question tool', () => {
    const prepared = prepareOperationProposals(
      [
        proposal('fixture-read', { query: 'statute' }),
        proposal('ask_user', questionInput),
      ],
      registry(),
      capabilities,
      [],
    );
    expect(prepared).not.toBeNull();
    expect(prepared!.operations).toHaveLength(2);
    expect(prepared!.operations[0]).toMatchObject({
      callOccurrence: 0,
      toolName: 'fixture-read',
      mode: 'read',
      approvalRequired: false,
      kind: 'approval',
    });
    expect(prepared!.operations[1]).toMatchObject({
      callOccurrence: 1,
      toolName: 'ask_user',
      mode: 'transactional',
      approvalRequired: true,
      kind: 'question',
    });
  });

  it('propagates approval kind on a pause-gated write tool', () => {
    const prepared = prepareOperationProposals(
      [proposal('fixture-write', { value: 'rename' })],
      registry(),
      capabilities,
      [],
    );
    expect(prepared!.operations[0]).toMatchObject({
      mode: 'transactional',
      approvalRequired: true,
      kind: 'approval',
    });
  });

  it('persists extra same-generation pause proposals as failed refusals', () => {
    const prepared = prepareOperationProposals(
      [
        proposal('ask_user', questionInput),
        proposal('fixture-write', { value: 'rename' }),
      ],
      registry(),
      capabilities,
      [],
    );
    expect(prepared!.operations).toHaveLength(1);
    expect(prepared!.operations[0]!.kind).toBe('question');
    expect(prepared!.refusals).toHaveLength(1);
    expect(prepared!.refusals[0]!.operation).toMatchObject({
      callOccurrence: 1,
      toolName: 'fixture-write',
      kind: 'approval',
    });
    expect(prepared!.refusals[0]!.result).toEqual({
      refused: 'one_decision_at_a_time',
    });
  });

  it('limits ask_user to two proposals per run counting prior and same-generation calls', () => {
    // Two prior ask_user ops → a further proposal refuses with the limit.
    const limited = prepareOperationProposals(
      [proposal('ask_user', questionInput)],
      registry(),
      capabilities,
      [priorOp('ask_user'), priorOp('ask_user')],
    );
    expect(limited!.operations).toHaveLength(0);
    expect(limited!.refusals).toHaveLength(1);
    expect(limited!.refusals[0]!.result).toEqual({
      refused: 'question_limit',
      maxPerRun: 2,
    });

    // One prior + two proposals in the same generation: the first counts
    // toward the limit, the second hits the one-pause rule first.
    const sameGeneration = prepareOperationProposals(
      [
        proposal('ask_user', questionInput),
        proposal('ask_user', questionInput),
      ],
      registry(),
      capabilities,
      [priorOp('ask_user')],
    );
    expect(sameGeneration!.operations).toHaveLength(1);
    expect(sameGeneration!.refusals).toHaveLength(1);
    expect(sameGeneration!.refusals[0]!.result).toEqual({
      refused: 'one_decision_at_a_time',
    });

    // One prior + one proposal → accepted (second ask_user of the run).
    const withinLimit = prepareOperationProposals(
      [proposal('ask_user', questionInput)],
      registry(),
      capabilities,
      [priorOp('ask_user')],
    );
    expect(withinLimit!.operations).toHaveLength(1);
    expect(withinLimit!.refusals).toHaveLength(0);
  });

  it('fails closed on an unregistered or non-permitted tool (AI_INVALID_TOOL)', () => {
    expect(
      prepareOperationProposals(
        [proposal('unregistered', {})],
        registry(),
        capabilities,
        [],
      ),
    ).toBeNull();
    // Capability not granted → null (the caller maps to AI_INVALID_TOOL).
    expect(
      prepareOperationProposals(
        [proposal('ask_user', questionInput)],
        registry(),
        ['fixture.read'],
        [],
      ),
    ).toBeNull();
  });

  it('fails closed on schema-invalid input', () => {
    expect(
      prepareOperationProposals(
        [proposal('ask_user', { questions: [] })],
        registry(),
        capabilities,
        [],
      ),
    ).toBeNull();
  });
});

describe('toolResultsAsMessages', () => {
  const base = (overrides: Partial<OperationRecord>): OperationRecord => ({
    ...priorOp('ask_user'),
    id: 'op-1',
    args: questionInput,
    argsHash: hashOperationArgs(questionInput),
    snapshotHash: canonicalOperationHash({
      toolId: 'ask_user',
      toolVersion: 1,
      args: questionInput,
    }),
    ...overrides,
  });

  it('feeds a stored question decision to the next generation fenced', () => {
    const answers = {
      answers: [{ questionId: 'q1', choice: { kind: 'option', index: 0 } }],
    };
    const messages = toolResultsAsMessages([
      base({ status: 'answered', result: answers }),
    ]);
    expect(messages).toHaveLength(2);
    const result = messages[1]!;
    expect(result.role).toBe('tool');
    const serialized = canonicalJson(answers);
    const part = (
      result.content as readonly {
        result: { untrusted: string };
      }[]
    )[0]!;
    expect(part.result.untrusted.startsWith('BEGIN UNTRUSTED CONTEXT')).toBe(
      true,
    );
    expect(part.result.untrusted).toContain('END UNTRUSTED CONTEXT');
    expect(part.result.untrusted).toContain(serialized);
    // The answers payload reaches the model only inside the fence, never raw.
    expect(part.result.untrusted.indexOf(serialized)).toBeGreaterThan(
      'BEGIN UNTRUSTED CONTEXT'.length,
    );
  });

  it('feeds dismissed and expired question ops to the next generation', () => {
    const messages = toolResultsAsMessages([
      base({ status: 'dismissed', result: { answered_in_chat: true } }),
      base({
        id: 'op-2',
        status: 'expired',
        result: { unanswered: true },
      }),
    ]);
    expect(messages).toHaveLength(4);
    const contents = messages
      .filter((message) => message.role === 'tool')
      .map(
        (message) =>
          (
            message.content as unknown as readonly {
              result: { untrusted: string };
            }[]
          )[0]!.result.untrusted,
      );
    expect(contents[0]).toContain('answered_in_chat');
    expect(contents[1]).toContain('unanswered');
    for (const content of contents)
      expect(content).toContain('BEGIN UNTRUSTED CONTEXT');
  });

  it('skips undecided pause ops', () => {
    const messages = toolResultsAsMessages([
      base({ status: 'awaiting_approval', result: null }),
      base({ id: 'op-2', status: 'pending', result: null }),
      base({ id: 'op-3', status: 'approved', result: null }),
    ]);
    expect(messages).toHaveLength(0);
  });
});
