import { expect, it, vi } from 'vitest';
import {
  createEvaluationContext,
  prepareEvaluationInfrastructure,
  type EvaluationServices,
} from '../../src/evaluation/index.js';
import {
  acquireTestInfrastructure,
  createSeaweedS3Config,
} from '../../src/infrastructure/db/testing/test-infrastructure.js';
import { PRODUCTION_ENGINE_REGISTRATIONS } from '../../src/modules/chat/run-registry.js';

it('keeps production engine registries free of product fixtures', () => {
  expect(PRODUCTION_ENGINE_REGISTRATIONS).toEqual({
    profiles: [],
    contexts: [],
    tools: [],
  });
});

it('uses SeaweedFS accessKey credential syntax for generated S3 identities', () => {
  expect(
    JSON.parse(createSeaweedS3Config('fixture-key', 'fixture-secret')),
  ).toEqual({
    identities: [
      {
        name: 'test',
        credentials: [
          { accessKey: 'fixture-key', secretKey: 'fixture-secret' },
        ],
        actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
      },
    ],
  });
});

it('shares one infrastructure acquisition until both project leases release', async () => {
  let acquisitions = 0;
  let releases = 0;
  const factory = async () => {
    acquisitions += 1;
    return {
      descriptor: {
        postgresUrl: 'postgresql://fixture.invalid/db',
        valkeyUrl: 'redis://fixture.invalid/0',
        seaweedS3Url: 'http://fixture.invalid',
      } satisfies EvaluationServices,
      release: async () => {
        releases += 1;
      },
    };
  };
  const first = await prepareEvaluationInfrastructure({ acquire: factory });
  const second = await prepareEvaluationInfrastructure({ acquire: factory });
  expect(acquisitions).toBe(1);
  await first.release();
  expect(releases).toBe(0);
  await second.release();
  expect(releases).toBe(1);
});

it('shares infrastructure state across separately loaded module graphs', async () => {
  let acquisitions = 0;
  let releases = 0;
  const factory = async () => {
    acquisitions += 1;
    return {
      descriptor: {
        postgresUrl: 'postgresql://fixture.invalid/db',
        valkeyUrl: 'redis://fixture.invalid/0',
        seaweedS3Url: 'http://fixture.invalid',
      },
      release: async () => {
        releases += 1;
      },
    };
  };
  const first = await acquireTestInfrastructure(factory);
  vi.resetModules();
  const secondModule =
    await import('../../src/infrastructure/db/testing/test-infrastructure.js');
  const second = await secondModule.acquireTestInfrastructure(factory);
  expect(acquisitions).toBe(1);
  await first.release();
  expect(releases).toBe(0);
  await second.release();
  expect(releases).toBe(1);
});

it('does not expose fixture setup messages, stacks, or causes at the public entry', async () => {
  const canaries =
    'bare-secret-canary Authorization: Bearer header-secret-canary server-detail-canary';
  vi.doMock('../../src/evaluation/evaluation-harness.js', () => ({
    createEvaluationHarness: async () => {
      throw new Error(canaries);
    },
  }));
  try {
    let caught: unknown;
    try {
      await createEvaluationContext({
        services: {
          postgresUrl: 'postgresql://fixture.invalid/db',
          valkeyUrl: 'redis://fixture.invalid/0',
          seaweedS3Url: 'http://fixture.invalid',
        },
        fixtureSet: 'deterministic',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error & { cause?: unknown };
    expect(error.message).toBe('Deterministic evaluation setup failed');
    expect(error.stack).toBeUndefined();
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(canaries);
  } finally {
    vi.doUnmock('../../src/evaluation/evaluation-harness.js');
    vi.resetModules();
  }
});
