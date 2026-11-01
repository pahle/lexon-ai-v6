import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ReauthenticateInputSchema } from '@lexon/contracts';
import { SecurityService } from './security.service.js';
import { currentVerifiedIdentity } from './identity.types.js';
import { AccountRoute } from './route-access.js';

@Controller('identity/security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}
  @Get()
  @AccountRoute({ allowIncompleteMfa: true })
  state() {
    return this.security.state(currentVerifiedIdentity());
  }
  @Post('reauthenticate')
  @AccountRoute({ allowIncompleteMfa: true })
  @HttpCode(204)
  reauthenticate(@Body() input: unknown) {
    return this.security.reauthenticate(
      currentVerifiedIdentity(),
      ReauthenticateInputSchema.parse(input),
    );
  }
}
