import { Controller, Get } from '@nestjs/common';
import { AccountRoute } from './route-access.js';
import { RequestIdentity } from './request-identity.js';
@Controller('identity')
@AccountRoute()
export class IdentityController {
  constructor(private readonly identities: RequestIdentity) {}
  @Get() summary() {
    return this.identities.summary();
  }
}
