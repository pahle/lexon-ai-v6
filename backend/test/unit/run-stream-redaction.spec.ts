import { expect, it } from 'vitest';
import { redactRunStreamEventForReader } from '../../src/infrastructure/queue/run-stream-parts.js';

// F6 §5 row 14: a project member or share recipient streaming a run sees the
// lifecycle spine but never the operation payloads — the same fields the §9
// byte-cap fallback drops (input/display/output), so the client treats a
// redacted frame like a capped one and the "Waiting for <owner>" marker and
// tool rows still render.
const runId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';
const toolCallId = 'call-1';

it('strips the operation payloads from required-decision events but keeps the ids/status core', () => {
  for (const type of ['approval-required', 'question-required'] as const) {
    const event = {
      version: 1,
      runId,
      type,
      operationId,
      kind: type === 'approval-required' ? 'approval' : 'question',
      operation: {
        operationId,
        kind: type === 'approval-required' ? 'approval' : 'question',
        status: 'awaiting_approval',
        approvalRequired: true,
        snapshotHash: 'a'.repeat(64),
        expiresAt: null,
        decidedAt: null,
        toolName: 'fixture-tool',
        input: { query: 'confidential matter research' },
        display: { currentTitle: 'secret title' },
        output: { hits: 3 },
      },
    };
    const redacted = JSON.parse(
      redactRunStreamEventForReader(JSON.stringify(event)),
    ) as { operation: Record<string, unknown>; operationId: string };
    expect(redacted.operationId).toBe(operationId);
    expect(redacted.operation).toMatchObject({
      toolName: 'fixture-tool',
      status: 'awaiting_approval',
      snapshotHash: 'a'.repeat(64),
    });
    expect(redacted.operation).not.toHaveProperty('input');
    expect(redacted.operation).not.toHaveProperty('display');
    expect(redacted.operation).not.toHaveProperty('output');
  }
});

it('drops the payload fields from tool input/output events', () => {
  const input = JSON.parse(
    redactRunStreamEventForReader(
      JSON.stringify({
        version: 1,
        runId,
        type: 'tool-input-available',
        toolCallId,
        toolName: 'fixture-tool',
        operationId,
        input: { query: 'confidential matter research' },
      }),
    ),
  ) as Record<string, unknown>;
  expect(input).toMatchObject({ toolCallId, operationId });
  expect(input).not.toHaveProperty('input');

  const output = JSON.parse(
    redactRunStreamEventForReader(
      JSON.stringify({
        version: 1,
        runId,
        type: 'tool-output-available',
        toolCallId,
        operationId,
        output: { hits: [{ title: 'secret document' }] },
      }),
    ),
  ) as Record<string, unknown>;
  expect(output).toMatchObject({ toolCallId, operationId });
  expect(output).not.toHaveProperty('output');
});

it('empties streamed tool-input deltas', () => {
  const redacted = JSON.parse(
    redactRunStreamEventForReader(
      JSON.stringify({
        version: 1,
        runId,
        type: 'tool-input-delta',
        toolCallId,
        inputTextDelta: '{"query":"sec',
      }),
    ),
  ) as { inputTextDelta: string };
  expect(redacted.inputTextDelta).toBe('');
});

it('returns malformed stored frames untouched instead of throwing', () => {
  // A corrupt entry must not crash the subscription pump on an unhandled
  // JSON.parse rejection inside `deliver`.
  const corrupt = '{"type":"tool-input-available","toolCallId';
  expect(redactRunStreamEventForReader(corrupt)).toBe(corrupt);
});

it('passes payload-free lifecycle events through untouched', () => {
  for (const event of [
    {
      version: 1,
      runId,
      type: 'operation-status',
      operationId,
      status: 'completed',
    },
    { version: 1, runId, type: 'status', status: 'running' },
    { version: 1, runId, type: 'tool-output-denied', toolCallId },
    { version: 1, runId, type: 'text-delta', id: 't1', delta: 'the answer' },
    { version: 2, runId, type: 'reasoning-delta', id: 'r1', delta: 'thinking' },
  ]) {
    expect(redactRunStreamEventForReader(JSON.stringify(event))).toBe(
      JSON.stringify(event),
    );
  }
});
