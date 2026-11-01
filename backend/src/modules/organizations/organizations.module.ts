import { Module, type DynamicModule } from '@nestjs/common';
import type { OrganizationAuthPort } from '../identity-access/index.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';

@Module({})
export class OrganizationsModule {
  static forPolicy(options: {
    port: OrganizationAuthPort;
    pagination: { defaultLimit: number; maxLimit: number };
  }): DynamicModule {
    return {
      module: OrganizationsModule,
      controllers: [OrganizationController],
      providers: [
        {
          provide: OrganizationService,
          useFactory: () =>
            new OrganizationService(options.port, {
              pagination: options.pagination,
            }),
        },
      ],
      exports: [OrganizationService],
    };
  }
}
