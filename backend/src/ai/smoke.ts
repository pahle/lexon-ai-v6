import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runChatSmoke } from './chat-smoke.js';
import {
  createRealModelGateway,
  ModelAllowlistSchema,
  validateRealModelPrerequisites,
} from '../infrastructure/ai/index.js';
import type {
  ModelEvent,
  ModelInput,
  ModelOutcome,
} from '../infrastructure/ai/index.js';
import { estimateInputTokens } from '../modules/usage/token-estimator.js';

const SMOKE_PROMPT = 'Reply with the single word READY.';
const MAX_OUTPUT_TOKENS = 128;
const TIMEOUT_MS = 30_000;
const PREREQUISITES_MESSAGE =
  'AI smoke requires a valid dated ZDR-only attestation and OpenRouter key. Confirm ZDR-only routing with no Safety Retention, prompt/response logging off, and an operator-set key credit limit before attesting.';

export interface RunAiSmokeOptions {
  readonly env: Record<string, string | undefined>;
  readonly write: (chunk: string) => void;
  readonly fetch?: typeof globalThis.fetch;
  readonly argv?: readonly string[];
}

export async function runAiSmoke({
  env,
  write,
  fetch,
  argv = [],
}: RunAiSmokeOptions): Promise<number> {
  const chatArguments = argv.length ? parseSmokeArguments(argv) : undefined;
  if (argv.length && !chatArguments) {
    write('AI smoke arguments are invalid.\n');
    return 1;
  }

  let route: ReturnType<typeof ModelAllowlistSchema.parse>['models'][number];
  try {
    if (!env.OPENROUTER_API_KEY) {
      write(`${PREREQUISITES_MESSAGE}\n`);
      return 1;
    }
    const allowlist = ModelAllowlistSchema.parse(
      JSON.parse(readAllowlistFile()),
    );
    route = allowlist.models[0]!;
    if (!route) {
      write('AI smoke has no reviewed model route configured.\n');
      return 1;
    }
    // Validate before constructing the gateway or allowing any request to start.
    const attestation = env.LEXON_OPENROUTER_ZDR_ONLY_VERIFIED;
    if (!attestation) {
      write(`${PREREQUISITES_MESSAGE}\n`);
      return 1;
    }
    validateRealModelPrerequisites(env);
    if (chatArguments) {
      return await runChatSmoke({
        route,
        key: env.OPENROUTER_API_KEY,
        attestation,
        efforts: chatArguments.efforts,
        samples: chatArguments.samples,
        write,
        ...(fetch ? { fetch } : {}),
      });
    }
    const gateway = createRealModelGateway({
      allowlist,
      key: env.OPENROUTER_API_KEY,
      attestation,
      ...(fetch ? { fetch } : {}),
    });
    const input: ModelInput = {
      model: route.id,
      provider: route.provider,
      messages: [{ role: 'user', content: SMOKE_PROMPT }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };
    const estimate = estimateInputTokens(input).inputTokens;
    const outcome = await readOutcome(gateway.generate(input));
    const reportedInput = safePositiveInteger(outcome?.usage?.inputTokens);
    const reportedOutput = safeNonnegativeInteger(outcome?.usage?.outputTokens);
    const ratio =
      reportedInput === undefined
        ? 'unavailable'
        : String(estimate / reportedInput);
    const cost = safeCost(outcome?.costUsd);
    const observedProvider = normalizeObservedProvider(
      outcome?.provider,
      route.provider,
    );
    const exceedsReservation =
      reportedInput !== undefined &&
      reportedOutput !== undefined &&
      reportedInput > estimate + MAX_OUTPUT_TOKENS - reportedOutput;
    const exceedsOutputBound =
      reportedOutput !== undefined && reportedOutput > MAX_OUTPUT_TOKENS;
    write(
      [
        `model=${route.id}`,
        `observedProvider=${observedProvider}`,
        `declaredRoute=${route.provider}`,
        `declaredRegion=${route.region}`,
        'observedRegion=unavailable',
        'regionEvidence=configured_route_only_physical_location_unverified',
        `estimatedInput=${estimate}`,
        `reportedInput=${reportedInput ?? 'unavailable'}`,
        `ratio=${ratio}`,
        `reportedOutput=${reportedOutput ?? 'unavailable'}`,
        `costUsd=${cost ?? 'unavailable'}`,
      ].join(' ') + '\n',
    );
    if (
      !outcome ||
      outcome.attemptOutcome !== 'succeeded' ||
      exceedsReservation ||
      exceedsOutputBound
    ) {
      const safeCode =
        exceedsReservation || exceedsOutputBound
          ? 'AI_BUDGET_EXCEEDED'
          : (outcome?.safeCode ?? 'unknown');
      write(`AI smoke status=failed safeCode=${safeCode}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    if (isPrerequisiteError(error)) write(`${PREREQUISITES_MESSAGE}\n`);
    else write('AI smoke status=failed\n');
    return 1;
  }
}

type SmokeEffort = 'high' | 'max';

function parseSmokeArguments(
  argv: readonly string[],
):
  | { readonly efforts: readonly SmokeEffort[]; readonly samples: number }
  | undefined {
  if (!argv.length) return undefined;

  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      (flag !== '--profile' && flag !== '--efforts' && flag !== '--samples') ||
      value === undefined ||
      values.has(flag)
    )
      return undefined;
    values.set(flag, value);
  }

  const profile = values.get('--profile');
  const efforts = values.get('--efforts')?.split(',');
  const samples = values.get('--samples');
  if (
    values.size === 3 &&
    profile === 'chat' &&
    efforts !== undefined &&
    efforts.length > 0 &&
    efforts.every((effort) => effort === 'high' || effort === 'max') &&
    new Set(efforts).size === efforts.length &&
    samples !== undefined &&
    /^[1-2]$/.test(samples)
  )
    return {
      efforts: efforts as SmokeEffort[],
      samples: Number(samples),
    };
  return undefined;
}

async function readOutcome(
  events: AsyncIterable<ModelEvent>,
): Promise<ModelOutcome | undefined> {
  let outcome: ModelOutcome | undefined;
  for await (const event of events) {
    // Text and provider error payloads are deliberately never retained.
    if (event.type === 'outcome') outcome = event.outcome;
  }
  return outcome;
}

function readAllowlistFile(): string {
  const candidates = [
    resolve(process.cwd(), 'config/model-allowlist.json'),
    resolve(process.cwd(), 'backend/config/model-allowlist.json'),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // Try the repository-root path when the package script runs from backend/.
    }
  }
  throw new Error('Reviewed model route unavailable');
}

function isPrerequisiteError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('ZDR-only') ||
      error.message === 'OpenRouter API key is required')
  );
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
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)
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
