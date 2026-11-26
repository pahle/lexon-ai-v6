import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, test } from 'vitest';
import {
  IDENTITY_PREFIXES,
  routeFamily,
} from '../../src/modules/platform/route-family.js';

// Every @Controller path mounted by the API app, mapped to its outage family.
// A new controller path fails this test until it is classified here on purpose.
const EXPECTED: Record<string, 'identity' | 'service'> = {
  identity: 'identity',
  'identity/admin-setup': 'identity',
  'identity/security': 'identity',
  'identity/invitations': 'identity',
  platform: 'identity',
  'platform/organizations': 'identity',
  'platform/provisioning': 'identity',
  organizations: 'identity',
  'organizations/:organizationId': 'identity',
  'organizations/:organizationId/invitations': 'identity',
  'invitations/:invitationId': 'identity',
  chats: 'service',
  runs: 'service',
  org: 'service',
  'org/projects': 'service',
  projects: 'service',
  diagnostics: 'service',
  health: 'service',
};

// The backend tsconfig does not include vite/client types; vitest still
// transforms import.meta.glob, so the call is typed locally.
const modules = (
  import.meta as unknown as {
    glob: (
      pattern: string,
      options: { eager: true },
    ) => Record<string, Record<string, unknown>>;
  }
).glob('../../src/**/*.controller.ts', { eager: true });

function controllerPaths(): {
  paths: Map<string, string>;
  decorated: number;
  mapped: number;
} {
  const paths = new Map<string, string>();
  let decorated = 0;
  let mapped = 0;
  for (const [file, module] of Object.entries(modules)) {
    if (file.includes('infrastructure/db/testing/')) continue;
    for (const exported of Object.values(module)) {
      if (typeof exported !== 'function') continue;
      const metadata: unknown = Reflect.getMetadata(PATH_METADATA, exported);
      if (metadata === undefined) continue;
      decorated += 1;
      let contributed = false;
      for (const path of Array.isArray(metadata) ? metadata : [metadata])
        if (typeof path === 'string' && path.length > 0) {
          paths.set(path.replace(/^\//, ''), file);
          contributed = true;
        }
      if (contributed) mapped += 1;
    }
  }
  return { paths, decorated, mapped };
}

describe('routeFamily', () => {
  test('every controller path in the API module tree is classified', () => {
    const { paths: collected, decorated, mapped } = controllerPaths();
    // A controller whose metadata is an object/empty path would be skipped
    // silently; every decorated controller must contribute a string path.
    expect(mapped).toBe(decorated);
    expect(new Set(collected.keys())).toEqual(new Set(Object.keys(EXPECTED)));
    for (const [path, file] of collected)
      expect(
        routeFamily('/api/' + path),
        `${path} (${file}) is classified deliberately`,
      ).toBe(EXPECTED[path]);
  });

  test.each([
    ['/api/identity', 'identity'],
    ['/api/identity/session', 'identity'],
    ['/api/organizations', 'identity'],
    ['/api/invitations/00000000-0000-4000-8000-000000000001', 'identity'],
    ['/api/platform/accounts', 'identity'],
    ['/api/auth/sign-in/email', 'identity'],
    ['/api/chats/00000000-0000-4000-8000-000000000001', 'service'],
    ['/api/runs/00000000-0000-4000-8000-000000000001/events', 'service'],
    ['/api/diagnostics', 'service'],
    ['/api/health', 'service'],
    // Boundary: a prefix must match a whole path segment.
    ['/api/identityx', 'service'],
    ['/api/platformer', 'service'],
    ['/api/organizationsx/teams', 'service'],
    ['/api/authx', 'service'],
    // The query string is stripped before classification.
    ['/api/identity/session?x=1', 'identity'],
    ['/api/chats?limit=5', 'service'],
    // An empty or missing path is not an identity route.
    ['', 'service'],
    ['/api', 'service'],
  ])('routeFamily(%j) === %j', (path, family) => {
    expect(routeFamily(path)).toBe(family);
  });

  test('IDENTITY_PREFIXES is the declared set', () => {
    expect([...IDENTITY_PREFIXES]).toEqual([
      '/api/identity',
      '/api/organizations',
      '/api/invitations',
      '/api/platform',
      '/api/auth',
    ]);
    for (const prefix of IDENTITY_PREFIXES)
      expect(routeFamily(prefix)).toBe('identity');
  });
});
