import { expect, it } from 'vitest';
import {
  parseJobEnvelope,
  type JobEnvelope,
} from '../../src/modules/platform/index.js';

const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const outboxId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const chatId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';

it('accepts strict ID-only title and cleanup envelopes with required UUID context', () => {
  const title = parseJobEnvelope({
    outboxId,
    type: 'chat.title.v1',
    ctx: { orgId, userId },
    payload: { chatId, runId },
  });
  const cleanup = parseJobEnvelope({
    outboxId,
    type: 'chat.cleanup.v1',
    ctx: { orgId, userId },
    payload: { chatId },
  });
  expect(title.type).toBe('chat.title.v1');
  expect(cleanup.type).toBe('chat.cleanup.v1');
  expect(Object.isFrozen(title.payload)).toBe(true);
  expect(Object.isFrozen(cleanup.payload)).toBe(true);
});

it('rejects missing UUID actor context and content or provider fields', () => {
  const base: JobEnvelope = {
    outboxId,
    type: 'platform.noop.v1',
    ctx: { orgId },
    payload: { probeId: runId },
  };
  for (const job of [
    {
      ...base,
      type: 'chat.title.v1',
      ctx: { orgId },
      payload: { chatId, runId },
    },
    {
      ...base,
      type: 'chat.cleanup.v1',
      ctx: { orgId, userId },
      payload: { chatId, text: 'private' },
    },
    {
      ...base,
      type: 'chat.title.v1',
      ctx: { orgId, userId },
      payload: { chatId, runId, provider: 'openrouter' },
    },
    {
      ...base,
      type: 'chat.title.v1',
      ctx: { orgId, userId, tenantId: orgId },
      payload: { chatId, runId },
    },
  ])
    expect(() => parseJobEnvelope(job)).toThrow(/^Invalid job envelope$/);
});

it('preserves existing run-step and platform envelope parsing', () => {
  expect(
    parseJobEnvelope({
      outboxId,
      type: 'run.advance.v1',
      ctx: { orgId, userId },
      payload: { runId, sequence: 1, expectedVersion: 1 },
    }).type,
  ).toBe('run.advance.v1');
  expect(
    parseJobEnvelope({
      outboxId,
      type: 'platform.noop.v1',
      ctx: { orgId },
      payload: { probeId: runId },
    }).type,
  ).toBe('platform.noop.v1');
});
