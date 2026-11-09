import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { isForbiddenAuthorizationImport } from '../process/authorization-import-policy.mjs';

test('authorization import guard recognizes root and scoped auth packages', () => {
  for (const specifier of [
    'better-auth',
    'better-auth/api',
    '@better-auth/core',
    '@better-auth/core/context',
    '@thallesp/nestjs-better-auth',
    '@thallesp/nestjs-better-auth/testing',
    'nodemailer',
    'nodemailer/lib/mailer',
  ])
    expect(isForbiddenAuthorizationImport(specifier)).toBe(true);

  for (const specifier of ['@better-authentic/core', 'unrelated-module'])
    expect(isForbiddenAuthorizationImport(specifier)).toBe(false);
});

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
