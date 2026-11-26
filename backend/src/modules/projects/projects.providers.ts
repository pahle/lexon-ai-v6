import type { Provider } from '@nestjs/common';
import { TenantDatabase } from '../../infrastructure/db/index.js';
import { OrganizationAuthPort } from '../identity-access/index.js';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { ProjectService } from './project.service.js';

/** Composed by the api root module like the chat module — the projects
 * module needs TenantDatabase, which only lives in the root import graph. */
export function projectsApiProviders(
  config: Extract<RuntimeConfig, { runtime: 'api' }>,
): Provider[] {
  return [
    {
      provide: ProjectService,
      inject: [TenantDatabase, OrganizationAuthPort],
      useFactory: (database: TenantDatabase, port: OrganizationAuthPort) =>
        new ProjectService(database, port, {
          pagination: config.auth.organizationPagination,
        }),
    },
  ];
}
