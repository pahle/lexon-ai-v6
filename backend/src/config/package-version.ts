import { readFileSync } from 'node:fs';

/** The backend package version, read once from its manifest. */
export function readBackendVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL(import.meta.resolve('#backend-package')), 'utf8'),
  ) as { version: string };
  return manifest.version;
}
