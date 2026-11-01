import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { InvitationInputSchema, UuidSchema } from '@lexon/contracts';
import {
  AccountRoute,
  currentVerifiedIdentity,
} from '../identity-access/index.js';
import { InvitationService } from './invitation.service.js';
const querySchema = z
  .object({
    limit: z.coerce.number().optional(),
    cursor: UuidSchema.optional(),
  })
  .strict();
function page(input: unknown) {
  const query = querySchema.parse(input);
  return {
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
  };
}
@Controller('organizations/:organizationId/invitations')
export class OrganizationInvitationController {
  constructor(private readonly invitations: InvitationService) {}
  @Get() list(
    @Param('organizationId') organizationId: string,
    @Query() query: unknown,
  ) {
    return this.invitations.listForOrganization(
      currentVerifiedIdentity(),
      UuidSchema.parse(organizationId),
      page(query),
    );
  }
  @Post() create(
    @Param('organizationId') organizationId: string,
    @Body() input: unknown,
  ) {
    return this.invitations.create(
      currentVerifiedIdentity(),
      UuidSchema.parse(organizationId),
      InvitationInputSchema.parse(input),
    );
  }
}
@Controller('invitations/:invitationId')
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}
  @Post('resend') @HttpCode(200) resend(
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.resend(
      currentVerifiedIdentity(),
      UuidSchema.parse(invitationId),
    );
  }
  @Post('cancel') @HttpCode(200) cancel(
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.cancel(
      currentVerifiedIdentity(),
      UuidSchema.parse(invitationId),
    );
  }
  @Post('decline') @HttpCode(200) @AccountRoute() decline(
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.decline(
      currentVerifiedIdentity(),
      UuidSchema.parse(invitationId),
    );
  }
  @Post('accept') @HttpCode(200) @AccountRoute() accept(
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.accept(
      currentVerifiedIdentity(),
      UuidSchema.parse(invitationId),
    );
  }
}
@Controller('identity/invitations')
@AccountRoute()
export class RecipientInvitationController {
  constructor(private readonly invitations: InvitationService) {}
  @Get() list(@Query() query: unknown) {
    return this.invitations.listMine(currentVerifiedIdentity(), page(query));
  }
}
