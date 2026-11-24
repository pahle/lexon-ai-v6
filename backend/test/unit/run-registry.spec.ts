import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_ENGINE_REGISTRATIONS,
  RunRegistry,
  type EngineRegistrations,
} from '../../src/modules/chat/index.js';
import {
  AskUserToolInputSchema,
  DeadlineCalculatorToolInputSchema,
  RenameChatToolInputSchema,
} from '@lexon/contracts';
import { z } from 'zod';

const profile = {
  id: 'test-profile',
  version: 1,
  allowedModels: ['provider/model'],
  defaultModel: 'provider/model',
  queue: 'ai-interactive',
  priority: 5,
  maxIterations: 4,
  tokenBudget: 1000,
  maxOutputTokens: 128,
  contextBudgets: {},
  capabilities: [],
} as const;

const readTool = {
  id: 'read-tool',
  version: 1,
  kind: 'read',
  inputSchema: z.strictObject({ query: z.string() }),
  pauseKind: null,
  timeoutMs: 5000,
  maxResultBytes: 16384,
  capabilities: [],
  execute: async () => ({ ok: true }),
} as const;

const transactionalWriteTool = {
  ...readTool,
  id: 'write-tool',
  kind: 'write',
  pauseKind: 'approval',
  idempotency: { mode: 'transactional' },
};

const registrations = (
  overrides: Partial<EngineRegistrations> = {},
): EngineRegistrations => ({
  profiles: [profile],
  contexts: [],
  tools: [],
  ...overrides,
});

describe('run registry', () => {
  it('resolves only an explicitly registered profile', () => {
    const registry = new RunRegistry();
    registry.register(registrations());
    expect(registry.profile('test-profile')).toBe(profile);
    expect(registry.profile('unknown-profile')).toBeUndefined();
  });

  it('write registration requires idempotency mode', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(
        registrations({
          tools: [
            { ...transactionalWriteTool, idempotency: undefined } as never,
          ],
        }),
      ),
    ).toThrow();
  });

  it('duplicate profile/tool ids rejected', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(registrations({ profiles: [profile, profile] })),
    ).toThrow();
    expect(() =>
      registry.register(registrations({ tools: [readTool, readTool] })),
    ).toThrow();
  });

  it('read tool needs no mode', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(registrations({ tools: [readTool] })),
    ).not.toThrow();
  });

  it('rejects a tool schema that cannot be advertised at registration', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(
        registrations({
          tools: [
            {
              ...readTool,
              inputSchema: z.custom<string>(),
            },
          ],
        }),
      ),
    ).toThrow(/input schema/i);
  });

  it('context registration requires a callable collector', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(
        registrations({
          contexts: [
            { id: 'context', version: 1, collect: undefined } as never,
          ],
        }),
      ),
    ).toThrow();
  });

  it('defaults attempts to two and accepts a profile-configured limit', () => {
    const defaultRegistry = new RunRegistry();
    expect(() => defaultRegistry.register(registrations())).not.toThrow();

    const configuredRegistry = new RunRegistry();
    expect(() =>
      configuredRegistry.register(
        registrations({
          profiles: [{ ...profile, maxAttemptsPerStep: 3 }],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects invalid configured attempt limits', () => {
    for (const maxAttemptsPerStep of [0, 1.5]) {
      const registry = new RunRegistry();
      expect(() =>
        registry.register(
          registrations({
            profiles: [{ ...profile, maxAttemptsPerStep }],
          }),
        ),
      ).toThrow();
    }
  });

  it('accepts the default and hard maximum tool proposal limits', () => {
    for (const maxToolProposalsPerGeneration of [undefined, 15]) {
      const registry = new RunRegistry();
      expect(() =>
        registry.register(
          registrations({
            profiles: [
              {
                ...profile,
                ...(maxToolProposalsPerGeneration === undefined
                  ? {}
                  : { maxToolProposalsPerGeneration }),
              },
            ],
          }),
        ),
      ).not.toThrow();
    }
  });

  it('rejects tool proposal limits outside the supported integer range', () => {
    for (const maxToolProposalsPerGeneration of [0, 1.5, 16]) {
      const registry = new RunRegistry();
      expect(() =>
        registry.register(
          registrations({
            profiles: [{ ...profile, maxToolProposalsPerGeneration }],
          }),
        ),
      ).toThrow();
    }
  });

  it('external mode requires its declared callback', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(
        registrations({
          tools: [
            {
              ...transactionalWriteTool,
              idempotency: { mode: 'idempotency-key' },
            } as never,
          ],
        }),
      ),
    ).toThrow();
  });

  it('F3 rejects correctly shaped external write adapters at registration', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(
        registrations({
          tools: [
            {
              ...transactionalWriteTool,
              idempotency: { mode: 'idempotency-key' },
              executeExternal: async () => ({ ok: true }),
            } as never,
          ],
        }),
      ),
    ).toThrow(/unsupported.*F3|F3.*unsupported/i);
  });

  it('registers the production chat profiles with the F5 tool surface', () => {
    // Assertion change (F5 task 4): production registrations gain the three
    // tools (was tools: []), and the chat profile gains the three tool
    // capabilities plus maxIterations 1 -> 6 (spec §10). Per the owner
    // ruling (§21 deviation 3) chat-title is a background run with nobody to
    // answer or approve, so it keeps capabilities: [] and maxIterations: 1.
    const byId = new Map(
      PRODUCTION_ENGINE_REGISTRATIONS.profiles.map((registered) => [
        registered.id,
        registered,
      ]),
    );
    expect(byId.get('chat')).toMatchObject({
      capabilities: ['chat.ask', 'chat.deadline', 'chat.rename'],
      maxIterations: 6,
    });
    expect(byId.get('chat-title')).toMatchObject({
      capabilities: [],
      maxIterations: 1,
    });
    expect(PRODUCTION_ENGINE_REGISTRATIONS.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'chat', priority: 1 }),
        expect.objectContaining({ id: 'chat-title', priority: 5 }),
      ]),
    );
    expect(PRODUCTION_ENGINE_REGISTRATIONS.profiles).toHaveLength(2);
    expect(PRODUCTION_ENGINE_REGISTRATIONS.tools).toHaveLength(3);
  });
});

describe('F5 tool registrations', () => {
  const registered = (id: string) =>
    PRODUCTION_ENGINE_REGISTRATIONS.tools.find((tool) => tool.id === id);

  it('registers ask_user as a question pause tool without an execute', () => {
    const tool = registered('ask_user');
    expect(tool).toMatchObject({
      version: 1,
      kind: 'pause',
      interaction: 'question',
      pauseKind: 'question',
      idempotency: { mode: 'transactional' },
      capabilities: ['chat.ask'],
      maxPerRun: 2,
    });
    expect(tool && 'execute' in tool).toBe(false);
  });

  it('registers deadline_calculator as a read tool with an inline execute', () => {
    const tool = registered('deadline_calculator');
    expect(tool).toMatchObject({
      version: 1,
      kind: 'read',
      pauseKind: null,
      capabilities: ['chat.deadline'],
    });
    expect(typeof (tool as { execute?: unknown } | undefined)?.execute).toBe(
      'function',
    );
  });

  it('registers rename_chat as an approval-gated transactional write tool', () => {
    const tool = registered('rename_chat');
    expect(tool).toMatchObject({
      version: 1,
      kind: 'write',
      pauseKind: 'approval',
      idempotency: { mode: 'transactional' },
      capabilities: ['chat.rename'],
    });
    expect(typeof (tool as { execute?: unknown } | undefined)?.execute).toBe(
      'function',
    );
  });

  it('passes registry validation for the production registrations', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(PRODUCTION_ENGINE_REGISTRATIONS),
    ).not.toThrow();
  });

  it('rejects a pause tool that breaks its contract', () => {
    const askUser = registered('ask_user');
    for (const candidate of [
      { ...askUser, pauseKind: 'approval' },
      { ...askUser, interaction: 'approval' },
      { ...askUser, execute: async () => ({ ok: true }) },
      { ...askUser, idempotency: { mode: 'reconcile' } },
      { ...askUser, maxPerRun: 0 },
    ]) {
      const registry = new RunRegistry();
      expect(() =>
        registry.register(registrations({ tools: [candidate as never] })),
      ).toThrow();
    }
  });
});

describe('chat tool input schemas', () => {
  const question = (overrides: Record<string, unknown> = {}) => ({
    questionId: 'q1',
    text: 'Which contract type does the counterparty need?',
    kind: 'single',
    options: [
      { label: 'Non-disclosure agreement' },
      { label: 'Service agreement', description: 'Ongoing services' },
    ],
    ...overrides,
  });

  describe('ask_user', () => {
    it('accepts 1-5 questions of every kind', () => {
      for (const questions of [
        [question()],
        [question(), question({ questionId: 'q2', kind: 'multiple' })],
        [
          question(),
          question({ questionId: 'q2', kind: 'multiple' }),
          question({
            questionId: 'q3',
            kind: 'text',
            options: undefined,
            allowFreeText: undefined,
          }),
          question({ questionId: 'q4', kind: 'multiple' }),
          question({ questionId: 'q5' }),
        ],
      ]) {
        const parsed = AskUserToolInputSchema.parse({ questions });
        expect(parsed.questions).toHaveLength(questions.length);
      }
    });

    it('defaults allowFreeText to true on option questions', () => {
      const parsed = AskUserToolInputSchema.parse({ questions: [question()] });
      expect(parsed.questions[0]).toMatchObject({ allowFreeText: true });
      const explicit = AskUserToolInputSchema.parse({
        questions: [question({ allowFreeText: false })],
      });
      expect(explicit.questions[0]).toMatchObject({ allowFreeText: false });
    });

    it('rejects empty and oversized question sets', () => {
      expect(AskUserToolInputSchema.safeParse({ questions: [] }).success).toBe(
        false,
      );
      const six = Array.from({ length: 6 }, (_, index) =>
        question({ questionId: `q${index + 1}` }),
      );
      expect(AskUserToolInputSchema.safeParse({ questions: six }).success).toBe(
        false,
      );
    });

    it('rejects option questions without options or with out-of-range options', () => {
      for (const kind of ['single', 'multiple']) {
        expect(
          AskUserToolInputSchema.safeParse({
            questions: [question({ kind, options: undefined })],
          }).success,
        ).toBe(false);
        expect(
          AskUserToolInputSchema.safeParse({
            questions: [question({ kind, options: [{ label: 'only' }] })],
          }).success,
        ).toBe(false);
        expect(
          AskUserToolInputSchema.safeParse({
            questions: [
              question({
                kind,
                options: Array.from({ length: 6 }, (_, index) => ({
                  label: `option ${index + 1}`,
                })),
              }),
            ],
          }).success,
        ).toBe(false);
      }
    });

    it('rejects a text question carrying options or allowFreeText', () => {
      for (const candidate of [
        question({
          kind: 'text',
          options: [{ label: 'a' }, { label: 'b' }],
        }),
        question({ kind: 'text', options: undefined, allowFreeText: true }),
      ]) {
        expect(
          AskUserToolInputSchema.safeParse({ questions: [candidate] }).success,
        ).toBe(false);
      }
      expect(
        AskUserToolInputSchema.safeParse({
          questions: [question({ kind: 'text', options: undefined })],
        }).success,
      ).toBe(true);
    });

    it('rejects out-of-range text, labels, descriptions and question ids', () => {
      for (const candidate of [
        question({ text: 'x'.repeat(301) }),
        question({ questionId: '' }),
        question({ options: [{ label: 'x'.repeat(81) }, { label: 'b' }] }),
        question({
          options: [
            { label: 'a', description: 'x'.repeat(141) },
            { label: 'b' },
          ],
        }),
      ]) {
        expect(
          AskUserToolInputSchema.safeParse({ questions: [candidate] }).success,
        ).toBe(false);
      }
    });

    it('describes the fields the model fills in', () => {
      expect(AskUserToolInputSchema.shape.questions.description).toBeTruthy();
      const union = AskUserToolInputSchema.shape.questions.element;
      const variants = (
        union as unknown as {
          options: Array<{ shape: Record<string, { description?: string }> }>;
        }
      ).options;
      for (const variant of variants) {
        expect(variant.shape.questionId?.description).toBeTruthy();
        expect(variant.shape.text?.description).toBeTruthy();
      }
      const single = variants.find((variant) => 'options' in variant.shape)!;
      expect(single.shape.options?.description).toBeTruthy();
    });
  });

  describe('deadline_calculator', () => {
    const valid = {
      startDate: '2026-12-01',
      amount: 14,
      unit: 'calendar_days',
      countStartDay: false,
      nonWorkingDayRule: 'none',
    };

    it('accepts a well-formed input', () => {
      expect(DeadlineCalculatorToolInputSchema.parse(valid)).toMatchObject(
        valid,
      );
    });

    it('rejects out-of-range amounts, units, rules and dates', () => {
      for (const candidate of [
        { ...valid, amount: 0 },
        { ...valid, amount: 3651 },
        { ...valid, amount: 1.5 },
        { ...valid, unit: 'hours' },
        { ...valid, nonWorkingDayRule: 'previous_working_day' },
        { ...valid, startDate: '01/12/2026' },
        { ...valid, countStartDay: 'yes' },
      ]) {
        expect(
          DeadlineCalculatorToolInputSchema.safeParse(candidate).success,
        ).toBe(false);
      }
    });

    it('documents that countStartDay is ignored for months and years', () => {
      const description =
        DeadlineCalculatorToolInputSchema.shape.countStartDay.description;
      expect(description).toBeTruthy();
      expect(description).toMatch(/ignored/i);
      expect(description).toMatch(/months/i);
      expect(description).toMatch(/years/i);
    });
  });

  describe('rename_chat', () => {
    it('accepts a trimmed newTitle within 120 characters', () => {
      expect(
        RenameChatToolInputSchema.parse({ newTitle: '  Merger review  ' }),
      ).toEqual({ newTitle: 'Merger review' });
      expect(
        RenameChatToolInputSchema.parse({ newTitle: 'x'.repeat(120) }),
      ).toEqual({ newTitle: 'x'.repeat(120) });
    });

    it('rejects empty, oversized and extra-field inputs', () => {
      for (const candidate of [
        { newTitle: '   ' },
        { newTitle: 'x'.repeat(121) },
        { newTitle: 'Title', currentTitle: 'fabricated current title' },
        { newTitle: 42 },
      ]) {
        expect(RenameChatToolInputSchema.safeParse(candidate).success).toBe(
          false,
        );
      }
    });
  });
});
