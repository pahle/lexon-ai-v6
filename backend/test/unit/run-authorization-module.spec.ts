import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('RunAuthorizationModule boots without auth/SMTP imports or TCP activity', () => {
  const script = fileURLToPath(
    new URL('../process/run-authorization-module-trace.mjs', import.meta.url),
  );
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  expect(JSON.parse(output)).toMatchObject({
    forbiddenImports: [],
    networkCalls: [],
  });
});
