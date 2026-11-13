import {
  createRealModelGateway,
  ModelAllowlistSchema,
  type ModelEvent,
  type ModelInput,
  type ModelOutcome,
  type ProviderReasoningKind,
} from '../infrastructure/ai/index.js';
import {
  assembleModelInput,
  CHAT_INSTRUCTIONS,
  CHAT_PROFILES,
} from '../modules/chat/index.js';
import {
  estimateInputTokens,
  InvocationBudget,
  reservationUsd,
} from '../modules/usage/index.js';

const MAX_ALLOCATION_USD = '0.10';
const REQUEST_LIMIT = 4;
const PROMPT_PRICE_PER_MILLION = '0.25';
const OUTPUT_PRICE_PER_MILLION = '1.00';
const CHAT_PROMPT =
  'A synthetic office-equipment buyer in Jakarta paid a deposit for a used copier. The seller missed the agreed delivery date and stopped responding. In English, identify the main legal issue and one fact needed before reaching a conclusion. Do not invent statutes, citations, or source names.';

type Effort = 'high' | 'max';
type CaseClassification =
  | 'summary-only'
  | 'raw-only'
  | 'encrypted-only'
  | 'mixed'
  | 'none/no-signal'
  | 'unclassifiable';
type SafeOutcome = 'succeeded' | 'failed' | 'unknown';
interface SafeModelOutcome {
  readonly attemptOutcome: SafeOutcome;
  readonly finishReason: ModelOutcome['finishReason'];
  readonly provider?: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly reasoningOutputTokens?: number;
  };
  readonly costUsd?: string;
}
type AllowlistedRoute = ReturnType<
  typeof ModelAllowlistSchema.parse
>['models'][number];

interface ChatSmokeSample {
  readonly case: CaseClassification;
  readonly estimatedInputTokens: number;
  readonly inputTokens: number | 'unavailable';
  readonly inputRatio: string | 'unavailable';
  readonly outputTokens: number | 'unavailable';
  readonly reasoningOutputTokens: number | 'unavailable';
  readonly costUsd: string | 'unavailable';
  readonly finishReason: ModelOutcome['finishReason'] | 'unavailable';
  readonly timingMeasured: boolean;
  readonly provider: string;
  readonly providerOutcome: SafeOutcome;
}

interface ChatSmokeEffortReport {
  readonly effort: Effort;
  readonly requestedSamples: number;
  completedSamples: number;
  readonly caseCounts: Record<CaseClassification, number>;
  readonly samples: ChatSmokeSample[];
}

interface ChatSmokeReport {
  readonly version: 1;
  readonly profileVersion: number;
  readonly instructionVersion: string;
  readonly maximumAllocationUsd: typeof MAX_ALLOCATION_USD;
  readonly requestLimit: typeof REQUEST_LIMIT;
  readonly declaredRegion: string;
  readonly knownCostUsd: string;
  readonly reservedUsd: string;
  readonly efforts: readonly ChatSmokeEffortReport[];
}

export interface RunChatSmokeOptions {
  readonly route: AllowlistedRoute;
  readonly key: string;
  readonly attestation: string;
  readonly efforts: readonly Effort[];
  readonly samples: number;
  readonly write: (chunk: string) => void;
  readonly fetch?: typeof fetch;
}

export async function runChatSmoke({
  route,
  key,
  attestation,
  efforts,
  samples,
  write,
  fetch,
}: RunChatSmokeOptions): Promise<number> {
  const budget = new InvocationBudget({
    budgetUsd: MAX_ALLOCATION_USD,
    maxRequests: REQUEST_LIMIT,
  });
  const effortReports: ChatSmokeEffortReport[] = efforts.map((effort) => ({
    effort,
    requestedSamples: samples,
    completedSamples: 0,
    caseCounts: {
      'summary-only': 0,
      'raw-only': 0,
      'encrypted-only': 0,
      mixed: 0,
      'none/no-signal': 0,
      unclassifiable: 0,
    },
    samples: [],
  }));
  let activeReasoningKinds: Set<ProviderReasoningKind> | undefined;
  const gateway = createRealModelGateway({
    allowlist: { version: 1, models: [route] },
    key,
    attestation,
    priceCeiling: { prompt: 0.25, completion: 1 },
    onReasoningKind: (kind) => activeReasoningKinds?.add(kind),
    ...(fetch ? { fetch } : {}),
  });
  let failed = false;

  for (const effortReport of effortReports) {
    for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
      if (budget.stopped) break;

      const input: ModelInput = {
        ...assembleModelInput(
          CHAT_PROFILES.chat,
          [],
          CHAT_PROMPT,
          effortReport.effort,
          AbortSignal.timeout(30_000),
        ),
        model: route.id,
        provider: route.provider,
      };
      const outputLimit = input.maxOutputTokens;
      const estimatedInputTokens = estimateInputTokens(input).inputTokens;
      const reservationAmount = reservationUsd(
        estimatedInputTokens,
        outputLimit,
        PROMPT_PRICE_PER_MILLION,
        OUTPUT_PRICE_PER_MILLION,
      );
      let reservation: Awaited<ReturnType<InvocationBudget['reserve']>>;
      try {
        reservation = await budget.reserve(reservationAmount);
      } catch {
        failed = true;
        break;
      }

      const reasoningKinds = new Set<ProviderReasoningKind>();
      activeReasoningKinds = reasoningKinds;
      let observation: Awaited<ReturnType<typeof observeSample>>;
      try {
        observation = await observeSample(gateway.generate(input));
      } finally {
        activeReasoningKinds = undefined;
      }
      const outcome = observation.outcome;
      const inputTokens = safePositiveInteger(outcome?.usage?.inputTokens);
      const outputTokens = safeNonnegativeInteger(outcome?.usage?.outputTokens);
      const reasoningOutputTokens = safeNonnegativeInteger(
        outcome?.usage?.reasoningOutputTokens,
      );
      const costUsd = safeCost(outcome?.costUsd);
      const providerOutcome = outcome?.attemptOutcome ?? 'unknown';
      const classification = classifyReasoningKinds(
        reasoningKinds,
        outcome?.attemptOutcome,
      );

      if (outcome?.attemptOutcome === 'succeeded')
        effortReport.completedSamples += 1;
      effortReport.caseCounts[classification] += 1;
      effortReport.samples.push({
        case: classification,
        estimatedInputTokens,
        inputTokens: inputTokens ?? 'unavailable',
        inputRatio:
          inputTokens === undefined
            ? 'unavailable'
            : String(estimatedInputTokens / inputTokens),
        outputTokens: outputTokens ?? 'unavailable',
        reasoningOutputTokens: reasoningOutputTokens ?? 'unavailable',
        costUsd: costUsd ?? 'unavailable',
        finishReason: outcome?.finishReason ?? 'unavailable',
        timingMeasured: observation.timingMeasured,
        provider: normalizeObservedProvider(
          observation.provider ?? outcome?.provider,
          route.provider,
        ),
        providerOutcome,
      });

      if (providerOutcome === 'unknown') {
        if (costUsd) budget.settle(reservation, costUsd, true);
        else budget.settleUnknown(reservation);
        budget.stop();
        failed = true;
        break;
      }
      if (!costUsd) {
        // Keep the reservation against an attempt whose billed amount is unavailable.
        budget.stop();
        failed = true;
        break;
      }

      const overrun = budget.settle(reservation, costUsd, false);
      if (
        overrun ||
        providerOutcome !== 'succeeded' ||
        inputTokens === undefined ||
        outputTokens === undefined ||
        outputTokens > outputLimit
      ) {
        budget.stop();
        failed = true;
        break;
      }
    }
    if (budget.stopped) break;
  }

  const report: ChatSmokeReport = {
    version: 1,
    profileVersion: CHAT_PROFILES.chat.version,
    instructionVersion: CHAT_INSTRUCTIONS.version,
    maximumAllocationUsd: MAX_ALLOCATION_USD,
    requestLimit: REQUEST_LIMIT,
    declaredRegion: route.region,
    knownCostUsd: budget.knownCostUsd,
    reservedUsd: budget.reservedUsd,
    efforts: effortReports,
  };
  write(`${JSON.stringify(report)}\n`);
  return failed ? 1 : 0;
}

async function observeSample(events: AsyncIterable<ModelEvent>): Promise<{
  readonly outcome: SafeModelOutcome | undefined;
  readonly provider: string | undefined;
  readonly timingMeasured: boolean;
}> {
  let outcome: SafeModelOutcome | undefined;
  let provider: string | undefined;
  let timingMeasured = false;
  try {
    for await (const event of events) {
      if (event.type === 'metadata') provider = event.provider;
      if (event.type === 'reasoning-end' && event.durationMs !== null)
        timingMeasured = true;
      if (event.type === 'outcome')
        outcome = {
          attemptOutcome: event.outcome.attemptOutcome,
          finishReason: event.outcome.finishReason,
          ...(event.outcome.provider
            ? { provider: event.outcome.provider }
            : {}),
          ...(event.outcome.usage
            ? {
                usage: {
                  ...(event.outcome.usage.inputTokens !== undefined
                    ? { inputTokens: event.outcome.usage.inputTokens }
                    : {}),
                  ...(event.outcome.usage.outputTokens !== undefined
                    ? { outputTokens: event.outcome.usage.outputTokens }
                    : {}),
                  ...(event.outcome.usage.reasoningOutputTokens !== undefined
                    ? {
                        reasoningOutputTokens:
                          event.outcome.usage.reasoningOutputTokens,
                      }
                    : {}),
                },
              }
            : {}),
          ...(event.outcome.costUsd !== undefined
            ? { costUsd: event.outcome.costUsd }
            : {}),
        };
      // Text and reasoning summary bodies are intentionally not retained.
    }
  } catch {
    // A thrown stream leaves the request outcome unknown; do not retain its error.
  }
  return { outcome, provider, timingMeasured };
}

function classifyReasoningKinds(
  kinds: ReadonlySet<ProviderReasoningKind>,
  outcome: SafeOutcome | undefined,
): CaseClassification {
  if (outcome !== 'succeeded' || kinds.has('unclassifiable'))
    return 'unclassifiable';
  const known = (['summary', 'raw', 'encrypted'] as const).filter((kind) =>
    kinds.has(kind),
  );
  if (!known.length) return 'none/no-signal';
  if (known.length > 1) return 'mixed';
  switch (known[0]) {
    case 'summary':
      return 'summary-only';
    case 'raw':
      return 'raw-only';
    case 'encrypted':
      return 'encrypted-only';
    default:
      return 'unclassifiable';
  }
}

function safePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function safeNonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeCost(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^(0|[1-9]\d*)(?:\.\d{1,512})?$/.test(value)
    ? value
    : undefined;
}

function normalizeObservedProvider(
  observed: string | undefined,
  declaredRoute: string,
): string {
  if (!observed) return 'unavailable';
  const routeProvider = declaredRoute.split('/')[0]!.toLowerCase();
  const normalized = observed.toLowerCase();
  return normalized === routeProvider ||
    normalized === declaredRoute.toLowerCase()
    ? routeProvider
    : 'unrecognized';
}
