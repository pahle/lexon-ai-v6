import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function initializeSearchEvidence() {
  const script = fileURLToPath(
    new URL(
      '../../../scripts/test/prepare-f4-search-evidence.mjs',
      import.meta.url,
    ),
  );
  execFileSync(process.execPath, [script], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    stdio: 'inherit',
    timeout: 30_000,
  });
}
