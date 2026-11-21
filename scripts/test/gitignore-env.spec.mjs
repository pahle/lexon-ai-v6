import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function ignored(path) {
  const result = spawnSync('git', ['check-ignore', '-q', path], {
    encoding: 'utf8',
  });
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  return result.status === 0;
}

test('env files at any depth are ignored; .env.example is not', () => {
  assert.equal(ignored('backend/.env.local'), true);
  assert.equal(ignored('infra/x/.env.prod'), true);
  assert.equal(ignored('.env'), true);
  assert.equal(ignored('.env.example'), false);
  assert.equal(ignored('backend/.env.example'), false);
});
