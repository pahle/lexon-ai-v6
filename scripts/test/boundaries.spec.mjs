import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import plugin from '../eslint/lexon-boundaries.mjs';

const cases = JSON.parse(
  readFileSync(new URL('./fixtures/boundaries/cases.json', import.meta.url)),
);
const root = mkdtempSync(join(tmpdir(), 'lexon-boundaries-'));
after(() => rmSync(root, { recursive: true, force: true }));
for (const folder of ['backend', 'frontend', 'shared', 'evals']) {
  mkdirSync(join(root, folder, 'src'), { recursive: true });
  writeFileSync(
    join(root, folder, 'package.json'),
    JSON.stringify({
      name: `@lexon/${folder}`,
      type: 'module',
      imports: { '#private-backend': '../backend/src/private.js' },
    }),
  );
  writeFileSync(
    join(root, folder, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['./src/*'], '@backend/*': ['../backend/src/*'] },
      },
    }),
  );
}

const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { lexon: plugin },
      rules: { 'lexon/boundaries': ['error', { root }] },
    },
  ],
});

for (const fixture of cases) {
  test(fixture.name, async () => {
    const filePath = join(root, fixture.importer);
    mkdirSync(dirname(filePath), { recursive: true });
    const [result] = await eslint.lintText(fixture.code, { filePath });
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    if (fixture.rule) {
      assert.equal(result.messages.length, 1, JSON.stringify(result.messages));
      assert.equal(result.messages[0].ruleId, 'lexon/boundaries');
      assert.match(
        result.messages[0].message,
        new RegExp(`\\[${fixture.rule}\\]`),
      );
    } else {
      assert.deepEqual(result.messages, []);
    }
  });
}

test('a root barrel cannot re-export a driver to evade ownership', async () => {
  const [result] = await eslint.lintText("export * from 'pg';", {
    filePath: join(root, 'scripts/server.ts'),
  });
  assert.equal(result.messages[0].ruleId, 'lexon/boundaries');
  assert.match(result.messages[0].message, /\[database-owner\]/);
});
