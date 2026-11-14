import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const backendRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const entrypoint = resolve(backendRoot, 'dist/entrypoints/ai-smoke/main.js');
const fetchMock = resolve(backendRoot, 'test/process/mock-ai-smoke-fetch.mjs');
const tracePrefix = 'AI_SMOKE_MOCK_TRACE ';
const syntheticEnv = {
  OPENROUTER_API_KEY: 'synthetic-cli-test-key',
  LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: new Date().toISOString().slice(0, 10),
};

interface MockTrace {
  readonly requestCount: number;
  readonly effort: string;
  readonly maxOutputTokens: number | 'unavailable';
  readonly openRouterChatCompletions: boolean;
  readonly azureOnly: boolean;
  readonly noFallbacks: boolean;
  readonly zdrOnly: boolean;
  readonly denyDataCollection: boolean;
  readonly hasSystemInstruction: boolean;
}

function runSmoke(args: readonly string[]) {
  return spawnSync(
    process.execPath,
    ['--import', fetchMock, entrypoint, ...args],
    {
      cwd: backendRoot,
      env: syntheticEnv,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

function readMockTrace(stderr: string): MockTrace[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith(tracePrefix))
    .map((line) => JSON.parse(line.slice(tracePrefix.length)) as MockTrace);
}

const validArguments = [
  '--profile',
  'chat',
  '--efforts',
  'high,max',
  '--samples',
  '2',
] as const;

it.each([
  { label: 'direct Node arguments', args: validArguments },
  { label: 'pnpm leading separator', args: ['--', ...validArguments] },
])('forwards $label through the compiled ai-smoke entrypoint', ({ args }) => {
  const child = runSmoke(args);
  const trace = readMockTrace(child.stderr);

  expect(trace).toHaveLength(4);
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(
    trace.map(({ effort, maxOutputTokens }) => ({
      effort,
      maxOutputTokens,
    })),
  ).toEqual([
    { effort: 'high', maxOutputTokens: 16384 },
    { effort: 'high', maxOutputTokens: 16384 },
    { effort: 'max', maxOutputTokens: 32768 },
    { effort: 'max', maxOutputTokens: 32768 },
  ]);
  expect(
    trace.every(
      (item) =>
        item.openRouterChatCompletions &&
        item.azureOnly &&
        item.noFallbacks &&
        item.zdrOnly &&
        item.denyDataCollection &&
        item.hasSystemInstruction,
    ),
  ).toBe(true);

  expect(child.stdout).toMatch(/^\s*\{/);
  const report = JSON.parse(child.stdout) as {
    version: number;
    maximumAllocationUsd: string;
    requestLimit: number;
  };
  expect(report).toMatchObject({
    version: 1,
    maximumAllocationUsd: '0.10',
    requestLimit: 4,
  });
  expect(child.stdout).not.toContain('synthetic-cli-test-key');
  expect(child.stdout).not.toContain('private-cli-generation-id');
  expect(child.stdout).not.toContain('PRIVATE_CLI_ANSWER_CANARY');
});

it('refuses invalid arguments before any mocked provider fetch', () => {
  const child = runSmoke([
    '--profile',
    'chat',
    '--efforts',
    'invalid-effort-canary',
    '--samples',
    '2',
  ]);
  const trace = readMockTrace(child.stderr);

  expect(trace).toHaveLength(0);
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(1);
  expect(child.stdout).toBe('AI smoke arguments are invalid.\n');
  expect(child.stdout).not.toContain('synthetic-cli-test-key');
  expect(child.stdout).not.toContain('invalid-effort-canary');
});

it('preserves the no-argument legacy smoke control', () => {
  const child = runSmoke([]);
  const trace = readMockTrace(child.stderr);

  expect(trace).toHaveLength(1);
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(0);
  expect(child.stdout).not.toContain('synthetic-cli-test-key');
  expect(child.stdout).not.toContain('PRIVATE_CLI_ANSWER_CANARY');
});
