import { describe, expect, it, vi } from 'vitest';
import { readAiConfig } from '../../src/config/ai-config.js';
import { RuntimeConfigurationError } from '../../src/config/configuration-error.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import {
  createRealModelGateway,
  ModelAllowlistSchema,
  type ModelInput,
} from '../../src/infrastructure/ai/index.js';

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

  it('reads the OpenRouter key and dated ZDR attestation from the environment', () => {
    expect(
      readAiConfig({
        OPENROUTER_API_KEY: 'test-only-key',
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '2026-11-20',
      }),
    ).toMatchObject({
      openRouterApiKey: 'test-only-key',
      openRouterZdrOnlyVerified: '2026-11-20',
    });
  });

  it('accepts a future-dated attestation; recency stays a request-time check', () => {
    expect(
      readAiConfig({ LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '2099-01-01' })
        .openRouterZdrOnlyVerified,
    ).toBe('2099-01-01');
  });

  it('treats blank provider variables as unset, as Compose defaults them', () => {
    expect(
      readAiConfig({
        OPENROUTER_API_KEY: '',
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '',
      }),
    ).toMatchObject({
      openRouterApiKey: undefined,
      openRouterZdrOnlyVerified: undefined,
    });
    expect(readAiConfig({ OPENROUTER_API_KEY: ' ' }).openRouterApiKey).toBe(
      undefined,
    );
  });

  it.each(['maybe', 'yesterday', '2026-1-5', '2026-13-40', '2026-02-30'])(
    'rejects a malformed ZDR attestation %j naming the field, not the value',
    (value) => {
      try {
        readAiConfig({ LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: value });
        expect.unreachable('must reject invalid attestation');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeConfigurationError);
        expect(String(error)).toContain('LEXON_OPENROUTER_ZDR_ONLY_VERIFIED');
        expect(String(error)).not.toContain(value);
        expect(JSON.stringify(error)).not.toContain(value);
      }
    },
  );

  it('leaves the model gateway in its documented unavailable mode without a key', async () => {
    const config = readAiConfig({});
    expect(config.openRouterApiKey).toBeUndefined();
    const fetchSpy = vi.fn<typeof fetch>();
    const gateway = createRealModelGateway({
      allowlist: ModelAllowlistSchema.parse({
        version: 1,
        models: [
          {
            id: 'openai/gpt-6-luna',
            provider: 'azure/us',
            region: 'us',
            zeroDataRetention: true,
            reviewedAt: '2026-11-05T00:00:00.000Z',
          },
        ],
      }),
      key: config.openRouterApiKey,
      attestation: config.openRouterZdrOnlyVerified,
      fetch: fetchSpy,
    });
    const input: ModelInput = {
      model: 'openai/gpt-6-luna',
      provider: 'azure/us',
      messages: [{ role: 'user', content: 'synthetic prompt' }],
      maxOutputTokens: 12,
      signal: new AbortController().signal,
    };
    const drain = async () => {
      for await (const event of gateway.generate(input)) void event;
    };
    await expect(drain()).rejects.toThrow('OpenRouter API key is required');
    expect(fetchSpy).not.toHaveBeenCalled();
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
