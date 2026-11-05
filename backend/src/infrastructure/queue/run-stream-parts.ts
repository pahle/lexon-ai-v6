import { RunStreamEventSchema, type RunStreamEvent } from '@lexon/contracts';

const DEFAULT_MAX_BYTES = 4096;

/** Split large textual stream parts without breaking UTF-8 or JSON escaping. */
export function encodeStreamParts(
  event: RunStreamEvent,
  maxBytes = DEFAULT_MAX_BYTES,
): RunStreamEvent[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Invalid stream part limit');
  if (!RunStreamEventSchema.safeParse(event).success)
    throw new Error('Invalid run stream event');

  if (event.type === 'text-delta')
    return splitText(event, 'delta', event.delta, maxBytes);
  if (event.type === 'tool-input-delta')
    return splitText(event, 'inputTextDelta', event.inputTextDelta, maxBytes);
  if (event.type === 'tool-output-available') {
    if (!event.operationId)
      throw new Error('Tool result requires durable operation metadata');
    return encodeStreamParts(
      {
        version: event.version,
        runId: event.runId,
        type: 'operation-status',
        operationId: event.operationId,
        status: 'completed',
      },
      maxBytes,
    );
  }
  if (event.type === 'tool-input-available') {
    if (!isJsonValue(event.input))
      throw new Error('Tool input is not JSON serializable');
    const serialized = JSON.stringify(event.input);
    if (serialized === undefined)
      throw new Error('Tool input is not JSON serializable');
    try {
      assertSerializedSize(event, maxBytes);
      return [event];
    } catch {
      if (!event.operationId)
        throw new Error(
          'Oversized tool input requires durable operation metadata',
        );
      const start: RunStreamEvent = {
        version: event.version,
        runId: event.runId,
        type: 'tool-input-start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        inputEncoding: 'json',
      };
      const deltas = splitText(
        {
          version: event.version,
          runId: event.runId,
          type: 'tool-input-delta',
          toolCallId: event.toolCallId,
          inputTextDelta: serialized,
        },
        'inputTextDelta',
        serialized,
        maxBytes,
      );
      const available: RunStreamEvent = {
        version: event.version,
        runId: event.runId,
        type: 'tool-input-available',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        operationId: event.operationId,
      };
      assertSerializedSize(start, maxBytes);
      assertSerializedSize(available, maxBytes);
      return [start, ...deltas, available];
    }
  }
  {
    assertSerializedSize(event, maxBytes);
    return [event];
  }
}

function splitText(
  event: Extract<RunStreamEvent, { type: 'text-delta' | 'tool-input-delta' }>,
  field: 'delta' | 'inputTextDelta',
  value: string,
  maxBytes: number,
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
      result.push({ ...event, [field]: current } as RunStreamEvent);
      current = '';
      currentBytes = fixedBytes;
    }
    current += codePoint;
    currentBytes += codePointBytes;
  }
  if (current.length > 0 || result.length === 0)
    result.push({ ...event, [field]: current } as RunStreamEvent);
  for (const part of result) assertSerializedSize(part, maxBytes);
  return result;
}

function assertSerializedSize(event: RunStreamEvent, maxBytes: number): void {
  if (Buffer.byteLength(JSON.stringify(event), 'utf8') > maxBytes)
    throw new Error('Stream event exceeds limit');
}

function isJsonValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (
          !Object.hasOwn(value, index) ||
          !isJsonValue(value[index], ancestors)
        )
          return false;
      }
      return true;
    }
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false;
    return Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
}
