import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'scripts/test/visual-capture-manifest.mjs');

test('rejects a capture older than the required freshness marker before writing output', async () => {
  const directory = await mkdtemp(
    resolve(os.tmpdir(), 'lexon-visual-capture-freshness-'),
  );
  const output = resolve(directory, 'capture.json');
  try {
    let failure;
    try {
      await execFileAsync(
        process.execPath,
        [
          script,
          '--output',
          output,
          '--not-before',
          String(Date.now() + 60_000),
        ],
        { cwd: root, encoding: 'utf8', timeout: 15_000 },
      );
    } catch (error) {
      failure = error;
    }
    if (!failure) {
      const manifest = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(manifest.viewCount, 82);
      assert.fail(
        'the CLI accepted a future --not-before and wrote its manifest',
      );
    }
    assert.ok(failure, 'the stale capture must be refused');
    assert.equal(failure.code, 1);
    assert.match(
      failure.stderr,
      /Visual capture must be newer than --not-before\./,
    );
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects an invalid freshness marker before browser capture or output', async () => {
  const directory = await mkdtemp(
    resolve(os.tmpdir(), 'lexon-visual-capture-invalid-marker-'),
  );
  const output = resolve(directory, 'capture.json');
  try {
    let failure;
    try {
      await execFileAsync(
        process.execPath,
        [script, '--output', output, '--not-before', 'not-an-epoch'],
        { cwd: root, encoding: 'utf8', timeout: 15_000 },
      );
    } catch (error) {
      failure = error;
    }
    if (!failure) {
      const manifest = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(manifest.viewCount, 82);
      assert.fail(
        'the CLI accepted an invalid --not-before and wrote its manifest',
      );
    }
    assert.ok(failure, 'the invalid freshness marker must be refused');
    assert.equal(failure.code, 1);
    assert.match(
      failure.stderr,
      /--not-before must be a valid epoch millisecond timestamp\./,
    );
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
