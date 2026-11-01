import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ProfileInputSchema } from '@lexon/contracts';
import { AccountService } from './account.service.js';
import { currentVerifiedIdentity } from './identity.types.js';
import { AccountRoute } from './route-access.js';

@Controller('identity')
@AccountRoute()
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Get('profile')
  profile() {
    return this.accounts.profile(currentVerifiedIdentity());
  }

  @Patch('profile')
  update(@Body() input: unknown) {
    return this.accounts.updateProfile(
      currentVerifiedIdentity(),
      ProfileInputSchema.parse(input),
    );
  }

  @Post('onboarding/complete')
  @HttpCode(204)
  complete() {
    return this.accounts.completeOnboarding(currentVerifiedIdentity());
  }
}
