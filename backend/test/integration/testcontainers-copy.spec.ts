import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { GenericContainer } from 'testcontainers';
import { readContainerImages } from '../../../scripts/container-images.mjs';

const images = readContainerImages(
  new URL('../../../config/container-images.env', import.meta.url).pathname,
);

// GHSA-3g3m (glob via archiver-utils) guard: on the copy path archiver walks
// the directory with readdir-glob; the overridden glob is the one
// archiver-utils resolves with `require('glob')` at module load and calls as
// `glob.sync`. The `withCopyDirectoriesToContainer` round trip proves the copy
// feature still works after the override — load-time resolution included —
// and the last assertion proves the resolved glob exports the `sync` the call
// site uses.
it('copies a host directory into a container and reads a file back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-f44-copy-'));
  const content = 'lexon f4.4 glob guard probe';
  await writeFile(join(directory, 'a.txt'), content);
  try {
    const container = await new GenericContainer(images.postgres)
      .withCommand(['sleep', '60'])
      .withCopyDirectoriesToContainer([{ source: directory, target: '/probe' }])
      .start();
    try {
      const result = await container.exec(['cat', '/probe/a.txt']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(content);
    } finally {
      await container.stop();
    }
    // `glob` is not a direct backend dependency, so this resolves it exactly
    // the way archiver-utils does at load time: testcontainers → archiver →
    // archiver-utils → glob.
    const requireHere = createRequire(import.meta.url);
    const fromTestcontainers = createRequire(
      requireHere.resolve('testcontainers/package.json'),
    );
    const fromArchiver = createRequire(
      fromTestcontainers.resolve('archiver/package.json'),
    );
    const glob = createRequire(
      fromArchiver.resolve('archiver-utils/package.json'),
    )('glob') as { sync?: unknown };
    expect(typeof glob.sync).toBe('function');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
