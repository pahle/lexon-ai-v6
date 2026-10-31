import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
it('names invalid configuration fields at process boot without leaking supplied values', () => {
  const secret = 'LEXON_BOOT_SECRET_SENTINEL';
  const result = spawnSync(
    process.execPath,
    [
      new URL('../../dist/entrypoints/dispatcher/main.js', import.meta.url)
        .pathname,
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        DATABASE_APP_URL: secret,
        VALKEY_QUEUE_URL: secret,
        VALKEY_STREAMS_URL: secret,
        VALKEY_LIMITER_URL: secret,
      },
    },
  );
  expect(result.status).toBe(1);
  const output = result.stdout + result.stderr;
  expect(output).toContain('DATABASE_APP_URL');
  expect(output).toContain('VALKEY_QUEUE_URL');
  expect(output).not.toContain(secret);
});
