import { Controller, Get, Param, Query } from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import {
  PlatformRoute,
  currentVerifiedIdentity,
} from '../identity-access/index.js';
import { PlatformOrganizationsService } from './organizations.service.js';

@Controller('platform/organizations')
@PlatformRoute()
export class PlatformOrganizationsController {
  constructor(private readonly organizations: PlatformOrganizationsService) {}
  @Get() list(@Query() query: unknown) {
    return this.organizations.list(currentVerifiedIdentity(), query);
  }
  @Get(':organizationId') get(@Param('organizationId') id: string) {
    return this.organizations.get(
      currentVerifiedIdentity(),
      UuidSchema.parse(id),
    );
  }
  @Get(':organizationId/members') members(
    @Param('organizationId') id: string,
    @Query() query: unknown,
  ) {
    return this.organizations.members(
      currentVerifiedIdentity(),
      UuidSchema.parse(id),
      query,
    );
  }
}
