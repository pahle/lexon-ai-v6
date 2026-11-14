import type { RunProfile } from './run-contracts.js';
import { CHAT_INSTRUCTIONS } from './chat-instructions.js';
import { CHAT_TITLE_INSTRUCTIONS } from './chat-title-instructions.js';

const MODEL = 'openai/gpt-6-luna';
export const CHAT_HISTORY_CONTEXT_ID = 'chat-history';

export const CHAT_PROFILES = Object.freeze({
  chat: Object.freeze({
    id: 'chat',
    version: 1,
    allowedModels: [MODEL],
    defaultModel: MODEL,
    queue: 'ai-interactive',
    priority: 1,
    maxIterations: 1,
    tokenBudget: 360_448,
    maxOutputTokens: 16_384,
    maxAttemptsPerStep: 2,
    contextBudgets: { [CHAT_HISTORY_CONTEXT_ID]: 131_072 },
    capabilities: [],
    instructions: CHAT_INSTRUCTIONS,
    reasoning: {
      allowed: ['high', 'max'],
      default: 'high',
      outputLimits: { high: 16_384, max: 32_768 },
      runBudgets: { high: 360_448, max: 393_216 },
    },
    maxEstimatedInputTokens: 163_840,
  } satisfies RunProfile),
  title: Object.freeze({
    id: 'chat-title',
    version: 1,
    allowedModels: [MODEL],
    defaultModel: MODEL,
    queue: 'ai-batch',
    priority: 5,
    maxIterations: 1,
    tokenBudget: 16_384,
    maxOutputTokens: 512,
    maxAttemptsPerStep: 2,
    contextBudgets: {},
    capabilities: [],
    instructions: CHAT_TITLE_INSTRUCTIONS,
    reasoning: {
      allowed: ['none'],
      default: 'none',
      outputLimits: { none: 512 },
      runBudgets: { none: 16_384 },
    },
  } satisfies RunProfile),
});

export const PRODUCTION_CHAT_PROFILES: readonly RunProfile[] = Object.freeze([
  CHAT_PROFILES.chat,
  CHAT_PROFILES.title,
]);
