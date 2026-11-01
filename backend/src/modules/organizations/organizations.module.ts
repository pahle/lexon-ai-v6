import { Module, type DynamicModule } from '@nestjs/common';
import type {
  OrganizationAuthPort,
  OrganizationSelectionPort,
} from '../identity-access/index.js';
import { OrganizationController } from './organization.controller.js';
import { InvitationService } from './invitation.service.js';
import {
  InvitationController,
  OrganizationInvitationController,
  RecipientInvitationController,
} from './invitation.controller.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationSwitchService } from './organization-switch.service.js';

@Module({})
export class OrganizationsModule {
  static forPolicy(options: {
    port: OrganizationAuthPort;
    selection: OrganizationSelectionPort;
    pagination: { defaultLimit: number; maxLimit: number };
    invitationSeconds: number;
  }): DynamicModule {
    return {
      module: OrganizationsModule,
      controllers: [
        OrganizationController,
        InvitationController,
        OrganizationInvitationController,
        RecipientInvitationController,
      ],
      providers: [
        {
          provide: InvitationService,
          useFactory: () =>
            new InvitationService(options.port, options.selection, {
              invitationSeconds: options.invitationSeconds,
              pagination: options.pagination,
            }),
        },
        {
          provide: OrganizationSwitchService,
          useFactory: () => new OrganizationSwitchService(options.selection),
        },
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
