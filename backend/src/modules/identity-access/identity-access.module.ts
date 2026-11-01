import { Module, type DynamicModule } from '@nestjs/common';
import type { AuthIntegration } from '../../infrastructure/db/index.js';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import type { AuthLimiter } from '../../infrastructure/queue/index.js';
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
import { OrganizationAuthPort } from './organization-auth.port.js';

export const AUTH_INTEGRATION = Symbol('AuthIntegration');
const AUTH_LIFECYCLE = Symbol('AuthLifecycle');
@Module({})
export class IdentityAccessModule {
  static forPolicy(options: {
    integration: AuthIntegration;
    frameworkModule: DynamicModule;
    availability: Pick<AuthLimiter, 'assertAvailable'>;
  }): DynamicModule {
    const identities = new IdentitySessionService(options.integration);
    const requests = new RequestIdentity();
    return {
      module: IdentityAccessModule,
      imports: [this.forIntegration(options)],
      controllers: [IdentityController],
      providers: [
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
            options.availability,
            new Reflector(),
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
