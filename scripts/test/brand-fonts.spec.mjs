import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// LEX-DS-001 v3.0.1 §3: Inter, EB Garamond, and TeX Gyre Bonum are
// self-hosted from the brand package with their licenses.
const brandFonts = new URL(
  '../../docs/brand/lexon-2026-v4.1/fonts/',
  import.meta.url,
);
const frontendSource = new URL('../../frontend/src/', import.meta.url);
const appFonts = new URL('fonts/', frontendSource);
const read = (url) => readFileSync(url, 'utf8');

test('the app ships the brand fonts and licenses unchanged', () => {
  const files = readdirSync(brandFonts).sort();
  assert.deepEqual(files, [
    'EBGaramond-Italic-latin-wght.woff2',
    'EBGaramond-latin-wght.woff2',
    'Inter-latin-wght.woff2',
    'LICENSE-EBGaramond-OFL.txt',
    'LICENSE-Inter-OFL.txt',
    'LICENSE-TeXGyreBonum-GUST.txt',
    'TeXGyreBonum-Bold-latin.woff2',
    'TeXGyreBonum-Regular-latin.woff2',
  ]);
  for (const file of files)
    assert.ok(
      readFileSync(new URL(file, appFonts)).equals(
        readFileSync(new URL(file, brandFonts)),
      ),
      `${file} differs from the brand package`,
    );
});

test('fonts load through next/font/local and never from a font host', () => {
  const definitions = read(new URL('index.ts', appFonts));
  const layout = read(new URL('app/layout.tsx', frontendSource));
  for (const source of [definitions, layout])
    assert.doesNotMatch(
      source,
      /next\/font\/google|fonts\.g(oogleapis|static)/,
    );
  assert.match(definitions, /from 'next\/font\/local'/);
  for (const [variable, file] of [
    ['--font-inter', 'Inter-latin-wght.woff2'],
    ['--font-garamond', 'EBGaramond-latin-wght.woff2'],
    ['--font-garamond', 'EBGaramond-Italic-latin-wght.woff2'],
    ['--font-bonum', 'TeXGyreBonum-Regular-latin.woff2'],
    ['--font-bonum', 'TeXGyreBonum-Bold-latin.woff2'],
  ]) {
    assert.ok(definitions.includes(`variable: '${variable}'`), variable);
    assert.ok(definitions.includes(`./${file}`), file);
  }
  // Text is never invisible while a font loads.
  assert.equal(definitions.match(/display: 'swap'/g)?.length, 3);
  assert.doesNotMatch(definitions, /display: '(block|auto|optional)'/);
  for (const name of ['Inter', 'Garamond', 'Bonum'])
    assert.match(layout, new RegExp(`${name}\\.variable`), name);
});

test('the type roles map onto the self-hosted families', () => {
  const css = read(new URL('app/globals.css', frontendSource));
  assert.match(
    css,
    /--font-sans:\s*var\(--font-inter\),\s*system-ui,\s*sans-serif;/,
  );
  assert.match(
    css,
    /--font-serif:\s*var\(--font-garamond\),\s*Georgia,\s*serif;/,
  );
  assert.match(
    css,
    /--font-document:\s*var\(--font-bonum\),\s*'Bookman Old Style',\s*Georgia,\s*serif;/,
  );
  assert.match(
    css,
    /--font-mono:\s*ui-monospace,\s*SFMono-Regular,\s*Menlo,\s*monospace;/,
  );
});

test('Georgia appears only as a fallback in the type role definitions', () => {
  const offenders = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        const lines = readFileSync(path, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (
            /georgia/i.test(line) &&
            !/^\s*--font-(serif|document):\s*var\(--font-(garamond|bonum)\)/.test(
              line,
            )
          )
            offenders.push(`${path}:${index + 1}`);
        });
      }
    }
  };
  visit(frontendSource.pathname);
  assert.deepEqual(offenders, []);
});
