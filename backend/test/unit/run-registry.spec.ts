import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_ENGINE_REGISTRATIONS,
  RunRegistry,
  type EngineRegistrations,
} from '../../src/modules/chat/index.js';
import { z } from 'zod';

const profile = {
  id: 'test-profile',
  version: 1,
  allowedModels: ['provider/model'],
  defaultModel: 'provider/model',
  queue: 'ai-interactive',
  priority: 5,
  maxIterations: 4,
  tokenBudget: 1000,
  maxOutputTokens: 128,
  contextBudgets: {},
  capabilities: [],
} as const;

const readTool = {
  id: 'read-tool',
  version: 1,
  kind: 'read',
  inputSchema: z.strictObject({ query: z.string() }),
  requiresApproval: false,
  timeoutMs: 5000,
  maxResultBytes: 16384,
  capabilities: [],
  execute: async () => ({ ok: true }),
} as const;

const transactionalWriteTool = {
  ...readTool,
  id: 'write-tool',
  kind: 'write',
  requiresApproval: true,
  idempotency: { mode: 'transactional' },
};

const registrations = (
  overrides: Partial<EngineRegistrations> = {},
): EngineRegistrations => ({
  profiles: [profile],
  contexts: [],
  tools: [],
  ...overrides,
});

describe('run registry', () => {
  it('resolves only an explicitly registered profile', () => {
    const registry = new RunRegistry();
    registry.register(registrations());
    expect(registry.profile('test-profile')).toBe(profile);
    expect(registry.profile('unknown-profile')).toBeUndefined();
  });

  it('write registration requires idempotency mode', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(
        registrations({
          tools: [
            { ...transactionalWriteTool, idempotency: undefined } as never,
          ],
        }),
      ),
    ).toThrow();
  });

  it('duplicate profile/tool ids rejected', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(registrations({ profiles: [profile, profile] })),
    ).toThrow();
    expect(() =>
      registry.register(registrations({ tools: [readTool, readTool] })),
    ).toThrow();
  });

  it('read tool needs no mode', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(registrations({ tools: [readTool] })),
    ).not.toThrow();
  });

  it('context registration requires a callable collector', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(
        registrations({
          contexts: [
            { id: 'context', version: 1, collect: undefined } as never,
          ],
        }),
      ),
    ).toThrow();
  });

  it('defaults attempts to two and accepts a profile-configured limit', () => {
    const defaultRegistry = new RunRegistry();
    expect(() => defaultRegistry.register(registrations())).not.toThrow();

    const configuredRegistry = new RunRegistry();
    expect(() =>
      configuredRegistry.register(
        registrations({
          profiles: [{ ...profile, maxAttemptsPerStep: 3 }],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects invalid configured attempt limits', () => {
    for (const maxAttemptsPerStep of [0, 1.5]) {
      const registry = new RunRegistry();
      expect(() =>
        registry.register(
          registrations({
            profiles: [{ ...profile, maxAttemptsPerStep }],
          }),
        ),
      ).toThrow();
    }
  });

  it('external mode requires its declared callback', () => {
    const registry = new RunRegistry();
    expect(() =>
      registry.register(
        registrations({
          tools: [
            {
              ...transactionalWriteTool,
              idempotency: { mode: 'idempotency-key' },
            } as never,
          ],
        }),
      ),
    ).toThrow();
  });

  it('empty production registry', () => {
    expect(PRODUCTION_ENGINE_REGISTRATIONS).toEqual({
      profiles: [],
      contexts: [],
      tools: [],
    });
  });
});
