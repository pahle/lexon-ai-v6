import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readContainerImages } from './container-images.mjs';

const INVALID_EVIDENCE = 'Chat load evidence is incomplete or invalid';

// The only error whose message reaches the job log: the bound name plus
// count-style constants, never an observed value.
export class ChatLoadEvidenceError extends Error {
  constructor(bound) {
    super(`${INVALID_EVIDENCE}: ${bound}`);
    this.name = 'ChatLoadEvidenceError';
  }
}
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

function invalid(bound) {
  throw new ChatLoadEvidenceError(bound);
}

function record(value, keys, bound) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid(`${bound} object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    invalid(`${bound} fields ${actual.length}!=${expected.length}`);
  return value;
}

function finite(value, minimum = 0, bound) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
    invalid(bound);
  return value;
}

function integer(value, minimum = 0, bound) {
  finite(value, minimum, bound);
  if (!Number.isSafeInteger(value)) invalid(bound);
  return value;
}

function equal(value, expected, bound) {
  if (value !== expected)
    invalid(`${bound} expected ${JSON.stringify(expected)}`);
}

function valkeyPurposeCounts(value, bound) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid(`${bound} object`);
  const purposes = Object.keys(value);
  if (
    CORE_VALKEY_PURPOSES.some((purpose) => !purposes.includes(purpose)) ||
    purposes.some(
      (purpose) =>
        !CORE_VALKEY_PURPOSES.includes(purpose) &&
        !OPTIONAL_VALKEY_PURPOSES.includes(purpose),
    )
  )
    invalid(`${bound} purposes`);
  for (const purpose of purposes)
    integer(value[purpose], 0, `${bound}.${purpose}`);
  return value;
}

function compareValkeyPurposeCounts(
  value,
  baseline,
  activeReaderCount = baseline.reader,
  bound,
) {
  valkeyPurposeCounts(value, bound);
  const baselinePurposes = Object.keys(baseline).sort();
  const purposes = Object.keys(value).sort();
  if (
    purposes.length !== baselinePurposes.length ||
    purposes.some((purpose, index) => purpose !== baselinePurposes[index])
  )
    invalid(`${bound} purposes`);
  for (const purpose of purposes) {
    if (purpose === 'reader') {
      equal(value.reader, activeReaderCount, `${bound}.reader`);
    } else if (purpose === 'health') {
      if (value.health > baseline.health) invalid(`${bound}.health`);
    } else equal(value[purpose], baseline[purpose], `${bound}.${purpose}`);
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
  record(
    observations,
    [
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
    ],
    'observations',
  );

  const provenance = record(
    observations.provenance,
    [
      'sourceHead',
      'sourceDirty',
      'runnerImage',
      'apiPid',
      'loadToolPid',
      'images',
    ],
    'provenance',
  );
  if (
    typeof provenance.sourceHead !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(provenance.sourceHead)
  )
    invalid('provenance.sourceHead');
  if (typeof provenance.sourceDirty !== 'boolean')
    invalid('provenance.sourceDirty');
  if (
    typeof provenance.runnerImage !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/u.test(provenance.runnerImage)
  )
    invalid('provenance.runnerImage');
  integer(provenance.apiPid, 1, 'provenance.apiPid');
  integer(provenance.loadToolPid, 1, 'provenance.loadToolPid');
  if (provenance.apiPid === provenance.loadToolPid)
    invalid('provenance.apiPid!=loadToolPid');
  const images = record(
    provenance.images,
    ['api', 'caddy', 'valkey', 'k6'],
    'provenance.images',
  );
  for (const [name, image] of Object.entries(images)) {
    if (
      typeof image !== 'string' ||
      !/^[a-z0-9./_-]+:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$/u.test(image)
    )
      invalid(`provenance.images.${name}`);
  }
  equal(images.k6, K6_IMAGE, 'provenance.images.k6');

  const config = record(
    observations.config,
    [
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
    ],
    'config',
  );
  equal(config.perUserSseLimit, 256, 'config.perUserSseLimit');
  equal(config.owners, 2, 'config.owners');
  equal(config.separateOrganizations, 2, 'config.separateOrganizations');
  equal(config.subscribersPerOwner, 250, 'config.subscribersPerOwner');
  equal(config.activeMockRuns, 2, 'config.activeMockRuns');
  equal(config.apiMemoryLimitMiB, 1536, 'config.apiMemoryLimitMiB');
  equal(config.apiCpuLimit, 1, 'config.apiCpuLimit');
  equal(config.loadToolMemoryLimitMiB, 2048, 'config.loadToolMemoryLimitMiB');
  equal(config.loadToolCpuLimit, 2, 'config.loadToolCpuLimit');
  equal(config.testTimeoutSeconds, 180, 'config.testTimeoutSeconds');
  const runCaps = record(
    config.runCaps,
    ['global', 'perOrganization'],
    'config.runCaps',
  );
  equal(runCaps.global, 24, 'config.runCaps.global');
  equal(runCaps.perOrganization, 6, 'config.runCaps.perOrganization');

  const defaultSixQualification = record(
    observations.defaultSixQualification,
    ['perUserLimit', 'seventhConnectionEvictedOldest'],
    'defaultSixQualification',
  );
  equal(
    defaultSixQualification.perUserLimit,
    6,
    'defaultSixQualification.perUserLimit',
  );
  equal(
    defaultSixQualification.seventhConnectionEvictedOldest,
    true,
    'defaultSixQualification.seventhConnectionEvictedOldest',
  );

  const warmBaseline = record(
    observations.warmBaseline,
    [
      'apiPid',
      'activeSubscriptions',
      'activeLeases',
      'readerSubscriptions',
      'readerConnections',
      'valkeyClientsByPurpose',
    ],
    'warmBaseline',
  );
  equal(warmBaseline.apiPid, provenance.apiPid, 'warmBaseline.apiPid');
  equal(
    warmBaseline.activeSubscriptions,
    0,
    'warmBaseline.activeSubscriptions',
  );
  equal(warmBaseline.activeLeases, 0, 'warmBaseline.activeLeases');
  equal(
    warmBaseline.readerSubscriptions,
    0,
    'warmBaseline.readerSubscriptions',
  );
  equal(warmBaseline.readerConnections, 1, 'warmBaseline.readerConnections');
  const warmValkeyCounts = valkeyPurposeCounts(
    warmBaseline.valkeyClientsByPurpose,
    'warmBaseline.valkeyClientsByPurpose',
  );
  equal(
    warmValkeyCounts.reader,
    1,
    'warmBaseline.valkeyClientsByPurpose.reader',
  );

  const oneSubscriberBaseline = record(
    observations.oneSubscriberBaseline,
    ['apiPid', 'readerConnections'],
    'oneSubscriberBaseline',
  );
  equal(
    oneSubscriberBaseline.apiPid,
    provenance.apiPid,
    'oneSubscriberBaseline.apiPid',
  );
  equal(
    oneSubscriberBaseline.readerConnections,
    2,
    'oneSubscriberBaseline.readerConnections',
  );

  if (!Array.isArray(observations.plateauSamples)) invalid('plateauSamples');
  const plateauSamples = observations.plateauSamples;
  if (plateauSamples.length < 7) invalid('plateauSamples.length>=7');
  let previousElapsedMs = -1;
  for (const [index, sampleValue] of plateauSamples.entries()) {
    const bound = `plateauSamples[${index}]`;
    const sample = record(
      sampleValue,
      [
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
      ],
      bound,
    );
    const elapsedMs = integer(sample.elapsedMs, 0, `${bound}.elapsedMs`);
    if (
      elapsedMs <= previousElapsedMs ||
      (previousElapsedMs >= 0 && elapsedMs - previousElapsedMs > 5000)
    )
      invalid(`${bound}.elapsedMs monotonic<=5000`);
    previousElapsedMs = elapsedMs;
    if (
      integer(sample.activeSubscriptions, 0, `${bound}.activeSubscriptions`) <
      500
    )
      invalid(`${bound}.activeSubscriptions>=500`);
    if (integer(sample.activeLeases, 0, `${bound}.activeLeases`) < 500)
      invalid(`${bound}.activeLeases>=500`);
    if (
      integer(sample.readerSubscriptions, 0, `${bound}.readerSubscriptions`) <
      500
    )
      invalid(`${bound}.readerSubscriptions>=500`);
    equal(
      sample.readerConnections,
      oneSubscriberBaseline.readerConnections,
      `${bound}.readerConnections`,
    );
    equal(sample.apiPid, provenance.apiPid, `${bound}.apiPid`);
    if (
      integer(sample.apiMemoryBytes, 1, `${bound}.apiMemoryBytes`) >=
      API_MEMORY_LIMIT_BYTES
    )
      invalid(`${bound}.apiMemoryBytes`);
    integer(sample.apiCpuMicros, 0, `${bound}.apiCpuMicros`);
    equal(sample.loadToolPid, provenance.loadToolPid, `${bound}.loadToolPid`);
    if (
      integer(sample.loadToolMemoryBytes, 1, `${bound}.loadToolMemoryBytes`) >
      LOAD_TOOL_MEMORY_LIMIT_BYTES
    )
      invalid(`${bound}.loadToolMemoryBytes`);
    integer(sample.loadToolCpuMicros, 0, `${bound}.loadToolCpuMicros`);
    compareValkeyPurposeCounts(
      sample.valkeyClientsByPurpose,
      warmValkeyCounts,
      oneSubscriberBaseline.readerConnections,
      `${bound}.valkeyClientsByPurpose`,
    );
  }
  const plateauDurationMs =
    plateauSamples.at(-1).elapsedMs - plateauSamples[0].elapsedMs;
  if (plateauDurationMs < 30_000) invalid('plateauDurationMs>=30000');

  const k6 = record(
    observations.k6,
    [
      'vus',
      'requestsStarted',
      'requestsCompleted',
      'http200',
      'errors',
      'minRequestDurationMs',
      'maxRequestsPerVu',
      'reconnects',
    ],
    'k6',
  );
  equal(k6.vus, 500, 'k6.vus');
  equal(k6.requestsStarted, 500, 'k6.requestsStarted');
  equal(k6.requestsCompleted, 500, 'k6.requestsCompleted');
  equal(k6.http200, 500, 'k6.http200');
  equal(k6.errors, 0, 'k6.errors');
  if (finite(k6.minRequestDurationMs, 0, 'k6.minRequestDurationMs') < 30_000)
    invalid('k6.minRequestDurationMs>=30000');
  equal(k6.maxRequestsPerVu, 1, 'k6.maxRequestsPerVu');
  equal(k6.reconnects, 0, 'k6.reconnects');

  const worker = record(
    observations.worker,
    ['activeRuns', 'sequenceBefore', 'sequenceAfter'],
    'worker',
  );
  equal(worker.activeRuns, 2, 'worker.activeRuns');
  if (
    !Array.isArray(worker.sequenceBefore) ||
    !Array.isArray(worker.sequenceAfter) ||
    worker.sequenceBefore.length !== 2 ||
    worker.sequenceAfter.length !== 2
  )
    invalid('worker.sequences length=2');
  for (let index = 0; index < 2; index += 1) {
    integer(worker.sequenceBefore[index], 0, `worker.sequenceBefore[${index}]`);
    integer(worker.sequenceAfter[index], 0, `worker.sequenceAfter[${index}]`);
    if (worker.sequenceAfter[index] <= worker.sequenceBefore[index])
      invalid(`worker.sequenceAfter[${index}]>before`);
  }
  const progressedRuns = worker.sequenceAfter.filter(
    (sequence, index) => sequence > worker.sequenceBefore[index],
  ).length;

  const teardown = record(
    observations.teardown,
    [
      'apiPid',
      'activeSubscriptions',
      'activeLeases',
      'readerSubscriptions',
      'readerConnections',
      'valkeyClientsByPurpose',
    ],
    'teardown',
  );
  equal(teardown.apiPid, warmBaseline.apiPid, 'teardown.apiPid');
  equal(
    teardown.activeSubscriptions,
    warmBaseline.activeSubscriptions,
    'teardown.activeSubscriptions',
  );
  equal(
    teardown.activeLeases,
    warmBaseline.activeLeases,
    'teardown.activeLeases',
  );
  equal(
    teardown.readerSubscriptions,
    warmBaseline.readerSubscriptions,
    'teardown.readerSubscriptions',
  );
  equal(
    teardown.readerConnections,
    warmBaseline.readerConnections,
    'teardown.readerConnections',
  );
  compareValkeyPurposeCounts(
    teardown.valkeyClientsByPurpose,
    warmValkeyCounts,
    undefined,
    'teardown.valkeyClientsByPurpose',
  );

  const latency = record(
    observations.latency,
    ['measurement', 'coldSamplesMs', 'warmSamplesMs'],
    'latency',
  );
  equal(latency.measurement, 'mock-send-to-first-frame', 'latency.measurement');
  if (
    !Array.isArray(latency.coldSamplesMs) ||
    latency.coldSamplesMs.length === 0 ||
    !Array.isArray(latency.warmSamplesMs) ||
    latency.warmSamplesMs.length === 0
  )
    invalid('latency samples non-empty');
  for (const sample of [...latency.coldSamplesMs, ...latency.warmSamplesMs])
    finite(sample, 0, 'latency.sample');
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
  return validateAndBuild(observations);
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
  'F4.2-burst.json',
  'diagnostic.json',
  'failure.json',
  'child-output-tail.log',
];
const OUTPUT_TAIL_LINES = 200;
const OUTPUT_TAIL_MAX_BYTES = 256 * 1024;
const SECRET_NAME = /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|URL|DSN)/iu;

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

export function redactSecrets(text, env) {
  let result = text;
  const values = Object.entries(env)
    .filter(
      ([name, value]) =>
        SECRET_NAME.test(name) &&
        typeof value === 'string' &&
        value.length >= 6,
    )
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
  for (const value of values) result = result.split(value).join('[redacted]');
  return result;
}

export function boundedTail(text, lines = OUTPUT_TAIL_LINES) {
  const tail = text.split(/\r?\n/u).slice(-lines).join('\n');
  return tail.length > OUTPUT_TAIL_MAX_BYTES
    ? tail.slice(-OUTPUT_TAIL_MAX_BYTES)
    : tail;
}

let lastOutput = '';

async function reportChildOutput(env) {
  const tail = redactSecrets(boundedTail(lastOutput), env).trim();
  if (!tail) return;
  process.stderr.write(
    `--- last ${OUTPUT_TAIL_LINES} lines of child output ---\n${tail}\n--- end child output ---\n`,
  );
  await writeFile(
    join(EVIDENCE_DIRECTORY, 'child-output-tail.log'),
    `${tail}\n`,
    { mode: 0o600 },
  ).catch(() => undefined);
}

function runPnpm(args, env) {
  lastOutput = '';
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
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const collect = (chunk) => {
        lastOutput = (lastOutput + chunk.toString('utf8')).slice(
          -OUTPUT_TAIL_MAX_BYTES * 4,
        );
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
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
      await reportChildOutput(qualificationEnvironment);
      process.stderr.write(`${COMMAND_FAILURE}\n`);
      process.exitCode = 1;
      return;
    }
    if (!(await runPnpm(QUALIFICATION_ARGS, qualificationEnvironment))) {
      await recordFailure(phase);
      await reportChildOutput(qualificationEnvironment);
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
      await reportChildOutput(e2eEnvironment);
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
