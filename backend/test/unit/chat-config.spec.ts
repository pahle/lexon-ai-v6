import { describe, expect, it } from 'vitest';
import { readChatConfig } from '../../src/config/chat-config.js';

describe('chat SSE configuration', () => {
  it('defaults deletion grace and target and validates their ordering', () => {
    expect(readChatConfig({})).toMatchObject({
      deleteGraceMs: 30_000,
      deleteTargetMs: 60_000,
    });
    expect(
      readChatConfig({
        CHAT_DELETE_GRACE_MS: '1000',
        CHAT_DELETE_TARGET_MS: '5000',
      }),
    ).toMatchObject({ deleteGraceMs: 1000, deleteTargetMs: 5000 });
    expect(() =>
      readChatConfig({
        CHAT_DELETE_GRACE_MS: '5000',
        CHAT_DELETE_TARGET_MS: '1000',
      }),
    ).toThrow('CHAT_DELETE_TARGET_MS');
  });

  it('defaults to six connections per user', () => {
    expect(readChatConfig({})).toMatchObject({ maxConnectionsPerUser: 6 });
  });

  it('allows a positive per-user limit through 512', () => {
    expect(
      readChatConfig({ CHAT_SSE_CONNECTIONS_PER_USER: '512' }),
    ).toMatchObject({ maxConnectionsPerUser: 512 });
  });

  it('rejects limits outside the supported range', () => {
    for (const value of ['0', '-1', '513', '1.5', 'nope'])
      expect(() =>
        readChatConfig({ CHAT_SSE_CONNECTIONS_PER_USER: value }),
      ).toThrow();
  });
});
