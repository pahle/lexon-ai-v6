import { AdminSetupService } from './admin-setup.service.js';
import { AdminSetupController } from './admin-setup.controller.js';
import { Module, type DynamicModule } from '@nestjs/common';
import type { AuthIntegration } from '../../infrastructure/db/index.js';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import {
  IdentitySessionService,
  ORGANIZATION_SELECTION,
} from './identity-session.service.js';
import {
  RequestIdentity,
  RequestIdentityInterceptor,
} from './request-identity.js';
import { TenantGuard } from './tenant.guard.js';
import { IdentityController } from './identity.controller.js';
import { PlatformAdminService } from './platform-admin.service.js';
import { PlatformAdminController } from './platform-admin.controller.js';
import { SessionService } from './session.service.js';
import { SessionController } from './session.controller.js';
import { OrganizationAuthPort } from './organization-auth.port.js';

export const AUTH_INTEGRATION = Symbol('AuthIntegration');
const AUTH_LIFECYCLE = Symbol('AuthLifecycle');
@Module({})
export class IdentityAccessModule {
  static forPolicy(options: {
    integration: AuthIntegration;
    frameworkModule: DynamicModule;
    bearerSeconds?: number;
    reauthSeconds?: number;
    requestPolicy?: ConstructorParameters<typeof TenantGuard>[3];
  }): DynamicModule {
    const identities = new IdentitySessionService(options.integration);
    const requests = new RequestIdentity();
    return {
      module: IdentityAccessModule,
      imports: [this.forIntegration(options)],
      controllers: [
        AdminSetupController,
        IdentityController,
        SessionController,
        PlatformAdminController,
      ],
      providers: [
        {
          provide: AdminSetupService,
          useValue: new AdminSetupService(
            options.integration,
            new OrganizationAuthPort(options.integration),
          ),
        },
        {
          provide: PlatformAdminService,
          useValue: new PlatformAdminService(
            new OrganizationAuthPort(options.integration),
            { reauthSeconds: options.reauthSeconds ?? 300 },
          ),
        },
        {
          provide: SessionService,
          useValue: new SessionService(
            new OrganizationAuthPort(options.integration),
            { bearerSeconds: options.bearerSeconds ?? 900 },
          ),
        },
        { provide: RequestIdentity, useValue: requests },
        {
          provide: OrganizationAuthPort,
          useValue: new OrganizationAuthPort(options.integration),
        },
        {
          provide: ORGANIZATION_SELECTION,
          useValue: Object.freeze({
            select: identities.select.bind(identities),
          }),
        },
        {
          provide: APP_GUARD,
          useValue: new TenantGuard(
            identities,
            requests,
            new Reflector(),
            options.requestPolicy,
          ),
        },
        {
          provide: APP_INTERCEPTOR,
          useValue: new RequestIdentityInterceptor(requests),
        },
      ],
      exports: [OrganizationAuthPort, ORGANIZATION_SELECTION],
    };
  }
  // The private infrastructure composition supplies its community AuthModule
  // with the restricted handler. Neither native AuthService nor its context is
  // re-exported to domain modules.
  static forIntegration(options: {
    integration: AuthIntegration;
    frameworkModule: DynamicModule;
  }): DynamicModule {
    return {
      module: IdentityAccessModule,
      imports: [options.frameworkModule],
      providers: [
        { provide: AUTH_INTEGRATION, useValue: options.integration },
        {
          provide: AUTH_LIFECYCLE,
          useValue: {
            onApplicationShutdown: () => options.integration.close(),
          },
        },
      ],
      exports: [],
    };
  }
}
