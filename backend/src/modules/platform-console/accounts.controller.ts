import { Controller, Get, Param, Query } from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import {
  PlatformRoute,
  currentVerifiedIdentity,
} from '../identity-access/index.js';
import { AccountsService } from './accounts.service.js';

@Controller('platform')
@PlatformRoute()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}
  @Get('accounts') list(@Query() query: unknown) {
    return this.accounts.list(currentVerifiedIdentity(), query);
  }
  @Get('accounts/:userId') get(@Param('userId') id: string) {
    return this.accounts.get(currentVerifiedIdentity(), UuidSchema.parse(id));
  }
  @Get('account-invitations') invitations(@Query() query: unknown) {
    return this.accounts.invitations(currentVerifiedIdentity(), query);
  }
}
