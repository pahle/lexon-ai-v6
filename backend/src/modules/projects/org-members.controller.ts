import { Controller, Get, Query } from '@nestjs/common';
import {
  currentTenantContext,
  currentVerifiedIdentity,
} from '../identity-access/index.js';
import { ProjectService } from './project.service.js';

@Controller('org')
export class OrgMembersController {
  constructor(private readonly projects: ProjectService) {}

  /** Member/share picker source for the projects module (F6 §11). */
  @Get('members/search') search(@Query() query: unknown) {
    return this.projects.searchOrgMembers(
      currentTenantContext(),
      currentVerifiedIdentity(),
      query,
    );
  }
}
