import { Module, type DynamicModule } from '@nestjs/common';
import type { OrganizationAuthPort } from '../identity-access/index.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { PlatformOrganizationsController } from './organizations.controller.js';
import { PlatformOrganizationsService } from './organizations.service.js';
import { PlatformConsoleRepository } from './platform-console.repository.js';

@Module({})
export class PlatformConsoleModule {
  static forPort(port: OrganizationAuthPort): DynamicModule {
    const repository = new PlatformConsoleRepository();
    return {
      module: PlatformConsoleModule,
      controllers: [AccountsController, PlatformOrganizationsController],
      providers: [
        {
          provide: AccountsService,
          useValue: new AccountsService(port, repository),
        },
        {
          provide: PlatformOrganizationsService,
          useValue: new PlatformOrganizationsService(port, repository),
        },
      ],
    };
  }
}
