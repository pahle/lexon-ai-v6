import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  validateReferenceInputs,
  verifyGeneratedSources,
} from '../visual/pristine-reference.mjs';

const temporaryPaths = [];

after(async () => {
  await Promise.all(
    temporaryPaths.map((target) =>
      rm(target, { recursive: true, force: true }),
    ),
  );
});

test('rejects production CSS and refuses to overwrite a reference image', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'lexon-pristine-reference-'),
  );
  temporaryPaths.push(root);

  const productionCss = path.join(
    root,
    'frontend',
    'src',
    'app',
    'globals.css',
  );
  const generatedCss = path.join(root, 'fixture', 'app', 'globals.css');
  const existingPng = path.join(root, 'reference.png');
  await mkdir(path.dirname(productionCss), { recursive: true });
  await mkdir(path.dirname(generatedCss), { recursive: true });
  await writeFile(productionCss, "@import 'tailwindcss';\n");
  await writeFile(generatedCss, "@import 'tailwindcss';\n");
  await writeFile(existingPng, 'already captured');

  await assert.rejects(
    validateReferenceInputs({ cssPath: productionCss, referencePaths: [] }),
    /production CSS/,
  );
  await assert.rejects(
    validateReferenceInputs({
      cssPath: generatedCss,
      referencePaths: [existingPng],
    }),
    /already exists/,
  );
  assert.equal(await readFile(existingPng, 'utf8'), 'already captured');
});

test('rejects generated sources whose content differs from the CLI manifest', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'lexon-pristine-manifest-'),
  );
  temporaryPaths.push(root);
  const sourcePath = path.join(root, 'components', 'sample.tsx');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, "export const sample = 'modified';\n");

  const manifest = {
    generatedFiles: [
      {
        path: sourcePath,
        sha256: '0'.repeat(64),
      },
    ],
  };

  await assert.rejects(verifyGeneratedSources(manifest), /hash mismatch/);
  assert.match(await readFile(sourcePath, 'utf8'), /modified/);
});

test('rejects a CSS alias that resolves to production globals', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'lexon-pristine-css-alias-'),
  );
  temporaryPaths.push(root);
  const aliasPath = path.join(root, 'global-styles.css');
  const productionCss = path.join(
    process.cwd(),
    'frontend/src/app/globals.css',
  );
  await symlink(productionCss, aliasPath);

  await assert.rejects(
    validateReferenceInputs({ cssPath: aliasPath, referencePaths: [] }),
    /production CSS/,
  );
});
