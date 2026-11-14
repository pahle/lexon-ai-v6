import { RunStreamEventSchema, type RunStreamEvent } from '@lexon/contracts';

const DEFAULT_MAX_BYTES = 4096;

/** Split large textual stream parts without breaking UTF-8 or JSON escaping. */
export function encodeStreamParts(
  event: RunStreamEvent,
  maxBytes = DEFAULT_MAX_BYTES,
): RunStreamEvent[] {
  return encodeStreamPartsWithBudget(event, maxBytes, Number.MAX_SAFE_INTEGER);
}

/** Encode at most maxParts and stop traversing input as soon as that budget is exceeded. */
export function encodeStreamPartsBounded(
  event: RunStreamEvent,
  maxBytes: number,
  maxParts: number,
): RunStreamEvent[] {
  if (!Number.isSafeInteger(maxParts) || maxParts < 1)
    throw new Error('Invalid stream part count limit');
  return encodeStreamPartsWithBudget(event, maxBytes, maxParts);
}

function encodeStreamPartsWithBudget(
  event: RunStreamEvent,
  maxBytes: number,
  maxParts: number,
): RunStreamEvent[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Invalid stream part limit');
  if (event.type === 'tool-input-available')
    return encodeToolInput(event, maxBytes, maxParts);
  const parsed = RunStreamEventSchema.safeParse(event);
  if (!parsed.success) throw new Error('Invalid run stream event');
  const snapshot = parsed.data;

  if (snapshot.type === 'text-delta')
    return splitText(snapshot, 'delta', snapshot.delta, maxBytes, maxParts);
  if (snapshot.type === 'reasoning-delta')
    return splitText(snapshot, 'delta', snapshot.delta, maxBytes, maxParts);
  if (snapshot.type === 'tool-input-delta')
    return splitText(
      snapshot,
      'inputTextDelta',
      snapshot.inputTextDelta,
      maxBytes,
      maxParts,
    );
  if (snapshot.type === 'tool-output-available') {
    if (!snapshot.operationId)
      throw new Error('Tool result requires durable operation metadata');
    return encodeStreamPartsWithBudget(
      {
        version: snapshot.version,
        runId: snapshot.runId,
        type: 'operation-status',
        operationId: snapshot.operationId,
        status: 'completed',
      },
      maxBytes,
      maxParts,
    );
  }
  assertSerializedSize(snapshot, maxBytes);
  return [snapshot];
}

function encodeToolInput(
  event: Extract<RunStreamEvent, { type: 'tool-input-available' }>,
  maxBytes: number,
  maxParts: number,
): RunStreamEvent[] {
  const allowedKeys = new Set([
    'version',
    'runId',
    'type',
    'toolCallId',
    'toolName',
    'operationId',
    'input',
  ]);
  let keyCount = 0;
  for (const key in event) {
    if (!Object.hasOwn(event, key)) continue;
    keyCount++;
    if (keyCount > allowedKeys.size || !allowedKeys.has(key))
      throw new Error('Invalid run stream event');
  }
  const version = event.version;
  const runId = event.runId;
  const toolCallId = event.toolCallId;
  const toolName = event.toolName;
  const operationId = event.operationId;
  const input = event.input;
  const metadata: RunStreamEvent = {
    version,
    runId,
    type: 'tool-input-available',
    toolCallId,
    toolName,
    ...(operationId === undefined ? {} : { operationId }),
    input: {},
  };
  if (!RunStreamEventSchema.safeParse(metadata).success)
    throw new Error('Invalid run stream event');
  const maxJsonBytes = Number.isSafeInteger(maxParts * maxBytes)
    ? maxParts * maxBytes
    : Number.POSITIVE_INFINITY;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Tool input is not JSON serializable');
  const serialized = serializeJsonValueBounded(input, maxJsonBytes);
  const completion: RunStreamEvent = {
    ...metadata,
    input: JSON.parse(serialized) as Record<string, unknown>,
  };
  if (Buffer.byteLength(JSON.stringify(completion), 'utf8') <= maxBytes)
    return [completion];
  if (!operationId)
    throw new Error('Oversized tool input requires durable operation metadata');
  const start: RunStreamEvent = {
    version,
    runId,
    type: 'tool-input-start',
    toolCallId,
    toolName,
    inputEncoding: 'json',
  };
  const available: RunStreamEvent = {
    version,
    runId,
    type: 'tool-input-available',
    toolCallId,
    toolName,
    operationId,
  };
  assertSerializedSize(start, maxBytes);
  assertSerializedSize(available, maxBytes);
  const deltaLimit = maxParts - 2;
  if (deltaLimit < 1) throw new Error('Stream event exceeds part limit');
  const deltas = splitText(
    {
      version,
      runId,
      type: 'tool-input-delta',
      toolCallId,
      inputTextDelta: '',
    },
    'inputTextDelta',
    serialized,
    maxBytes,
    deltaLimit,
  );
  return [start, ...deltas, available];
}

function splitText(
  event: Extract<
    RunStreamEvent,
    { type: 'text-delta' | 'reasoning-delta' | 'tool-input-delta' }
  >,
  field: 'delta' | 'inputTextDelta',
  value: string,
  maxBytes: number,
  maxParts: number,
): RunStreamEvent[] {
  const empty = { ...event, [field]: '' };
  const fixedBytes = Buffer.byteLength(JSON.stringify(empty), 'utf8');
  if (fixedBytes > maxBytes)
    throw new Error('Stream event envelope exceeds limit');

  const result: RunStreamEvent[] = [];
  let current = '';
  let currentBytes = fixedBytes;
  for (const codePoint of value) {
    const codePointBytes =
      Buffer.byteLength(JSON.stringify(codePoint), 'utf8') - 2;
    if (currentBytes + codePointBytes > maxBytes) {
      if (current.length === 0)
        throw new Error('Stream event envelope exceeds limit');
      pushPart(
        result,
        { ...event, [field]: current } as RunStreamEvent,
        maxParts,
      );
      current = '';
      currentBytes = fixedBytes;
    }
    current += codePoint;
    currentBytes += codePointBytes;
  }
  if (current.length > 0 || result.length === 0)
    pushPart(
      result,
      { ...event, [field]: current } as RunStreamEvent,
      maxParts,
    );
  for (const part of result) assertSerializedSize(part, maxBytes);
  return result;
}

function pushPart(
  parts: RunStreamEvent[],
  part: RunStreamEvent,
  maxParts: number,
): void {
  if (parts.length >= maxParts)
    throw new Error('Stream event exceeds part limit');
  parts.push(part);
}

function serializeJsonValueBounded(value: unknown, maxBytes: number): string {
  const chunks: string[] = [];
  const ancestors = new WeakSet<object>();
  let current = '';
  let bytes = 0;
  const append = (piece: string): void => {
    bytes += Buffer.byteLength(piece, 'utf8');
    if (bytes > maxBytes) throw new Error('Stream event exceeds part limit');
    current += piece;
    if (Buffer.byteLength(current, 'utf8') >= 4096) {
      chunks.push(current);
      current = '';
    }
  };
  const appendString = (text: string): void => {
    append('"');
    for (const codePoint of text) {
      const code = codePoint.codePointAt(0)!;
      if (codePoint.length === 1 && code >= 0xd800 && code <= 0xdfff) {
        append(`\\u${code.toString(16).padStart(4, '0')}`);
      } else if (codePoint === '"') append('\\"');
      else if (codePoint === '\\') append('\\\\');
      else if (codePoint === '\b') append('\\b');
      else if (codePoint === '\t') append('\\t');
      else if (codePoint === '\n') append('\\n');
      else if (codePoint === '\f') append('\\f');
      else if (codePoint === '\r') append('\\r');
      else if (code <= 0x1f) append(`\\u${code.toString(16).padStart(4, '0')}`);
      else append(codePoint);
    }
    append('"');
  };
  const visit = (item: unknown): void => {
    if (item === null) {
      append('null');
      return;
    }
    if (typeof item === 'string') {
      appendString(item);
      return;
    }
    if (typeof item === 'boolean') {
      append(item ? 'true' : 'false');
      return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      append(JSON.stringify(item));
      return;
    }
    if (!item || typeof item !== 'object')
      throw new Error('Tool input is not JSON serializable');
    if (ancestors.has(item))
      throw new Error('Tool input is not JSON serializable');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        append('[');
        for (let index = 0; index < item.length; index++) {
          if (index > 0) append(',');
          if (!Object.hasOwn(item, index))
            throw new Error('Tool input is not JSON serializable');
          visit(item[index]);
        }
        append(']');
      } else {
        const prototype = Object.getPrototypeOf(item);
        if (prototype !== Object.prototype && prototype !== null)
          throw new Error('Tool input is not JSON serializable');
        append('{');
        let first = true;
        for (const key in item) {
          if (!Object.hasOwn(item, key)) continue;
          if (!first) append(',');
          first = false;
          appendString(key);
          append(':');
          visit((item as Record<string, unknown>)[key]);
        }
        append('}');
      }
    } finally {
      ancestors.delete(item);
    }
  };
  try {
    visit(value);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Stream event exceeds part limit'
    )
      throw error;
    throw new Error('Tool input is not JSON serializable', { cause: error });
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current);
  return chunks.join('');
}

function assertSerializedSize(event: RunStreamEvent, maxBytes: number): void {
  if (Buffer.byteLength(JSON.stringify(event), 'utf8') > maxBytes)
    throw new Error('Stream event exceeds limit');
}
