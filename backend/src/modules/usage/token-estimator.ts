import type { ModelInput } from '../../infrastructure/ai/index.js';

export interface TokenEstimate {
  readonly version: 1;
  readonly inputTokens: number;
}

function canonicalize(value: unknown, path: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid model input');
    return value;
  }
  if (typeof value !== 'object') throw new Error('Invalid model input');
  if (path.has(value)) throw new Error('Invalid model input');
  path.add(value);
  try {
    if (Array.isArray(value))
      return value.map((item) => canonicalize(item, path));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error('Invalid model input');
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) throw new Error('Invalid model input');
      output[key] = canonicalize(item, path);
    }
    return output;
  } finally {
    path.delete(value);
  }
}

export function estimateInputTokens(input: ModelInput): TokenEstimate {
  if (!input || !Array.isArray(input.messages))
    throw new Error('Invalid model input');
  const messages = canonicalize(input.messages, new Set());
  const schemas = canonicalize(input.schemas ?? {}, new Set());
  const serialized = JSON.stringify({ messages, schemas });
  if (typeof serialized !== 'string') throw new Error('Invalid model input');
  const bytes = Buffer.byteLength(serialized, 'utf8');
  const toolCount = input.schemas ? Object.keys(input.schemas).length : 0;
  const inputTokens =
    bytes + input.messages.length * 64 + toolCount * 256 + 1024;
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0)
    throw new Error('Token estimate overflow');
  return { version: 1, inputTokens };
}
