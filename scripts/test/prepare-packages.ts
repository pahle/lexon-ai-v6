import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
let preparation: Promise<void> | undefined;
export default function prepare(): Promise<void> {
  return (preparation ??= buildPackages());
}
async function buildPackages() {
  const root = new URL('../../', import.meta.url);
  const tsc = new URL('node_modules/typescript/bin/tsc', root).pathname;
  for (const project of ['shared', 'backend'])
    await promisify(execFile)(
      process.execPath,
      [tsc, '-p', new URL(`${project}/tsconfig.build.json`, root).pathname],
      { timeout: 30000 },
    );
}
