import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import {
  currentTenantContext,
  currentVerifiedIdentity,
  ROUTE_ACCESS,
  type RouteAccess,
} from '../identity-access/index.js';
import { SetMetadata } from '@nestjs/common';
import { ProjectService } from './project.service.js';

// POST /org/projects/:projectId/denies is the second route allowed to carry
// a userId body key (the deny target) — everywhere else the TenantGuard
// treats it as an override attempt (F6 §7, the TenantGuard allowlist).
const AllowUserIdBody = () =>
  SetMetadata(ROUTE_ACCESS, {
    kind: 'workspace',
    allowUserIdKey: true,
  } satisfies RouteAccess);

@Controller('org/projects')
export class OrgProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Get() list(@Query() query: unknown) {
    return this.projects.listOrgProjects(
      currentTenantContext(),
      currentVerifiedIdentity(),
      query,
    );
  }

  @Get(':projectId/denies') denies(@Param('projectId') projectId: string) {
    return this.projects.listDenies(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(projectId),
    );
  }

  @Post(':projectId/denies')
  @AllowUserIdBody()
  addDeny(@Param('projectId') projectId: string, @Body() input: unknown) {
    return this.projects.addDeny(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(projectId),
      input,
    );
  }

  @Delete(':projectId/denies/:userId')
  @HttpCode(204)
  liftDeny(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.projects.liftDeny(
      currentTenantContext(),
      UuidSchema.parse(projectId),
      UuidSchema.parse(userId),
    );
  }
}
