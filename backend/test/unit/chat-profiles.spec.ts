import { describe, expect, it } from 'vitest';
import {
  CHAT_HISTORY_CONTEXT_ID,
  CHAT_PROFILES,
} from '../../src/modules/chat/chat-profiles.js';
import { assembleModelInput } from '../../src/modules/chat/model-input.js';
import { fitModelContext } from '../../src/modules/chat/model-input.js';
import { estimateInputTokens } from '../../src/modules/usage/token-estimator.js';

describe('production chat profiles', () => {
  it('sets resolved effort limits and queues for chat and title runs', () => {
    expect(CHAT_PROFILES.chat.reasoning).toMatchObject({
      allowed: ['high', 'max'],
      default: 'high',
      outputLimits: { high: 16_384, max: 32_768 },
      runBudgets: { high: 360_448, max: 393_216 },
    });
    expect(CHAT_PROFILES.chat.maxEstimatedInputTokens).toBe(163_840);
    expect(CHAT_PROFILES.chat.contextBudgets).toEqual({
      [CHAT_HISTORY_CONTEXT_ID]: 131_072,
    });
    expect(CHAT_PROFILES.chat.queue).toBe('ai-interactive');
    expect(CHAT_PROFILES.chat.priority).toBe(1);
    expect(CHAT_PROFILES.chat.maxIterations).toBe(1);
    expect(CHAT_PROFILES.title).toMatchObject({
      queue: 'ai-batch',
      priority: 5,
      maxOutputTokens: 512,
      maxIterations: 1,
      reasoning: {
        allowed: ['none'],
        default: 'none',
        outputLimits: { none: 512 },
        runBudgets: { none: 16_384 },
      },
    });
  });

  it('assembles the selected effort and versioned trusted instructions', () => {
    const input = assembleModelInput(
      CHAT_PROFILES.chat,
      [{ role: 'assistant', content: 'Earlier answer.' }],
      'Current question',
      'max',
    );
    expect(input.effort).toBe('max');
    expect(input.maxOutputTokens).toBe(32_768);
    expect(input.messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('Never invent sources'),
    });
    expect(input.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Current question',
    });
  });

  it('fits serialized input using the reservation estimator and never trims the prompt', () => {
    const fitted = fitModelContext(
      CHAT_PROFILES.chat,
      [
        { role: 'assistant', content: 'Older history '.repeat(20_000) },
        { role: 'assistant', content: 'Newer history.' },
      ],
      'Current prompt',
      'high',
    );
    expect(fitted.context).toEqual([
      { role: 'assistant', content: 'Newer history.' },
    ]);
    expect(estimateInputTokens(fitted.input).inputTokens).toBeLessThanOrEqual(
      163_840,
    );
    expect(fitted.input.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Current prompt',
    });
    expect(() =>
      fitModelContext(CHAT_PROFILES.chat, [], 'x'.repeat(170_000), 'high'),
    ).toThrow(/maximum/i);
  });

  it('rejects disallowed effort before creating a model input', () => {
    expect(() =>
      assembleModelInput(CHAT_PROFILES.chat, [], 'Question', 'low'),
    ).toThrow(/not allowed/i);
  });
});
