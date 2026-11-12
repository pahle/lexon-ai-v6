import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactPath = resolve(root, 'test-results/f4-search/gate.jsonl');
const sourceFiles = [
  'backend/drizzle/0035_chat_search.sql',
  'backend/drizzle/0036_chat_search_vectors.sql',
  'backend/src/infrastructure/db/chat-search.repository.ts',
  'backend/src/infrastructure/db/schema.ts',
  'backend/src/infrastructure/db/testing/chat-search-benchmark.ts',
  'backend/src/infrastructure/db/testing/chat-search-evidence.ts',
  'backend/src/infrastructure/db/testing/chat-fixture.ts',
  'backend/src/infrastructure/db/testing/provision.ts',
  'backend/src/infrastructure/db/testing/test-infrastructure.ts',
  'backend/src/modules/chat/chat-search.service.ts',
  'backend/test/integration/chat-search-performance.spec.ts',
  'backend/test/unit/chat-search-evidence.spec.ts',
  'backend/test/setup/search-benchmark-evidence.ts',
  'backend/test/setup/global-infrastructure.ts',
  'backend/test/setup/file-services.ts',
  'backend/vitest.chat-search-benchmark.config.ts',
  '.github/workflows/f4-search-benchmark.yml',
  'scripts/test/prepare-f4-search-evidence.mjs',
  'scripts/test/f4-search-isolation.spec.mjs',
];

function safeCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
  } catch (error) {
    return { errorName: error instanceof Error ? error.name : 'UnknownError' };
  }
}

function scalar(value, type) {
  if (type === 'number')
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  return typeof value === 'string' ? value : null;
}

async function hashSource(path) {
  return createHash('sha256')
    .update(await readFile(resolve(root, path)))
    .digest('hex');
}

await mkdir(dirname(artifactPath), { recursive: true });
const hashResults = await Promise.all(
  sourceFiles.map(async (path) => {
    try {
      return [path, await hashSource(path), null];
    } catch (error) {
      return [path, null, error instanceof Error ? error.name : 'UnknownError'];
    }
  }),
);
const sourceHashes = Object.fromEntries(
  hashResults.map(([path, hash]) => [path, hash]),
);
const sourceHashErrorNames = Object.fromEntries(
  hashResults
    .filter(([, , errorName]) => errorName !== null)
    .map(([path, , errorName]) => [path, errorName]),
);
const headResult = safeCommand('git', ['rev-parse', 'HEAD']);
const dockerResult = safeCommand('docker', ['info', '--format', '{{json .}}']);
let docker = {
  serverVersion: null,
  cpuCount: null,
  memoryBytes: null,
  cgroupDriver: null,
  cgroupVersion: null,
};
let dockerErrorName = null;
if (typeof dockerResult === 'string') {
  try {
    const info = JSON.parse(dockerResult);
    docker = {
      serverVersion: scalar(info.ServerVersion, 'string'),
      cpuCount: scalar(info.NCPU, 'number'),
      memoryBytes: scalar(info.MemTotal, 'number'),
      cgroupDriver: scalar(info.CgroupDriver, 'string'),
      cgroupVersion: scalar(info.CgroupVersion, 'string'),
    };
  } catch (error) {
    dockerErrorName = error instanceof Error ? error.name : 'UnknownError';
  }
} else {
  dockerErrorName = dockerResult.errorName;
}
const cpus = os.cpus();
const header = {
  type: 'header',
  createdAt: new Date().toISOString(),
  sourceHead: typeof headResult === 'string' ? headResult : null,
  sourceHeadErrorName:
    typeof headResult === 'string' ? null : headResult.errorName,
  sourceHashes,
  sourceHashErrorNames,
  testCommand:
    'pnpm exec vitest run --config backend/vitest.chat-search-benchmark.config.ts',
  runner: {
    image: process.env.F4_RUNNER_IMAGE ?? null,
    imageOS: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
    platform: `${os.platform()} ${os.release()}`,
    architecture: os.arch(),
    cpuModel: cpus[0]?.model ?? null,
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
  },
  docker,
  dockerErrorName,
};
await writeFile(artifactPath, `${JSON.stringify(header)}\n`, 'utf8');
await appendFile(
  artifactPath,
  `${JSON.stringify({ type: 'evidence-initialized', ready: true })}\n`,
  'utf8',
);
process.stdout.write(`F4_SEARCH_ARTIFACT ${artifactPath}\n`);
