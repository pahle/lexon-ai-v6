import { Module, type DynamicModule } from '@nestjs/common';
import type { OrganizationAuthPort } from '../identity-access/index.js';
import { AccountInvitationsController } from './account-invitations.controller.js';
import { AccountInvitationsService } from './account-invitations.service.js';
import type { AuthLimiter } from '../../infrastructure/queue/index.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { PlatformOrganizationsController } from './organizations.controller.js';
import { PlatformOrganizationsService } from './organizations.service.js';
import { PlatformConsoleRepository } from './platform-console.repository.js';

@Module({})
export class PlatformConsoleModule {
  static forPort(
    port: OrganizationAuthPort,
    options: {
      limiter: Pick<AuthLimiter, 'consume'>;
      reauthSeconds: number;
    },
  ): DynamicModule {
    const repository = new PlatformConsoleRepository();
    return {
      module: PlatformConsoleModule,
      controllers: [
        AccountsController,
        AccountInvitationsController,
        PlatformOrganizationsController,
      ],
      providers: [
        {
          provide: AccountsService,
          useValue: new AccountsService(port, repository),
        },
        {
          provide: AccountInvitationsService,
          useValue: new AccountInvitationsService(
            port,
            { reauthSeconds: options.reauthSeconds },
            options.limiter,
          ),
        },
        {
          provide: PlatformOrganizationsService,
          useValue: new PlatformOrganizationsService(port, repository),
        },
      ],
    };
  }
}
