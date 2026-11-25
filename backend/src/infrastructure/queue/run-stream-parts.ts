import {
  ChatOperationSnapshotSchema,
  ChatSnapshotFrameSchema,
  RunStreamEventSchema,
  type ChatOperationSnapshot,
  type ChatSnapshotFrame,
  type RunStreamEvent,
} from '@lexon/contracts';

const DEFAULT_MAX_BYTES = 4096;

/**
 * §9 snapshot-operation byte-cap fallback: frames that would overflow the
 * stream limit are emitted without `input`/`display`/`output` — ids, status
 * and `snapshotHash` always survive; the client refetches the tree for the
 * missing summary.
 */
export function capSnapshotOperation(
  operation: ChatOperationSnapshot,
  index: number,
  maxBytes = DEFAULT_MAX_BYTES,
): ChatSnapshotFrame {
  const build = (op: ChatOperationSnapshot) => ({
    version: 1 as const,
    type: 'snapshot-operation' as const,
    index,
    operation: op,
  });
  const full = build(operation);
  if (Buffer.byteLength(JSON.stringify(full), 'utf8') <= maxBytes)
    return ChatSnapshotFrameSchema.parse(full);
  const stripped = ChatOperationSnapshotSchema.parse(
    Object.fromEntries(
      Object.entries(operation).filter(
        ([key]) => !['input', 'display', 'output'].includes(key),
      ),
    ),
  );
  const trimmed = build(stripped);
  if (Buffer.byteLength(JSON.stringify(trimmed), 'utf8') > maxBytes)
    throw new Error('Stream event exceeds limit');
  return ChatSnapshotFrameSchema.parse(trimmed);
}

/**
 * §9 live-event byte-cap fallback: `approval-required`/`question-required`
 * frames that overflow are re-emitted as `{operationId,kind}` only — the
 * client detects the missing summary and fetches the tree.
 */
export function capRequiredEvent(
  event: Extract<
    RunStreamEvent,
    { type: 'approval-required' | 'question-required' }
  >,
  maxBytes = DEFAULT_MAX_BYTES,
): RunStreamEvent[] {
  const parsed = RunStreamEventSchema.safeParse(event);
  if (!parsed.success) throw new Error('Invalid run stream event');
  if (Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') <= maxBytes)
    return [parsed.data];
  const minimal = {
    version: event.version,
    runId: event.runId,
    type: event.type,
    operationId: event.operationId,
    kind: event.kind,
  };
  const reparsed = RunStreamEventSchema.safeParse(minimal);
  if (!reparsed.success) throw new Error('Invalid run stream event');
  if (Buffer.byteLength(JSON.stringify(reparsed.data), 'utf8') > maxBytes)
    throw new Error('Stream event exceeds limit');
  return [reparsed.data];
}

/**
 * F6 §5 row 14 reader redaction: a stored run-stream event keeps its
 * ids/status core but never carries operation payloads to a non-owner
 * subscriber — the same fields the §9 byte-cap fallback drops, so the client
 * treats a redacted frame like a capped one (pending markers and tool rows
 * still render). Payload-free event types return the stored bytes untouched.
 */
const READER_PAYLOAD_EVENT =
  /"(approval-required|question-required|tool-input-available|tool-input-delta|tool-output-available)"/;

export function redactRunStreamEventForReader(data: string): string {
  if (!READER_PAYLOAD_EVENT.test(data)) return data;
  const event = JSON.parse(data) as {
    type?: string;
    operation?: Record<string, unknown>;
    input?: unknown;
    output?: unknown;
    inputTextDelta?: string;
  };
  switch (event.type) {
    case 'approval-required':
    case 'question-required':
      if (event.operation && typeof event.operation === 'object') {
        delete event.operation.input;
        delete event.operation.display;
        delete event.operation.output;
      }
      break;
    case 'tool-input-available':
      delete event.input;
      break;
    case 'tool-input-delta':
      event.inputTextDelta = '';
      break;
    case 'tool-output-available':
      delete event.output;
      break;
    default:
      return data;
  }
  return JSON.stringify(event);
}

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
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= maxBytes)
      return [snapshot];
    // §9: the output block is droppable — ids always reach the client.
    const trimmed = RunStreamEventSchema.parse({
      version: snapshot.version,
      runId: snapshot.runId,
      type: 'tool-output-available',
      toolCallId: snapshot.toolCallId,
      operationId: snapshot.operationId,
    });
    assertSerializedSize(trimmed, maxBytes);
    return [trimmed];
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
