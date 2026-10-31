import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHealthSnapshot } from '../infrastructure/telemetry/health-snapshot.js';
export async function checkHealthFile(options: {
  path: string;
  mode: 'liveness' | 'readiness';
  now: Date;
  staleMs: number;
}): Promise<0 | 1> {
  try {
    const info = await stat(options.path);
    if (!info.isFile() || info.size > 16384) return 1;
    const snapshot = parseHealthSnapshot(
      JSON.parse(await readFile(options.path, 'utf8')),
    );
    const age = options.now.getTime() - Date.parse(snapshot.writtenAt);
    if (
      !Number.isFinite(age) ||
      !Number.isSafeInteger(options.staleMs) ||
      options.staleMs < 1 ||
      age >= options.staleMs ||
      age < -1000
    )
      return 1;
    return snapshot[options.mode] === 'up' ? 0 : 1;
  } catch {
    return 1;
  }
}
export async function runHealthCheckCommand(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<0 | 1> {
  const mode = args[1];
  const path = env.HEALTH_FILE ?? '/run/lexon/health/status.json';
  const staleMs = Number(env.HEALTH_STALE_MS ?? 20000);
  if (
    args.length !== 2 ||
    args[0] !== '--mode' ||
    (mode !== 'liveness' && mode !== 'readiness') ||
    !isAbsolute(path) ||
    !Number.isSafeInteger(staleMs) ||
    staleMs <= 0
  )
    return 1;
  return checkHealthFile({ path, mode, now: new Date(), staleMs });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runHealthCheckCommand(
    process.argv.slice(2),
    process.env,
  );
}
