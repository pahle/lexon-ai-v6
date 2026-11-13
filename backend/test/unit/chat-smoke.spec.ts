import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { type ModelMessage } from '../../src/infrastructure/ai/index.js';
import {
  CHAT_INSTRUCTIONS,
  CHAT_PROFILES,
} from '../../src/modules/chat/index.js';
import { estimateInputTokens } from '../../src/modules/usage/index.js';
import { runAiSmoke } from '../../src/ai/smoke.js';

const allowlist = JSON.parse(
  readFileSync(
    new URL('../../config/model-allowlist.json', import.meta.url),
    'utf8',
  ),
) as {
  readonly models: readonly {
    readonly id: string;
    readonly provider: string;
    readonly region: string;
  }[];
};
const model = allowlist.models[0]!;
const validEnv = {
  OPENROUTER_API_KEY: 'synthetic-chat-smoke-key',
  LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date().toISOString().slice(0, 10),
};

const chatArgv = [
  '--profile',
  'chat',
  '--efforts',
  'high,max',
  '--samples',
  '2',
] as const;

const singleHighArgv = [
  '--profile',
  'chat',
  '--efforts',
  'high',
  '--samples',
  '1',
] as const;

const expectedSyntheticPrompt =
  'A synthetic office-equipment buyer in Jakarta paid a deposit for a used copier. The seller missed the agreed delivery date and stopped responding. In English, identify the main legal issue and one fact needed before reaching a conclusion. Do not invent statutes, citations, or source names.';

const readyResponse = ({
  cost = '0.00004',
  includeUsage = true,
  status = 200,
  reasoningTokens,
  reasoningBeforeAnswer = [],
  reasoningAfterAnswer = [],
  legacyReasoning,
}: {
  readonly cost?: string;
  readonly includeUsage?: boolean;
  readonly status?: number;
  readonly reasoningTokens?: number;
  readonly reasoningBeforeAnswer?: readonly Record<string, unknown>[];
  readonly reasoningAfterAnswer?: readonly Record<string, unknown>[];
  readonly legacyReasoning?: string;
} = {}) => {
  if (status !== 200)
    return new Response('PRIVATE_PROVIDER_ERROR_CANARY', { status });
  const usage = includeUsage
    ? `,"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"cost":${cost}${reasoningTokens === undefined ? '' : `,"completion_tokens_details":{"reasoning_tokens":${reasoningTokens}}`}}`
    : '';
  const reasoningFrame = (delta: Record<string, unknown>) =>
    `data: ${JSON.stringify({
      id: 'gen-private-id',
      model: model.id,
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`;
  const legacyFrame = legacyReasoning
    ? [reasoningFrame({ reasoning: legacyReasoning })]
    : [];
  return new Response(
    [
      ...reasoningBeforeAnswer.map((detail) =>
        reasoningFrame({ reasoning_details: [detail] }),
      ),
      ...legacyFrame,
      reasoningFrame({ content: 'PRIVATE_MODEL_OUTPUT_SENTINEL' }),
      ...reasoningAfterAnswer.map((detail) =>
        reasoningFrame({ reasoning_details: [detail] }),
      ),
      `data: {"id":"gen-private-id","model":"${model.id}","provider":"Azure","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]${usage}}\n\n`,
      'data: [DONE]\n\n',
    ].join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};

const invalidArguments = [
  {
    label: 'unsupported profile',
    argv: [
      '--profile',
      'profile-canary',
      '--efforts',
      'high,max',
      '--samples',
      '2',
    ],
  },
  {
    label: 'unsupported effort selection',
    argv: [
      '--profile',
      'chat',
      '--efforts',
      'high,effort-canary',
      '--samples',
      '2',
    ],
  },
  {
    label: 'zero samples',
    argv: ['--profile', 'chat', '--efforts', 'high,max', '--samples', '0'],
  },
  {
    label: 'too many samples',
    argv: ['--profile', 'chat', '--efforts', 'high,max', '--samples', '3'],
  },
  {
    label: 'non-integer samples',
    argv: ['--profile', 'chat', '--efforts', 'high,max', '--samples', '1.5'],
  },
  {
    label: 'unknown flag',
    argv: [
      '--profile',
      'chat',
      '--efforts',
      'high,max',
      '--samples',
      '2',
      '--unknown-flag',
      'unknown-flag-canary',
    ],
  },
] as const;

it.each(invalidArguments)(
  'refuses $label before any provider request without echoing arguments',
  async ({ argv }) => {
    const write = vi.fn<(chunk: string) => void>();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => readyResponse());

    const result = await runAiSmoke(
      Object.assign({ env: validEnv, write, fetch }, { argv }),
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toBe(1);
    const output = write.mock.calls.flat().join('');
    expect(output).toBe('AI smoke arguments are invalid.\n');
    expect(output).not.toContain('profile-canary');
    expect(output).not.toContain('effort-canary');
    expect(output).not.toContain('unknown-flag-canary');
    expect(output).not.toContain('synthetic-chat-smoke-key');
  },
);

it('reports bounded high/max chat samples with safe no-signal counts', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const requests: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return readyResponse();
  });

  const result = await runAiSmoke(
    Object.assign({ env: validEnv, write, fetch }, { argv: chatArgv }),
  );

  expect(fetch).toHaveBeenCalledTimes(4);
  const output = write.mock.calls.flat().join('');
  expect(output).toMatch(/^\s*\{/);
  const report = JSON.parse(output) as {
    version: number;
    maximumAllocationUsd: string;
    requestLimit: number;
    declaredRegion: string;
    knownCostUsd: string;
    reservedUsd: string;
    efforts: readonly {
      effort: string;
      requestedSamples: number;
      completedSamples: number;
      caseCounts: Readonly<Record<string, number>>;
      samples: readonly {
        case: string;
        inputTokens: number | 'unavailable';
        outputTokens: number | 'unavailable';
        reasoningOutputTokens: number | 'unavailable';
        finishReason: string | 'unavailable';
        costUsd: string | 'unavailable';
        timingMeasured: boolean;
        provider: string;
        providerOutcome: string;
      }[];
    }[];
  };
  expect(result).toBe(0);
  expect(report.declaredRegion).toBe(model.region);
  expect(report.declaredRegion).toBe('us');
  expect(report).toMatchObject({
    version: 1,
    maximumAllocationUsd: '0.10',
    requestLimit: 4,
    knownCostUsd: '0.00016',
    reservedUsd: '0',
    efforts: [
      {
        effort: 'high',
        requestedSamples: 2,
        completedSamples: 2,
        caseCounts: { 'none/no-signal': 2 },
        samples: [
          {
            case: 'none/no-signal',
            inputTokens: 10,
            outputTokens: 2,
            costUsd: '0.00004',
            timingMeasured: false,
            provider: 'azure',
            providerOutcome: 'succeeded',
          },
          {
            case: 'none/no-signal',
            inputTokens: 10,
            outputTokens: 2,
            costUsd: '0.00004',
            timingMeasured: false,
            provider: 'azure',
            providerOutcome: 'succeeded',
          },
        ],
      },
      {
        effort: 'max',
        requestedSamples: 2,
        completedSamples: 2,
        caseCounts: { 'none/no-signal': 2 },
        samples: [
          {
            case: 'none/no-signal',
            inputTokens: 10,
            outputTokens: 2,
            costUsd: '0.00004',
            timingMeasured: false,
            provider: 'azure',
            providerOutcome: 'succeeded',
          },
          {
            case: 'none/no-signal',
            inputTokens: 10,
            outputTokens: 2,
            costUsd: '0.00004',
            timingMeasured: false,
            provider: 'azure',
            providerOutcome: 'succeeded',
          },
        ],
      },
    ],
  });
  expect(Object.keys(report).sort()).toEqual([
    'declaredRegion',
    'efforts',
    'instructionVersion',
    'knownCostUsd',
    'maximumAllocationUsd',
    'profileVersion',
    'requestLimit',
    'reservedUsd',
    'version',
  ]);
  for (const effort of report.efforts) {
    expect(Object.keys(effort).sort()).toEqual([
      'caseCounts',
      'completedSamples',
      'effort',
      'requestedSamples',
      'samples',
    ]);
    expect(Object.keys(effort.caseCounts).sort()).toEqual([
      'encrypted-only',
      'mixed',
      'none/no-signal',
      'raw-only',
      'summary-only',
      'unclassifiable',
    ]);
    for (const sample of effort.samples) {
      expect(Object.keys(sample).sort()).toEqual([
        'case',
        'costUsd',
        'estimatedInputTokens',
        'finishReason',
        'inputRatio',
        'inputTokens',
        'outputTokens',
        'provider',
        'providerOutcome',
        'reasoningOutputTokens',
        'timingMeasured',
      ]);
      expect(sample.provider).toBe('azure');
      expect(sample.provider).not.toBe(report.declaredRegion);
    }
  }
  expect(
    report.efforts
      .flatMap((item) => item.samples)
      .every(
        (sample) =>
          sample.reasoningOutputTokens === 'unavailable' &&
          sample.finishReason === 'stop',
      ),
  ).toBe(true);

  for (const [index, request] of requests.entries()) {
    const effort = index < 2 ? 'high' : 'max';
    const hardCap = effort === 'high' ? 16384 : 32768;
    const profileLimit = CHAT_PROFILES.chat.reasoning.outputLimits[effort];
    expect(profileLimit).toBe(hardCap);
    expect(await request.clone().json()).toMatchObject({
      model: model.id,
      max_tokens: hardCap,
      reasoning: { effort },
      provider: {
        only: [allowlist.models[0]!.provider],
        order: [allowlist.models[0]!.provider],
        allow_fallbacks: false,
        zdr: true,
        data_collection: 'deny',
        max_price: { prompt: 0.25, completion: 1 },
      },
    });
  }
  expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
  expect(output).not.toContain('gen-private-id');
  expect(output).not.toContain('synthetic-chat-smoke-key');
  expect(output).not.toContain('Reply with the single word READY.');
});

it('uses the public chat instructions, profile cap, and calibration metrics', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const requests: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return readyResponse({ reasoningTokens: 1 });
  });

  const result = await runAiSmoke(
    Object.assign({ env: validEnv, write, fetch }, { argv: singleHighArgv }),
  );

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result).toBe(0);
  const request = (await requests[0]!.clone().json()) as {
    readonly messages?: readonly {
      readonly role: 'system' | 'user';
      readonly content:
        string | readonly { readonly type: 'text'; readonly text: string }[];
    }[];
    readonly max_tokens?: number;
    readonly reasoning?: { readonly effort?: string };
  };
  expect(request.messages?.[0]).toEqual({
    role: 'system',
    content: [{ type: 'text', text: CHAT_INSTRUCTIONS.text }],
  });
  const userMessage = request.messages
    ?.filter((message) => message.role === 'user')
    .at(-1);
  expect(userMessage).toEqual({
    role: 'user',
    content: expectedSyntheticPrompt,
  });
  expect(request.max_tokens).toBe(
    CHAT_PROFILES.chat.reasoning.outputLimits.high,
  );
  expect(request.reasoning?.effort).toBe('high');

  const actualMessages: readonly ModelMessage[] = request.messages!.map(
    ({ role, content }) => ({
      role,
      content:
        typeof content === 'string'
          ? content
          : content.map((part) => part.text).join(''),
    }),
  );
  const estimate = estimateInputTokens({
    model: model.id,
    provider: allowlist.models[0]!.provider,
    messages: actualMessages,
    maxOutputTokens: request.max_tokens!,
    effort: 'high',
    signal: new AbortController().signal,
  });

  const output = write.mock.calls.flat().join('');
  expect(output).toMatch(/^\s*\{/);
  const report = JSON.parse(output) as {
    profileVersion: number;
    instructionVersion: string;
    efforts: readonly {
      samples: readonly {
        estimatedInputTokens: number;
        inputTokens: number | 'unavailable';
        inputRatio: string | 'unavailable';
        reasoningOutputTokens: number | 'unavailable';
        finishReason: string | 'unavailable';
      }[];
    }[];
  };
  expect(report).toMatchObject({
    profileVersion: CHAT_PROFILES.chat.version,
    instructionVersion: CHAT_INSTRUCTIONS.version,
  });
  expect(report.efforts[0]!.samples[0]).toMatchObject({
    estimatedInputTokens: estimate.inputTokens,
    inputTokens: 10,
    inputRatio: String(estimate.inputTokens / 10),
    reasoningOutputTokens: 1,
    finishReason: 'stop',
  });
  expect(output).not.toContain(CHAT_INSTRUCTIONS.text);
  expect(output).not.toContain(expectedSyntheticPrompt);
  expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
  expect(output).not.toContain('gen-private-id');
  expect(output).not.toContain('synthetic-chat-smoke-key');
});

it.each(['0.09', '0.11'])(
  'stops after one request when reported cost %s exceeds its reservation',
  async (cost) => {
    const write = vi.fn<(chunk: string) => void>();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      readyResponse({ cost }),
    );

    const result = await runAiSmoke(
      Object.assign({ env: validEnv, write, fetch }, { argv: chatArgv }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toBe(1);
    const output = write.mock.calls.flat().join('');
    expect(output).toMatch(/^\s*\{/);
    const report = JSON.parse(output) as {
      knownCostUsd: string;
      reservedUsd: string;
      efforts: readonly {
        completedSamples: number;
        samples: readonly { providerOutcome: string }[];
      }[];
    };
    expect(report.knownCostUsd).toBe(cost);
    expect(Number(report.reservedUsd)).toBeGreaterThanOrEqual(0);
    expect(report.efforts[0]!.completedSamples).toBe(1);
    expect(report.efforts[0]!.samples[0]!.providerOutcome).toBe('succeeded');
    expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
    expect(output).not.toContain('gen-private-id');
    expect(output).not.toContain('synthetic-chat-smoke-key');
  },
);

it('keeps the reservation and reports unavailable usage/cost when calibration data is missing', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    readyResponse({ includeUsage: false }),
  );

  const result = await runAiSmoke(
    Object.assign({ env: validEnv, write, fetch }, { argv: chatArgv }),
  );

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result).toBe(1);
  const output = write.mock.calls.flat().join('');
  expect(output).toMatch(/^\s*\{/);
  const report = JSON.parse(output) as {
    knownCostUsd: string;
    reservedUsd: string;
    efforts: readonly {
      completedSamples: number;
      samples: readonly {
        estimatedInputTokens: number;
        inputTokens: number | 'unavailable';
        outputTokens: number | 'unavailable';
        inputRatio: string | 'unavailable';
        reasoningOutputTokens: number | 'unavailable';
        finishReason: string | 'unavailable';
        costUsd: string | 'unavailable';
        providerOutcome: string;
      }[];
    }[];
  };
  expect(report.knownCostUsd).toBe('0');
  expect(Number(report.reservedUsd)).toBeGreaterThan(0);
  expect(report.efforts[0]!.completedSamples).toBeLessThanOrEqual(1);
  expect(report.efforts[0]!.samples[0]).toMatchObject({
    estimatedInputTokens: expect.any(Number),
    inputTokens: 'unavailable',
    outputTokens: 'unavailable',
    inputRatio: 'unavailable',
    reasoningOutputTokens: 'unavailable',
    finishReason: 'stop',
    costUsd: 'unavailable',
    providerOutcome: 'succeeded',
  });
  expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
  expect(output).not.toContain('gen-private-id');
  expect(output).not.toContain('synthetic-chat-smoke-key');
});

it('does not hide-retry a provider HTTP error or print its payload', async () => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    readyResponse({ status: 500 }),
  );

  const result = await runAiSmoke(
    Object.assign({ env: validEnv, write, fetch }, { argv: chatArgv }),
  );

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result).toBe(1);
  const output = write.mock.calls.flat().join('');
  expect(output).not.toContain('PRIVATE_PROVIDER_ERROR_CANARY');
  expect(output).not.toContain('synthetic-chat-smoke-key');
});

it.each([
  { label: 'missing key', env: {} },
  {
    label: 'invalid attestation',
    env: {
      ...validEnv,
      LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: 'private-invalid-attestation',
    },
  },
])('preserves the $label pre-network prerequisite check', async ({ env }) => {
  const write = vi.fn<(chunk: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>();

  const result = await runAiSmoke(
    Object.assign({ env, write, fetch }, { argv: chatArgv }),
  );

  expect(fetch).not.toHaveBeenCalled();
  expect(result).toBe(1);
  const output = write.mock.calls.flat().join('');
  expect(output).toMatch(/ZDR-only/i);
  expect(output).not.toContain('private-invalid-attestation');
});

const reasoningCaseLabels = [
  'summary-only',
  'raw-only',
  'encrypted-only',
  'none/no-signal',
  'mixed',
  'unclassifiable',
] as const;

const reasoningCaseFixtures: {
  readonly label: string;
  readonly expectedCase: (typeof reasoningCaseLabels)[number];
  readonly timingMeasured: boolean;
  readonly options: NonNullable<Parameters<typeof readyResponse>[0]>;
  readonly forbidden: readonly string[];
}[] = [
  {
    label: 'summary-only',
    expectedCase: 'summary-only',
    timingMeasured: true,
    options: {
      reasoningBeforeAnswer: [
        { type: 'reasoning.summary', summary: 'SUMMARY_BODY_CANARY' },
      ],
    },
    forbidden: ['SUMMARY_BODY_CANARY'],
  },
  {
    label: 'raw-only',
    expectedCase: 'raw-only',
    timingMeasured: true,
    options: {
      reasoningBeforeAnswer: [
        { type: 'reasoning.text', text: 'RAW_REASONING_CANARY' },
      ],
    },
    forbidden: ['RAW_REASONING_CANARY'],
  },
  {
    label: 'encrypted-only',
    expectedCase: 'encrypted-only',
    timingMeasured: true,
    options: {
      reasoningBeforeAnswer: [
        { type: 'reasoning.encrypted', data: 'ENCRYPTED_REASONING_CANARY' },
      ],
    },
    forbidden: ['ENCRYPTED_REASONING_CANARY'],
  },
  {
    label: 'no reasoning signal',
    expectedCase: 'none/no-signal',
    timingMeasured: false,
    options: {},
    forbidden: [],
  },
  {
    label: 'mixed summary and raw',
    expectedCase: 'mixed',
    timingMeasured: true,
    options: {
      reasoningBeforeAnswer: [
        { type: 'reasoning.summary', summary: 'MIXED_SUMMARY_CANARY' },
        { type: 'reasoning.text', text: 'MIXED_RAW_CANARY' },
      ],
    },
    forbidden: ['MIXED_SUMMARY_CANARY', 'MIXED_RAW_CANARY'],
  },
  {
    label: 'unknown typed reasoning',
    expectedCase: 'unclassifiable',
    timingMeasured: true,
    options: {
      reasoningBeforeAnswer: [
        { type: 'reasoning.mystery-canary', text: 'UNKNOWN_TYPE_BODY_CANARY' },
      ],
    },
    forbidden: ['reasoning.mystery-canary', 'UNKNOWN_TYPE_BODY_CANARY'],
  },
  {
    label: 'redacted typed reasoning',
    expectedCase: 'unclassifiable',
    timingMeasured: true,
    options: {
      reasoningBeforeAnswer: [
        { type: 'reasoning.redacted', data: 'REDACTED_REASONING_CANARY' },
      ],
    },
    forbidden: ['REDACTED_REASONING_CANARY'],
  },
  {
    label: 'ambiguous legacy reasoning delta',
    expectedCase: 'unclassifiable',
    timingMeasured: false,
    options: { legacyReasoning: 'AMBIGUOUS_LEGACY_REASONING_CANARY' },
    forbidden: ['AMBIGUOUS_LEGACY_REASONING_CANARY'],
  },
  {
    label: 'typed summary after first answer',
    expectedCase: 'summary-only',
    timingMeasured: false,
    options: {
      reasoningAfterAnswer: [
        { type: 'reasoning.summary', summary: 'LATE_SUMMARY_BODY_CANARY' },
      ],
    },
    forbidden: ['LATE_SUMMARY_BODY_CANARY'],
  },
];

it.each(reasoningCaseFixtures)(
  'reports closed raw reasoning classification for $label',
  async ({ expectedCase, timingMeasured, options, forbidden }) => {
    const write = vi.fn<(chunk: string) => void>();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      readyResponse(options),
    );

    const result = await runAiSmoke(
      Object.assign({ env: validEnv, write, fetch }, { argv: singleHighArgv }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toBe(0);
    const output = write.mock.calls.flat().join('');
    expect(output).toMatch(/^\s*\{/);
    const report = JSON.parse(output) as {
      efforts: readonly {
        caseCounts: Readonly<Record<string, number>>;
        samples: readonly {
          case: string;
          timingMeasured: boolean;
          providerOutcome: string;
          durationMs?: number;
        }[];
      }[];
    };
    const expectedCounts = Object.fromEntries(
      reasoningCaseLabels.map((label) => [
        label,
        label === expectedCase ? 1 : 0,
      ]),
    );
    expect(report.efforts[0]!.caseCounts).toEqual(expectedCounts);
    expect(report.efforts[0]!.samples).toEqual([
      expect.objectContaining({
        case: expectedCase,
        timingMeasured,
        providerOutcome: 'succeeded',
      }),
    ]);
    expect(report.efforts[0]!.samples[0]).not.toHaveProperty('durationMs');
    expect(output).not.toContain('PRIVATE_MODEL_OUTPUT_SENTINEL');
    expect(output).not.toContain('gen-private-id');
    expect(output).not.toContain('synthetic-chat-smoke-key');
    expect(output).not.toContain('Jakarta');
    for (const canary of forbidden) expect(output).not.toContain(canary);
  },
);
