import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const routeFiles = [
  ['frontend/src/app/(workspace)/workspace/page.tsx', 'Workspace'],
  ['frontend/src/app/(workspace)/settings/profile/page.tsx', 'Profile'],
  ['frontend/src/app/(workspace)/settings/security/page.tsx', 'Security'],
  ['frontend/src/app/(workspace)/settings/appearance/page.tsx', 'Appearance'],
  ['frontend/src/app/(workspace)/organizations/page.tsx', 'Organizations'],
  [
    'frontend/src/app/(workspace)/organizations/[orgId]/page.tsx',
    'Organization',
  ],
  [
    'frontend/src/app/(workspace)/organizations/[orgId]/settings/members/page.tsx',
    'Members',
  ],
  [
    'frontend/src/app/(workspace)/organizations/[orgId]/settings/invitations/page.tsx',
    'Invitations',
  ],
  [
    'frontend/src/app/(workspace)/organizations/[orgId]/settings/general/page.tsx',
    'General',
  ],
  [
    'frontend/src/app/(workspace)/platform/provisioning/page.tsx',
    'Provisioning',
  ],
];

test('F2 route inventory retains descriptive titles and shell not-found routes', async () => {
  for (const [path, title] of routeFiles) {
    const source = await readFile(path, 'utf8');
    assert.match(
      source,
      /title:\s*['"`][^'"`]+\| Lexon['"`]/,
      `${path} must define a descriptive title`,
    );
    assert.match(source, new RegExp(title), `${path} must identify its page`);
  }
  const unmatched = await readFile(
    'frontend/src/app/(workspace)/organizations/[orgId]/[...unmatched]/page.tsx',
    'utf8',
  );
  assert.match(
    unmatched,
    /notFound/,
    'unmatched organization routes must use notFound',
  );
  const notFound = await readFile(
    'frontend/src/app/(workspace)/not-found.tsx',
    'utf8',
  );
  assert.match(notFound, /Page not found/);
  assert.match(notFound, /href="\/workspace"/);
  const error = await readFile(
    'frontend/src/app/(workspace)/error.tsx',
    'utf8',
  );
  assert.match(error, /Something went wrong/);
  assert.match(error, /ErrorState/);
  assert.match(error, /href="\/workspace"/);
});

test('F2 frontend source has no chat endpoint or theme preference API call', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  let stdout = '';
  try {
    ({ stdout } = await run('rg', [
      '-n',
      '--glob',
      '!**/test/**',
      '/api/chat|identityApi.*theme|fetch.*theme',
      'frontend/src',
    ]));
  } catch (error) {
    if (error.code !== 1) throw error;
  }
  assert.equal(
    stdout,
    '',
    `Unexpected chat or theme backend request:\n${stdout}`,
  );
});
