import { expect, test, vi } from 'vitest';
import { SafeErrorMessages } from '@lexon/contracts';
import {
  ChatClientError,
  chatClientError,
  safeChatError,
} from '../src/lib/chat-errors';
import { createChatClient } from '../src/lib/chat-client';

test('a SERVICE_UNAVAILABLE body parses to the outage code, not a fallback', async () => {
  const error = await chatClientError(
    Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'private' } },
      { status: 503 },
    ),
  );
  expect(error).toBeInstanceOf(ChatClientError);
  expect(error.code).toBe('SERVICE_UNAVAILABLE');
  expect(error.status).toBe(503);
  expect(error.message).toBe(
    'Service temporarily unavailable. Please try again.',
  );
  expect(error.message).not.toContain('private');
});

test('safeChatError maps SERVICE_UNAVAILABLE to the outage copy', () => {
  expect(safeChatError('SERVICE_UNAVAILABLE')).toBe(
    SafeErrorMessages.SERVICE_UNAVAILABLE,
  );
  expect(SafeErrorMessages.SERVICE_UNAVAILABLE).toBe(
    'Service temporarily unavailable. Please try again.',
  );
});

test('the chat client preserves a SERVICE_UNAVAILABLE outage for retry', async () => {
  const chatId = '00000000-0000-4000-8000-000000000001';
  const fetcher = vi.fn(async () =>
    Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'private' } },
      { status: 503 },
    ),
  );
  const client = createChatClient({ baseUrl: '/api', fetch: fetcher });
  const failure = await client.get(chatId).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ChatClientError);
  expect((failure as ChatClientError).code).toBe('SERVICE_UNAVAILABLE');
  expect((failure as ChatClientError).code).not.toBe('AI_ACCESS_REVOKED');
});
