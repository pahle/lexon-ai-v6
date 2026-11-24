import {
  AskUserToolInputSchema,
  DeadlineCalculatorToolInputSchema,
  RenameChatToolInputSchema,
} from '@lexon/contracts';
import {
  AiRunRepository,
  ChatRepository,
  type TenantSession,
} from '../../infrastructure/db/index.js';
import { executeDeadlineCalculation } from './deadline-calculator.js';
import type {
  PauseToolDefinition,
  ReadToolDefinition,
  ToolDefinition,
  TransactionalWriteToolDefinition,
} from './run-contracts.js';

// The three F5 production tools (spec §10). `ask_user` is a pure pause tool —
// the stored decision is its result, so it has no execute. `rename_chat` is
// an approval-gated transactional write; on approve it renames the chat that
// started the run inside the step commit transaction.

const runs = new AiRunRepository();
const chats = new ChatRepository();

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function runChatId(resolvedConfig: unknown): string | null {
  const resources = record(resolvedConfig).resourceIds;
  if (!Array.isArray(resources)) return null;
  const chatId = resources[0];
  return typeof chatId === 'string' ? chatId : null;
}

const askUserTool: PauseToolDefinition = {
  id: 'ask_user',
  version: 1,
  kind: 'pause',
  interaction: 'question',
  pauseKind: 'question',
  idempotency: { mode: 'transactional' },
  inputSchema: AskUserToolInputSchema,
  timeoutMs: 5_000,
  maxResultBytes: 16_384,
  capabilities: ['chat.ask'],
  maxPerRun: 2,
};

const deadlineCalculatorTool: ReadToolDefinition = {
  id: 'deadline_calculator',
  version: 1,
  kind: 'read',
  pauseKind: null,
  inputSchema: DeadlineCalculatorToolInputSchema,
  timeoutMs: 5_000,
  maxResultBytes: 16_384,
  capabilities: ['chat.deadline'],
  execute: (input) => executeDeadlineCalculation(input),
};

const renameChatTool: TransactionalWriteToolDefinition = {
  id: 'rename_chat',
  version: 1,
  kind: 'write',
  pauseKind: 'approval',
  idempotency: { mode: 'transactional' },
  inputSchema: RenameChatToolInputSchema,
  timeoutMs: 5_000,
  maxResultBytes: 16_384,
  capabilities: ['chat.rename'],
  async execute(
    input: unknown,
    context: { runId: string; tenant: TenantSession },
  ) {
    const args = RenameChatToolInputSchema.parse(input);
    const run = await runs.find(context.tenant, context.runId);
    const chatId = run ? runChatId(run.resolvedConfig) : null;
    if (!chatId) throw new Error('AI run chat unavailable');
    const chat = await chats.lockLive(context.tenant, chatId);
    if (!chat) throw new Error('AI run chat unavailable');
    if (!(await chats.rename(context.tenant, chatId, args.newTitle)))
      throw new Error('AI chat rename refused');
    return { renamed: true, previousTitle: chat.title };
  },
};

export const CHAT_TOOLS: readonly ToolDefinition[] = Object.freeze([
  askUserTool,
  deadlineCalculatorTool,
  renameChatTool,
]);
