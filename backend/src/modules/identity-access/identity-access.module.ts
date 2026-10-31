import { Module, type DynamicModule } from '@nestjs/common';
import type { AuthIntegration } from '../../infrastructure/db/index.js';

export const AUTH_INTEGRATION = Symbol('AuthIntegration');
const AUTH_LIFECYCLE = Symbol('AuthLifecycle');
@Module({})
export class IdentityAccessModule {
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
