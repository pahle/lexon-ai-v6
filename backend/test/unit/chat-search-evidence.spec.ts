import { expect, test } from 'vitest';
import {
  formatSearchClassSummary,
  isCompleteSearchRun,
  selectPostgresContainerId,
  summarizeSearchSamples,
  whitelistRuntimeEvidence,
} from '../../src/infrastructure/db/testing/chat-search-evidence.js';

test('runtime evidence retains only approved host and container resource fields', () => {
  expect(
    whitelistRuntimeEvidence({
      runner: {
        image: 'ubuntu-24.04',
        imageOS: 'ubuntu24',
        imageVersion: '20261108.1.0',
        platform: 'linux 6.11.0',
        architecture: 'x64',
        cpuModel: 'Example CPU',
        cpuCount: 4,
        totalMemoryBytes: 17_179_869_184,
        secret: 'must not escape',
      },
      docker: {
        serverVersion: '28.0.1',
        cpuCount: 4,
        memoryBytes: 17_179_869_184,
        cgroupDriver: 'systemd',
        cgroupVersion: '2',
        configEnv: ['secret=value'],
      },
      postgres: {
        image: 'postgres:17.11',
        hostConfig: {
          memoryBytes: 536_870_912,
          nanoCpus: 2_000_000_000,
          cpuQuota: 200_000,
          cpuPeriod: 100_000,
          cpuShares: 1024,
          cpusetCpus: '0-1',
          pidsLimit: 256,
          env: ['secret=value'],
        },
        cgroups: {
          cpuMax: '200000 100000',
          memoryMaxBytes: 536_870_912,
          cpusetCpusEffective: '0-1',
          pidsMax: 256,
          environment: 'secret=value',
        },
        containerEnv: ['POSTGRES_PASSWORD=secret'],
      },
    }),
  ).toEqual({
    runner: {
      image: 'ubuntu-24.04',
      imageOS: 'ubuntu24',
      imageVersion: '20261108.1.0',
      platform: 'linux 6.11.0',
      architecture: 'x64',
      cpuModel: 'Example CPU',
      cpuCount: 4,
      totalMemoryBytes: 17_179_869_184,
    },
    docker: {
      serverVersion: '28.0.1',
      cpuCount: 4,
      memoryBytes: 17_179_869_184,
      cgroupDriver: 'systemd',
      cgroupVersion: '2',
    },
    postgres: {
      image: 'postgres:17.11',
      hostConfig: {
        memoryBytes: 536_870_912,
        nanoCpus: 2_000_000_000,
        cpuQuota: 200_000,
        cpuPeriod: 100_000,
        cpuShares: 1024,
        cpusetCpus: '0-1',
        pidsLimit: 256,
      },
      cgroups: {
        cpuMax: '200000 100000',
        memoryMaxBytes: 536_870_912,
        cpusetCpusEffective: '0-1',
        pidsMax: 256,
      },
    },
  });
});

test('class summaries include percentile, maximum, count, and status counts', () => {
  const summary = summarizeSearchSamples([
    { status: 200, elapsedMs: 12 },
    { status: 200, elapsedMs: 8 },
    { status: 503, elapsedMs: 25 },
  ]);
  expect(summary).toEqual({
    count: 3,
    p50Ms: 12,
    p95Ms: 25,
    maxMs: 25,
    statusCounts: { '200': 2, '503': 1 },
  });
  expect(formatSearchClassSummary('partial', summary)).toBe(
    'F4_SEARCH_CLASS partial count=3 status=200:2,503:1 p50Ms=12 p95Ms=25 maxMs=25',
  );
});

test('the PostgreSQL container is selected by its exact published database port', () => {
  expect(
    selectPostgresContainerId(
      [
        { id: 'unrelated', ports: '0.0.0.0:5555->5432/tcp' },
        { id: 'benchmark-db', ports: '0.0.0.0:49153->5432/tcp' },
      ],
      49153,
    ),
  ).toBe('benchmark-db');
  expect(() =>
    selectPostgresContainerId(
      [{ id: 'other-db', ports: '0.0.0.0:5432->5432/tcp' }],
      49153,
    ),
  ).toThrow('Expected exactly one PostgreSQL container for mapped port');
});

test('the overall gate is incomplete when the final sample of a class is non-200', () => {
  const successfulSamples = () =>
    Array.from({ length: 30 }, (_, index) => ({
      status: 200,
      elapsedMs: index + 1,
    }));
  const finalClass = successfulSamples();
  finalClass[29] = { status: 503, elapsedMs: 30 };
  const samples = new Map([
    ['stem', successfulSamples()],
    ['partial', successfulSamples()],
    ['article', successfulSamples()],
    ['noMatch', finalClass],
  ]);

  expect(
    isCompleteSearchRun(samples, ['stem', 'partial', 'article', 'noMatch'], 30),
  ).toBe(false);
  expect(
    isCompleteSearchRun(
      new Map([
        ['stem', successfulSamples()],
        ['partial', successfulSamples()],
        ['article', successfulSamples()],
        ['noMatch', successfulSamples()],
      ]),
      ['stem', 'partial', 'article', 'noMatch'],
      30,
    ),
  ).toBe(true);
});
