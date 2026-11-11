import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';

const routeFiles = [
  ['frontend/src/app/(workspace)/workspace/page.tsx', 'Workspace'],
  ['frontend/src/app/(workspace)/organizations/page.tsx', 'Organizations'],
  [
    'frontend/src/app/(workspace)/organizations/[orgId]/page.tsx',
    'Organization',
  ],
  [
    'frontend/src/app/(workspace)/platform/provisioning/page.tsx',
    'Provisioning',
  ],
];

const approvedF4FrontendRequest = {
  file: 'lib/chat-title-invalidation.ts',
  path: '/api/chats/events',
};

function isForbiddenFrontendRequest(file, line) {
  const chatPaths = [...line.matchAll(/\/api\/chat/g)];
  if (
    chatPaths.some(({ index }) => {
      const quote = line[index - 1];
      if (quote !== "'" && quote !== '"' && quote !== '`') return true;
      const end = line.indexOf(quote, index);
      if (end < 0) return true;
      const path = line.slice(index, end);
      return (
        file !== approvedF4FrontendRequest.file ||
        path !== approvedF4FrontendRequest.path
      );
    })
  )
    return true;
  return /identityApi.*theme|fetch.*theme/.test(line);
}

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

test('F2 legacy settings page entrypoints remain removed', async () => {
  const removedRoutes = [
    'frontend/src/app/(workspace)/settings/profile/page.tsx',
    'frontend/src/app/(workspace)/settings/security/page.tsx',
    'frontend/src/app/(workspace)/settings/appearance/page.tsx',
    'frontend/src/app/(workspace)/organizations/[orgId]/settings/members/page.tsx',
    'frontend/src/app/(workspace)/organizations/[orgId]/settings/invitations/page.tsx',
    'frontend/src/app/(workspace)/organizations/[orgId]/settings/general/page.tsx',
  ];
  for (const route of removedRoutes) {
    await assert.rejects(access(route), { code: 'ENOENT' }, route);
  }
});

test('F2 frontend source has no unapproved chat endpoint or theme preference API call', async () => {
  const root = 'frontend/src';
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test') await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  await visit(root);
  const matches = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    const relativePath = relative(root, path).split(sep).join('/');
    for (const [index, line] of source.split('\n').entries()) {
      if (isForbiddenFrontendRequest(relativePath, line))
        matches.push(`${relativePath}:${index + 1}`);
    }
  }
  assert.equal(
    matches.join('\n'),
    '',
    `Unexpected chat or theme backend request:\n${matches.join('\n')}`,
  );
});

test('approved F4 event route does not permit legacy chat or theme requests', () => {
  assert.equal(
    isForbiddenFrontendRequest(
      approvedF4FrontendRequest.file,
      "new EventSource('/api/chats/events')",
    ),
    false,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      'lib/chat-title-invalidation.ts',
      "fetch('/api/chat')",
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      'lib/chat-title-invalidation.ts',
      'const path = `/api/chat/${chatId}`',
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      approvedF4FrontendRequest.file,
      "identityApi.updateUser({ theme: 'dark' })",
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      'other-file.ts',
      "new EventSource('/api/chats/events')",
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      'other-file.ts',
      "fetch('/api/chats/arbitrary')",
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      approvedF4FrontendRequest.file,
      "fetch('/api/chats/events-extra')",
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      approvedF4FrontendRequest.file,
      "new EventSource('/api/chats/events'); fetch('/api/chat')",
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      approvedF4FrontendRequest.file,
      "fetch('/api/chats/events)extra')",
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      approvedF4FrontendRequest.file,
      "fetch('/api/chats/events extra')",
    ),
    true,
  );
  assert.equal(
    isForbiddenFrontendRequest(
      approvedF4FrontendRequest.file,
      'fetch(`/api/chats/events${suffix}`)',
    ),
    true,
  );
});
