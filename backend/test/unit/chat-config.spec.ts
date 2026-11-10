import { describe, expect, it } from 'vitest';
import { readChatConfig } from '../../src/config/chat-config.js';

describe('chat SSE configuration', () => {
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
