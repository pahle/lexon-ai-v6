import { randomUUID } from 'node:crypto';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi } from '../setup/test-api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import {
  ROUTE_ACCESS,
  type RouteAccess,
} from '../../src/modules/identity-access/route-access.js';

// F6 task 5: the TenantGuard rejects `userId` (and the other override keys)
// in query and body so a client can never assert someone else's identity.
// Member-add is the one route whose contract carries `{userId}` in the body,
// so an opt-in metadata flag — ROUTE_ACCESS allowUserIdKey — allows that key
// on exactly that route. This inventory proves no other route ever joins:
// every body-capable workspace route must still 400 on the override key.

const BODY_METHODS = new Set([
  RequestMethod.POST,
  RequestMethod.PATCH,
  RequestMethod.PUT,
]);

test('every workspace route still rejects the userId override key except the documented allowlist', async ({
  services,
}) => {
  const app = await createTestApi(
    loadRuntimeConfig(
      'api',
      createAuthEnvironment(services, '/tmp/lexon-guard-routes.json'),
    ),
  );
  try {
    const discovery = app.get(DiscoveryService);
    const reflector = app.get(Reflector);
    const scanner = new MetadataScanner();
    const routes: Array<{
      method: string;
      requestMethod: RequestMethod;
      path: string;
      access: RouteAccess;
    }> = [];
    for (const wrapper of discovery.getControllers()) {
      const metatype = wrapper.metatype;
      if (!metatype?.prototype) continue;
      const asPaths = (value: unknown): string[] =>
        typeof value === 'string' ? [value] : ((value as string[]) ?? []);
      const controllerPaths = asPaths(
        Reflect.getMetadata(PATH_METADATA, metatype),
      );
      for (const methodName of scanner.getAllMethodNames(metatype.prototype)) {
        const handler = metatype.prototype[methodName];
        const methodPaths = asPaths(
          Reflect.getMetadata(PATH_METADATA, handler),
        );
        const requestMethod: RequestMethod | undefined = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        );
        if (requestMethod === undefined) continue;
        const access: RouteAccess = reflector.getAllAndOverride<RouteAccess>(
          ROUTE_ACCESS,
          [handler, metatype],
        ) ?? { kind: 'workspace' };
        for (const controllerPath of controllerPaths)
          for (const methodPath of methodPaths)
            routes.push({
              method: RequestMethod[requestMethod],
              requestMethod,
              path: `${controllerPath}/${methodPath}`.replace(/\/+/g, '/'),
              access,
            });
      }
    }
    expect(routes.length).toBeGreaterThan(10);

    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const allowed: string[] = [];
    for (const route of routes) {
      if (route.access.kind !== 'workspace') continue;
      if (!BODY_METHODS.has(route.requestMethod)) continue;
      const probed = `${origin}/api/${route.path
        .replace(/^\/+|\/+$/g, '')
        .replace(/:[^/]+/g, randomUUID())}`;
      const response = await fetch(probed, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: randomUUID() }),
      });
      if (response.status !== 400)
        allowed.push(`${route.method} ${route.path}`);
      await response.body?.cancel().catch(() => undefined);
    }
    // The only body route permitted to carry {userId} — member-add. Task 6
    // extends the list with POST /org/projects/:id/denies; nothing else may
    // ever appear here.
    expect(allowed).toEqual(['POST projects/:projectId/members']);
  } finally {
    await app.close();
  }
});
