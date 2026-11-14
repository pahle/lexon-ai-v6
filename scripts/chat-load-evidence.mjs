import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readContainerImages } from './container-images.mjs';

const INVALID_EVIDENCE = 'Chat load evidence is incomplete or invalid.';
const K6_IMAGE = readContainerImages(
  fileURLToPath(new URL('../config/container-images.env', import.meta.url)),
).k6;
const API_MEMORY_LIMIT_BYTES = 1536 * 1024 * 1024;
const LOAD_TOOL_MEMORY_LIMIT_BYTES = 2048 * 1024 * 1024;
const CORE_VALKEY_PURPOSES = ['reader', 'limiter', 'control'];
const OPTIONAL_VALKEY_PURPOSES = [
  'queue',
  'auth',
  'notifications',
  'other',
  'health',
];

function invalid() {
  throw new Error(INVALID_EVIDENCE);
}

function record(value, keys) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    invalid();
  return value;
}

function finite(value, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
    invalid();
  return value;
}

function integer(value, minimum = 0) {
  finite(value, minimum);
  if (!Number.isSafeInteger(value)) invalid();
  return value;
}

function equal(value, expected) {
  if (value !== expected) invalid();
}

function valkeyPurposeCounts(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  const purposes = Object.keys(value);
  if (
    CORE_VALKEY_PURPOSES.some((purpose) => !purposes.includes(purpose)) ||
    purposes.some(
      (purpose) =>
        !CORE_VALKEY_PURPOSES.includes(purpose) &&
        !OPTIONAL_VALKEY_PURPOSES.includes(purpose),
    )
  )
    invalid();
  for (const purpose of purposes) integer(value[purpose]);
  return value;
}

function compareValkeyPurposeCounts(
  value,
  baseline,
  activeReaderCount = baseline.reader,
) {
  valkeyPurposeCounts(value);
  const baselinePurposes = Object.keys(baseline).sort();
  const purposes = Object.keys(value).sort();
  if (
    purposes.length !== baselinePurposes.length ||
    purposes.some((purpose, index) => purpose !== baselinePurposes[index])
  )
    invalid();
  for (const purpose of purposes) {
    if (purpose === 'reader') {
      equal(value.reader, activeReaderCount);
    } else if (purpose === 'health') {
      if (value.health > baseline.health) invalid();
    } else equal(value[purpose], baseline[purpose]);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}

function validateAndBuild(observations) {
  record(observations, [
    'provenance',
    'config',
    'defaultSixQualification',
    'warmBaseline',
    'oneSubscriberBaseline',
    'plateauSamples',
    'k6',
    'worker',
    'teardown',
    'latency',
  ]);

  const provenance = record(observations.provenance, [
    'sourceHead',
    'sourceDirty',
    'runnerImage',
    'apiPid',
    'loadToolPid',
    'images',
  ]);
  if (
    typeof provenance.sourceHead !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(provenance.sourceHead)
  )
    invalid();
  if (typeof provenance.sourceDirty !== 'boolean') invalid();
  if (
    typeof provenance.runnerImage !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/u.test(provenance.runnerImage)
  )
    invalid();
  integer(provenance.apiPid, 1);
  integer(provenance.loadToolPid, 1);
  if (provenance.apiPid === provenance.loadToolPid) invalid();
  const images = record(provenance.images, ['api', 'caddy', 'valkey', 'k6']);
  for (const image of Object.values(images)) {
    if (
      typeof image !== 'string' ||
      !/^[a-z0-9./_-]+:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$/u.test(image)
    )
      invalid();
  }
  equal(images.k6, K6_IMAGE);

  const config = record(observations.config, [
    'perUserSseLimit',
    'owners',
    'separateOrganizations',
    'subscribersPerOwner',
    'activeMockRuns',
    'apiMemoryLimitMiB',
    'apiCpuLimit',
    'loadToolMemoryLimitMiB',
    'loadToolCpuLimit',
    'testTimeoutSeconds',
    'runCaps',
  ]);
  equal(config.perUserSseLimit, 256);
  equal(config.owners, 2);
  equal(config.separateOrganizations, 2);
  equal(config.subscribersPerOwner, 250);
  equal(config.activeMockRuns, 2);
  equal(config.apiMemoryLimitMiB, 1536);
  equal(config.apiCpuLimit, 1);
  equal(config.loadToolMemoryLimitMiB, 2048);
  equal(config.loadToolCpuLimit, 2);
  equal(config.testTimeoutSeconds, 180);
  const runCaps = record(config.runCaps, ['global', 'perOrganization']);
  equal(runCaps.global, 24);
  equal(runCaps.perOrganization, 6);

  const defaultSixQualification = record(observations.defaultSixQualification, [
    'perUserLimit',
    'seventhConnectionEvictedOldest',
  ]);
  equal(defaultSixQualification.perUserLimit, 6);
  equal(defaultSixQualification.seventhConnectionEvictedOldest, true);

  const warmBaseline = record(observations.warmBaseline, [
    'apiPid',
    'activeSubscriptions',
    'activeLeases',
    'readerSubscriptions',
    'readerConnections',
    'valkeyClientsByPurpose',
  ]);
  equal(warmBaseline.apiPid, provenance.apiPid);
  equal(warmBaseline.activeSubscriptions, 0);
  equal(warmBaseline.activeLeases, 0);
  equal(warmBaseline.readerSubscriptions, 0);
  equal(warmBaseline.readerConnections, 1);
  const warmValkeyCounts = valkeyPurposeCounts(
    warmBaseline.valkeyClientsByPurpose,
  );
  equal(warmValkeyCounts.reader, 1);

  const oneSubscriberBaseline = record(observations.oneSubscriberBaseline, [
    'apiPid',
    'readerConnections',
  ]);
  equal(oneSubscriberBaseline.apiPid, provenance.apiPid);
  equal(oneSubscriberBaseline.readerConnections, 2);

  if (!Array.isArray(observations.plateauSamples)) invalid();
  const plateauSamples = observations.plateauSamples;
  if (plateauSamples.length < 7) invalid();
  let previousElapsedMs = -1;
  for (const sampleValue of plateauSamples) {
    const sample = record(sampleValue, [
      'elapsedMs',
      'activeSubscriptions',
      'activeLeases',
      'readerSubscriptions',
      'readerConnections',
      'apiPid',
      'apiMemoryBytes',
      'apiCpuMicros',
      'loadToolPid',
      'loadToolMemoryBytes',
      'loadToolCpuMicros',
      'valkeyClientsByPurpose',
    ]);
    const elapsedMs = integer(sample.elapsedMs);
    if (
      elapsedMs <= previousElapsedMs ||
      (previousElapsedMs >= 0 && elapsedMs - previousElapsedMs > 5000)
    )
      invalid();
    previousElapsedMs = elapsedMs;
    if (integer(sample.activeSubscriptions) < 500) invalid();
    if (integer(sample.activeLeases) < 500) invalid();
    if (integer(sample.readerSubscriptions) < 500) invalid();
    equal(sample.readerConnections, oneSubscriberBaseline.readerConnections);
    equal(sample.apiPid, provenance.apiPid);
    if (integer(sample.apiMemoryBytes, 1) >= API_MEMORY_LIMIT_BYTES) invalid();
    integer(sample.apiCpuMicros);
    equal(sample.loadToolPid, provenance.loadToolPid);
    if (integer(sample.loadToolMemoryBytes, 1) > LOAD_TOOL_MEMORY_LIMIT_BYTES)
      invalid();
    integer(sample.loadToolCpuMicros);
    compareValkeyPurposeCounts(
      sample.valkeyClientsByPurpose,
      warmValkeyCounts,
      oneSubscriberBaseline.readerConnections,
    );
  }
  const plateauDurationMs =
    plateauSamples.at(-1).elapsedMs - plateauSamples[0].elapsedMs;
  if (plateauDurationMs < 30_000) invalid();

  const k6 = record(observations.k6, [
    'vus',
    'requestsStarted',
    'requestsCompleted',
    'http200',
    'errors',
    'minRequestDurationMs',
    'maxRequestsPerVu',
    'reconnects',
  ]);
  equal(k6.vus, 500);
  equal(k6.requestsStarted, 500);
  equal(k6.requestsCompleted, 500);
  equal(k6.http200, 500);
  equal(k6.errors, 0);
  if (finite(k6.minRequestDurationMs) < 30_000) invalid();
  equal(k6.maxRequestsPerVu, 1);
  equal(k6.reconnects, 0);

  const worker = record(observations.worker, [
    'activeRuns',
    'sequenceBefore',
    'sequenceAfter',
  ]);
  equal(worker.activeRuns, 2);
  if (
    !Array.isArray(worker.sequenceBefore) ||
    !Array.isArray(worker.sequenceAfter) ||
    worker.sequenceBefore.length !== 2 ||
    worker.sequenceAfter.length !== 2
  )
    invalid();
  for (let index = 0; index < 2; index += 1) {
    integer(worker.sequenceBefore[index]);
    integer(worker.sequenceAfter[index]);
    if (worker.sequenceAfter[index] <= worker.sequenceBefore[index]) invalid();
  }
  const progressedRuns = worker.sequenceAfter.filter(
    (sequence, index) => sequence > worker.sequenceBefore[index],
  ).length;

  const teardown = record(observations.teardown, [
    'apiPid',
    'activeSubscriptions',
    'activeLeases',
    'readerSubscriptions',
    'readerConnections',
    'valkeyClientsByPurpose',
  ]);
  equal(teardown.apiPid, warmBaseline.apiPid);
  equal(teardown.activeSubscriptions, warmBaseline.activeSubscriptions);
  equal(teardown.activeLeases, warmBaseline.activeLeases);
  equal(teardown.readerSubscriptions, warmBaseline.readerSubscriptions);
  equal(teardown.readerConnections, warmBaseline.readerConnections);
  compareValkeyPurposeCounts(teardown.valkeyClientsByPurpose, warmValkeyCounts);

  const latency = record(observations.latency, [
    'measurement',
    'coldSamplesMs',
    'warmSamplesMs',
  ]);
  equal(latency.measurement, 'mock-send-to-first-frame');
  if (
    !Array.isArray(latency.coldSamplesMs) ||
    latency.coldSamplesMs.length === 0 ||
    !Array.isArray(latency.warmSamplesMs) ||
    latency.warmSamplesMs.length === 0
  )
    invalid();
  for (const sample of [...latency.coldSamplesMs, ...latency.warmSamplesMs])
    finite(sample);
  const latencySamples = [...latency.coldSamplesMs, ...latency.warmSamplesMs];
  const outputLatency = {
    measurement: latency.measurement,
    coldSamplesMs: [...latency.coldSamplesMs],
    warmSamplesMs: [...latency.warmSamplesMs],
    coldMs: median(latency.coldSamplesMs),
    medianMs: median(latencySamples),
    p95Ms: percentile(latencySamples, 0.95),
    maxMs: Math.max(...latencySamples),
  };

  return {
    passed: true,
    provenance: {
      sourceHead: provenance.sourceHead,
      sourceDirty: provenance.sourceDirty,
      runnerImage: provenance.runnerImage,
      apiPid: provenance.apiPid,
      loadToolPid: provenance.loadToolPid,
      images: { ...images },
    },
    config: {
      ...config,
      runCaps: { ...runCaps },
    },
    defaultSixQualification: { ...defaultSixQualification },
    warmBaseline: {
      ...warmBaseline,
      valkeyClientsByPurpose: { ...warmValkeyCounts },
    },
    oneSubscriberBaseline: { ...oneSubscriberBaseline },
    plateauDurationMs,
    plateauSamples: plateauSamples.map((sample) => ({
      ...sample,
      valkeyClientsByPurpose: { ...sample.valkeyClientsByPurpose },
    })),
    k6: { ...k6 },
    worker: {
      activeRuns: worker.activeRuns,
      sequenceBefore: [...worker.sequenceBefore],
      sequenceAfter: [...worker.sequenceAfter],
      progressedRuns,
    },
    teardown: {
      ...teardown,
      valkeyClientsByPurpose: { ...teardown.valkeyClientsByPurpose },
    },
    latency: outputLatency,
  };
}

export function collectChatLoadEvidence(observations) {
  try {
    return validateAndBuild(observations);
  } catch {
    throw new Error(INVALID_EVIDENCE);
  }
}

const QUALIFICATION_ARGS = [
  'exec',
  'vitest',
  'run',
  '--project',
  'backend-integration',
  'backend/test/integration/chat-sse.spec.ts',
  '-t',
  'the seventh live SSE connection evicts only the oldest socket',
];
const LOAD_E2E_ARGS = ['test:e2e', '--project', 'chat-sse-load'];
const COMMAND_FAILURE = 'Chat SSE load command failed.';
const EVIDENCE_DIRECTORY = resolve(
  process.env.LEXON_CHAT_LOAD_EVIDENCE_DIR || 'test-results/f4-chat-load',
);
const OWNED_OUTPUTS = [
  'F4-sse-load.json',
  'F4-stream-latency.json',
  'diagnostic.json',
  'failure.json',
];

async function resetEvidenceDirectory() {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true, mode: 0o700 });
  await Promise.all(
    OWNED_OUTPUTS.map((name) =>
      rm(join(EVIDENCE_DIRECTORY, name), { force: true }),
    ),
  );
}

async function recordFailure(phase) {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true, mode: 0o700 });
  await Promise.all(
    OWNED_OUTPUTS.slice(0, 2).map((name) =>
      rm(join(EVIDENCE_DIRECTORY, name), { force: true }),
    ),
  );
  await writeFile(
    join(EVIDENCE_DIRECTORY, 'failure.json'),
    `${JSON.stringify({ phase, status: 'failed' })}\n`,
    { mode: 0o600 },
  );
}

function runPnpm(args, env) {
  return new Promise((resolveResult) => {
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      resolveResult(success);
    };
    try {
      const child = spawn('pnpm', args, {
        env,
        shell: false,
        stdio: 'ignore',
      });
      child.once('error', () => finish(false));
      child.once('exit', (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}

async function runChatLoadCommand() {
  let phase = 'qualification';
  try {
    await resetEvidenceDirectory();
    const qualificationEnvironment = { ...process.env };
    delete qualificationEnvironment.LEXON_CHAT_DEFAULT_SIX_QUALIFIED;
    if (
      !(await runPnpm(
        ['exec', 'tsc', '-p', 'shared/tsconfig.build.json'],
        qualificationEnvironment,
      ))
    ) {
      await recordFailure(phase);
      process.stderr.write(`${COMMAND_FAILURE}\n`);
      process.exitCode = 1;
      return;
    }
    if (!(await runPnpm(QUALIFICATION_ARGS, qualificationEnvironment))) {
      await recordFailure(phase);
      process.stderr.write(`${COMMAND_FAILURE}\n`);
      process.exitCode = 1;
      return;
    }
    phase = 'e2e';
    const e2eEnvironment = {
      ...process.env,
      LEXON_CHAT_LOAD: '1',
      LEXON_CHAT_DEFAULT_SIX_QUALIFIED: '1',
      COMPOSE_DISABLE_ENV_FILE: 'true',
      LEXON_CHAT_LOAD_EVIDENCE_DIR: EVIDENCE_DIRECTORY,
    };
    if (!(await runPnpm(LOAD_E2E_ARGS, e2eEnvironment))) {
      await recordFailure(phase);
      process.stderr.write(`${COMMAND_FAILURE}\n`);
      process.exitCode = 1;
    }
  } catch {
    await recordFailure(phase).catch(() => undefined);
    process.stderr.write(`${COMMAND_FAILURE}\n`);
    process.exitCode = 1;
  }
}

const directEntry =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directEntry) void runChatLoadCommand();
