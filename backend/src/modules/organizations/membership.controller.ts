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
import { z } from 'zod';
import { OrgRoleSchema, UuidSchema } from '@lexon/contracts';
import { currentVerifiedIdentity } from '../identity-access/index.js';
import { MembershipService } from './membership.service.js';
const roleSchema = z.strictObject({ role: OrgRoleSchema });
const querySchema = z.strictObject({
  limit: z.coerce.number().optional(),
  cursor: UuidSchema.optional(),
});
@Controller('organizations/:organizationId')
export class MembershipController {
  constructor(private readonly memberships: MembershipService) {}
  @Get('members') list(
    @Param('organizationId') orgId: string,
    @Query() input: unknown,
  ) {
    const page = querySchema.parse(input);
    return this.memberships.list(
      currentVerifiedIdentity(),
      UuidSchema.parse(orgId),
      {
        ...(page.limit !== undefined ? { limit: page.limit } : {}),
        ...(page.cursor ? { cursor: page.cursor } : {}),
      },
    );
  }
  @Patch('members/:memberId') role(
    @Param('organizationId') orgId: string,
    @Param('memberId') memberId: string,
    @Body() input: unknown,
  ) {
    return this.memberships.changeRole(
      currentVerifiedIdentity(),
      UuidSchema.parse(orgId),
      UuidSchema.parse(memberId),
      roleSchema.parse(input).role,
    );
  }
  @Delete('members/:memberId') @HttpCode(204) remove(
    @Param('organizationId') orgId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.memberships.remove(
      currentVerifiedIdentity(),
      UuidSchema.parse(orgId),
      UuidSchema.parse(memberId),
    );
  }
  @Post('leave') @HttpCode(204) leave(@Param('organizationId') orgId: string) {
    return this.memberships.leave(
      currentVerifiedIdentity(),
      UuidSchema.parse(orgId),
    );
  }
}
