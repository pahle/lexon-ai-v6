#!/usr/bin/env node
// Downloads llms.txt (and llms-full.txt with --full) for the technologies in
// docs/references/sources.json into .cache/docs/<id>/, which is gitignored.
// Usage: node scripts/fetch-docs.mjs [--full] [id ...]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const full = args.includes('--full');
const wanted = new Set(args.filter((a) => !a.startsWith('--')));

const { sources } = JSON.parse(
  await readFile(join(root, 'docs/references/sources.json'), 'utf8'),
);

let failed = 0;
for (const source of sources) {
  if (wanted.size > 0 && !wanted.has(source.id)) continue;
  const targets = [['llms.txt', source.llms]];
  if (full) targets.push(['llms-full.txt', source.llmsFull]);
  for (const [file, url] of targets) {
    if (!url) continue;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dir = join(root, '.cache/docs', source.id);
      await mkdir(dir, { recursive: true });
      const body = await res.text();
      await writeFile(join(dir, file), body);
      console.log(`ok   ${source.id}/${file} (${body.length} bytes)`);
    } catch (error) {
      failed += 1;
      console.error(`fail ${source.id}/${file}: ${error.message}`);
    }
  }
}
process.exitCode = failed > 0 ? 1 : 0;
