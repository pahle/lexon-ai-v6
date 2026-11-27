import { expect, it, vi } from 'vitest';
import { ChatService } from '../../src/modules/chat/chat.service.js';
import { ApprovalService } from '../../src/modules/chat/approval.service.js';
import type { RunActor } from '../../src/modules/identity-access/index.js';

// A raced write can deadlock against a concurrent tenant transaction
// (Postgres 40P01 / 40001). The transaction rolled back cleanly, so the
// raced endpoints replay the whole unit of work — the loser then reads the
// winner's committed state and resolves through ordinary business logic
// (decide→stored outcome 200, send→CHAT_CONFLICT), instead of surfacing an
// unmapped 500. Spec §5 rows 5/9 and the decide/send race contract.
const orgId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const chatId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';
const messageId = '66666666-6666-4666-8666-666666666666';
const actor = { orgId, userId } as RunActor;

const deadlock = () =>
  Object.assign(new Error('deadlock detected'), { code: '40P01' });
const serialization = () =>
  Object.assign(new Error('could not serialize access'), { code: '40001' });
const uniqueViolation = () =>
  Object.assign(new Error('duplicate key value'), { code: '23505' });

function chatService(withTenant: ReturnType<typeof vi.fn>) {
  return new ChatService(
    { withTenant } as never,
    {} as never,
    { assertLiveActor: vi.fn() } as never,
  );
}

function approvalService(withTenant: ReturnType<typeof vi.fn>) {
  return new ApprovalService(
    { withTenant } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertLiveActor: vi.fn() } as never,
    {} as never,
    { profile: vi.fn() } as never,
  );
}

const sendInput = {
  userMessageId: messageId,
  parentMessageId: null,
  text: 'Racing send',
  effort: 'high' as const,
};
const decideInput = {
  runId,
  operationId,
  snapshotHash: 'snapshot',
  decision: 'approve' as const,
};

it('send retries a deadlocked transaction and returns the retry outcome', async () => {
  const outcome = { result: { status: 'created' }, superseded: undefined };
  const withTenant = vi
    .fn()
    .mockRejectedValueOnce(deadlock())
    .mockResolvedValueOnce(outcome);
  const service = chatService(withTenant);

  const result = await service.send(actor, chatId, sendInput);

  expect(result).toBe(outcome.result);
  expect(withTenant).toHaveBeenCalledTimes(2);
});

it('send retries a serialization failure as well as a deadlock', async () => {
  const outcome = { result: { status: 'created' }, superseded: undefined };
  const withTenant = vi
    .fn()
    .mockRejectedValueOnce(serialization())
    .mockResolvedValueOnce(outcome);
  const service = chatService(withTenant);

  const result = await service.send(actor, chatId, sendInput);

  expect(result).toBe(outcome.result);
  expect(withTenant).toHaveBeenCalledTimes(2);
});

it('send surfaces a non-retryable failure without retrying', async () => {
  const withTenant = vi.fn().mockRejectedValue(uniqueViolation());
  const service = chatService(withTenant);

  await expect(service.send(actor, chatId, sendInput)).rejects.toMatchObject({
    code: '23505',
  });
  expect(withTenant).toHaveBeenCalledTimes(1);
});

it('send gives up after the bounded attempts and rethrows the error', async () => {
  const withTenant = vi.fn().mockRejectedValue(deadlock());
  const service = chatService(withTenant);

  await expect(service.send(actor, chatId, sendInput)).rejects.toMatchObject({
    code: '40P01',
  });
  expect(withTenant).toHaveBeenCalledTimes(3);
});

it('decideOperation retries a deadlocked transaction', async () => {
  const outcome = { kind: 'stored', outcome: { status: 'rejected' } };
  const withTenant = vi
    .fn()
    .mockRejectedValueOnce(deadlock())
    .mockResolvedValueOnce(outcome);
  const service = approvalService(withTenant);

  const result = await service.decideOperation(actor, decideInput);

  expect(result).toBe(outcome.outcome);
  expect(withTenant).toHaveBeenCalledTimes(2);
});

it('decideOperation surfaces a non-retryable failure without retrying', async () => {
  const withTenant = vi.fn().mockRejectedValue(uniqueViolation());
  const service = approvalService(withTenant);

  await expect(
    service.decideOperation(actor, decideInput),
  ).rejects.toMatchObject({ code: '23505' });
  expect(withTenant).toHaveBeenCalledTimes(1);
});
