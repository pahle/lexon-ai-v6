import { z } from 'zod';
import { RuntimeConfigurationError } from './configuration-error.js';

const DEFAULT_SLOT_BYTES = 6_291_456;
const DEFAULT_MEMORY_BUDGET_BYTES = DEFAULT_SLOT_BYTES * 30;
const DEFAULT_STREAMS_VALKEY_MAX_MEMORY_BYTES = 768 * 1024 * 1024;
const positiveInteger = (fallback: number, max?: number) => {
  const number = z.coerce.number().int().safe().positive();
  return max === undefined
    ? number.default(fallback)
    : number.max(max).default(fallback);
};

const schema = z.object({
  AI_MAXLEN: positiveInteger(1024, 1024),
  AI_EVENT_BYTES: positiveInteger(4096, 4096),
  AI_SLOT_BYTES: positiveInteger(DEFAULT_SLOT_BYTES),
  AI_MEMORY_BUDGET_BYTES: positiveInteger(DEFAULT_MEMORY_BUDGET_BYTES),
  AI_STREAMS_VALKEY_MAXMEMORY_BYTES: positiveInteger(
    DEFAULT_STREAMS_VALKEY_MAX_MEMORY_BYTES,
  ),
  AI_MAX_ACTIVE: positiveInteger(24, 24).optional(),
  AI_MAX_ACTIVE_PER_ORG: positiveInteger(6, 6),
  AI_TERMINAL_SLOTS: positiveInteger(6, 6),
});

export interface AiConfig {
  maxLen: number;
  eventBytes: number;
  slotBytes: number;
  memoryBudgetBytes: number;
  streamsValkeyMaxMemoryBytes: number;
  maxActive: number;
  maxActivePerOrg: number;
  terminalSlots: number;
  fingerprint: string;
}

export function readAiConfig(
  env: Record<string, string | undefined>,
): AiConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new RuntimeConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ]);
  }
  const values = parsed.data;
  const slotCount = Math.floor(
    values.AI_MEMORY_BUDGET_BYTES / values.AI_SLOT_BYTES,
  );
  const maxActive =
    values.AI_MAX_ACTIVE ?? slotCount - values.AI_TERMINAL_SLOTS;
  const fixedPoolBytes =
    values.AI_SLOT_BYTES * (maxActive + values.AI_TERMINAL_SLOTS);
  const memoryBudgetValid =
    values.AI_MEMORY_BUDGET_BYTES === fixedPoolBytes &&
    BigInt(fixedPoolBytes) * 100n <=
      BigInt(values.AI_STREAMS_VALKEY_MAXMEMORY_BYTES) * 24n;
  if (
    values.AI_SLOT_BYTES !== DEFAULT_SLOT_BYTES ||
    values.AI_MAXLEN !== 1024 ||
    values.AI_EVENT_BYTES !== 4096 ||
    values.AI_MEMORY_BUDGET_BYTES !== DEFAULT_MEMORY_BUDGET_BYTES ||
    (values.AI_MAX_ACTIVE !== undefined && values.AI_MAX_ACTIVE !== 24) ||
    values.AI_TERMINAL_SLOTS !== 6 ||
    !memoryBudgetValid ||
    maxActive < 1 ||
    maxActive + values.AI_TERMINAL_SLOTS > slotCount ||
    values.AI_MAX_ACTIVE_PER_ORG > maxActive
  ) {
    throw new RuntimeConfigurationError([
      'AI_MEMORY_BUDGET_BYTES',
      'AI_MAX_ACTIVE',
      'AI_MAX_ACTIVE_PER_ORG',
      'AI_STREAMS_VALKEY_MAXMEMORY_BYTES',
    ]);
  }
  const config = {
    maxLen: values.AI_MAXLEN,
    eventBytes: values.AI_EVENT_BYTES,
    slotBytes: values.AI_SLOT_BYTES,
    memoryBudgetBytes: values.AI_MEMORY_BUDGET_BYTES,
    streamsValkeyMaxMemoryBytes: values.AI_STREAMS_VALKEY_MAXMEMORY_BYTES,
    maxActive,
    maxActivePerOrg: values.AI_MAX_ACTIVE_PER_ORG,
    terminalSlots: values.AI_TERMINAL_SLOTS,
  };
  return {
    ...config,
    fingerprint: [
      config.maxLen,
      config.eventBytes,
      config.slotBytes,
      config.memoryBudgetBytes,
      config.maxActive,
      config.maxActivePerOrg,
      config.terminalSlots,
    ].join(':'),
  };
}
