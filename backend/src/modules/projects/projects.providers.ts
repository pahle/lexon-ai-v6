import type { Provider } from '@nestjs/common';
import { TenantDatabase } from '../../infrastructure/db/index.js';
import { OrganizationAuthPort } from '../identity-access/index.js';
import { CancelSignals } from '../../infrastructure/queue/index.js';
import { RunEventsService } from '../chat/index.js';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { ProjectService } from './project.service.js';

/** Composed by the api root module like the chat module — the projects
 * module needs TenantDatabase, which only lives in the root import graph.
 * CancelSignals + RunEventsService feed the post-commit fan-out that
 * project deletion shares with F4 single-chat delete. */
export function projectsApiProviders(
  config: Extract<RuntimeConfig, { runtime: 'api' }>,
): Provider[] {
  return [
    {
      provide: ProjectService,
      inject: [
        TenantDatabase,
        OrganizationAuthPort,
        CancelSignals,
        RunEventsService,
      ],
      useFactory: (
        database: TenantDatabase,
        port: OrganizationAuthPort,
        signals: CancelSignals,
        events: RunEventsService,
      ) =>
        new ProjectService(
          database,
          port,
          {
            pagination: config.auth.organizationPagination,
            deleteGraceMs: config.chat.deleteGraceMs,
          },
          signals,
          events,
        ),
    },
  ];
}
