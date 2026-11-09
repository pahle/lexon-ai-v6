import type { FileServices } from './provided-context.js';
import { createRunAuthorizationDatabaseFixture } from '../../src/infrastructure/db/testing/run-authorization-fixture.js';

export function createRunAuthorizationFixture(services: FileServices) {
  return createRunAuthorizationDatabaseFixture({
    appUrl: services.appUrl,
    authUrl: services.authUrl,
  });
}
