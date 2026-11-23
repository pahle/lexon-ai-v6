import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import {
  PlatformRoute,
  currentVerifiedIdentity,
} from '../identity-access/index.js';
import { AccountInvitationsService } from './account-invitations.service.js';

@Controller('platform')
@PlatformRoute()
export class AccountInvitationsController {
  constructor(private readonly invitations: AccountInvitationsService) {}
  @Post('account-invitations') create(@Body() input: unknown) {
    return this.invitations.create(currentVerifiedIdentity(), input);
  }
  @Post('account-invitations/:id/resend') @HttpCode(204) resend(
    @Param('id') id: string,
  ) {
    return this.invitations.resend(
      currentVerifiedIdentity(),
      UuidSchema.parse(id),
    );
  }
  @Delete('account-invitations/:id') @HttpCode(204) cancel(
    @Param('id') id: string,
  ) {
    return this.invitations.cancel(
      currentVerifiedIdentity(),
      UuidSchema.parse(id),
    );
  }
}
