import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
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

// POST /projects/:id/members is the single route allowed to carry a userId
// body key (the member-add target) — everywhere else the TenantGuard treats
// it as an override attempt (F6 §11, the TenantGuard allowlist).
const AllowUserIdBody = () =>
  SetMetadata(ROUTE_ACCESS, {
    kind: 'workspace',
    allowUserIdKey: true,
  } satisfies RouteAccess);

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Post() create(@Body() input: unknown) {
    return this.projects.create(
      currentTenantContext(),
      currentVerifiedIdentity(),
      input,
    );
  }

  @Get() list(@Query() query: unknown) {
    return this.projects.list(
      currentTenantContext(),
      currentVerifiedIdentity(),
      query,
    );
  }

  @Get(':projectId') detail(@Param('projectId') projectId: string) {
    return this.projects.detail(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(projectId),
    );
  }

  @Delete(':projectId')
  @HttpCode(204)
  remove(@Param('projectId') projectId: string, @Body() input: unknown) {
    return this.projects.remove(
      currentTenantContext(),
      UuidSchema.parse(projectId),
      input,
    );
  }

  @Patch(':projectId') settings(
    @Param('projectId') projectId: string,
    @Body() input: unknown,
  ) {
    return this.projects.updateSettings(
      currentTenantContext(),
      UuidSchema.parse(projectId),
      input,
    );
  }

  @Patch(':projectId/instructions') instructions(
    @Param('projectId') projectId: string,
    @Body() input: unknown,
  ) {
    return this.projects.updateInstructions(
      currentTenantContext(),
      UuidSchema.parse(projectId),
      input,
    );
  }

  @Get(':projectId/chats') chats(@Param('projectId') projectId: string) {
    return this.projects.listChats(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(projectId),
    );
  }

  @Get(':projectId/members') members(@Param('projectId') projectId: string) {
    return this.projects.listMembers(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(projectId),
    );
  }

  @Post(':projectId/members')
  @AllowUserIdBody()
  addMember(@Param('projectId') projectId: string, @Body() input: unknown) {
    return this.projects.addMember(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(projectId),
      input,
    );
  }

  @Patch(':projectId/members/:userId') memberRole(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body() input: unknown,
  ) {
    return this.projects.updateMemberRole(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(projectId),
      UuidSchema.parse(userId),
      input,
    );
  }

  @Delete(':projectId/members/:userId')
  @HttpCode(204)
  removeMember(
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.projects.removeMember(
      currentTenantContext(),
      UuidSchema.parse(projectId),
      UuidSchema.parse(userId),
    );
  }
}
