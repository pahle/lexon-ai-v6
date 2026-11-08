import { describe, expect, it } from 'vitest';
import { readAiConfig } from '../../src/config/ai-config.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

describe('AI capacity configuration', () => {
  it('uses the measured stream and admission defaults', () => {
    expect(readAiConfig({})).toMatchObject({
      maxLen: 1024,
      eventBytes: 4096,
      slotBytes: 6_291_456,
      maxActive: 24,
      maxActivePerOrg: 6,
      terminalSlots: 6,
    });
  });

  it('rejects active plus terminal slots beyond the default memory budget', () => {
    expect(() => readAiConfig({ AI_MAX_ACTIVE: '25' })).toThrow();
  });

  it('rejects unsafe stream and tenant capacity values', () => {
    for (const env of [
      { AI_MAXLEN: '0' },
      { AI_EVENT_BYTES: '4097' },
      { AI_SLOT_BYTES: '0' },
      { AI_MAX_ACTIVE_PER_ORG: '25' },
      { AI_TERMINAL_SLOTS: '-1' },
    ])
      expect(() => readAiConfig(env)).toThrow();
  });

  it('rejects stream settings that cannot match the fixed writer pool', () => {
    for (const env of [
      { AI_TERMINAL_SLOTS: '1' },
      { AI_MAX_ACTIVE: '23' },
      { AI_MAXLEN: '512' },
      { AI_EVENT_BYTES: '2048' },
      { AI_MEMORY_BUDGET_BYTES: '201326592' },
    ])
      expect(() => readAiConfig(env)).toThrow();
  });

  it('requires declared Streams maxmemory to fund the fixed pool plus 20 percent headroom', () => {
    expect(readAiConfig({})).toMatchObject({
      streamsValkeyMaxMemoryBytes: 805_306_368,
      memoryBudgetBytes: 188_743_680,
    });
    expect(() =>
      readAiConfig({ AI_STREAMS_VALKEY_MAXMEMORY_BYTES: '734003200' }),
    ).toThrow();
    expect(
      readAiConfig({ AI_STREAMS_VALKEY_MAXMEMORY_BYTES: '786432000' })
        .streamsValkeyMaxMemoryBytes,
    ).toBe(786_432_000);
  });

  it('attaches AI capacity settings only to the AI worker runtime', () => {
    const env = {
      DATABASE_APP_URL: 'postgresql://lexon_app:secret@localhost/test',
      DATABASE_POOL_MAX: '5',
      QUEUE_PREFIX: 'bull',
      JOB_RECEIPT_RETENTION_SECONDS: '2592000',
      DATABASE_STATEMENT_TIMEOUT_MS: '10000',
      VALKEY_QUEUE_URL: 'redis://localhost/0',
      VALKEY_STREAMS_URL: 'redis://localhost/0',
      VALKEY_LIMITER_URL: 'redis://localhost/0',
      HEALTH_FILE: '/tmp/health.json',
      HEALTH_WRITE_INTERVAL_MS: '5000',
      HEALTH_STALE_MS: '20000',
      DEPENDENCY_TIMEOUT_MS: '2000',
    };
    expect(loadRuntimeConfig('ai-worker', env)).toHaveProperty(
      'ai.maxActive',
      24,
    );
    expect(loadRuntimeConfig('dispatcher', env)).not.toHaveProperty('ai');
  });
});
