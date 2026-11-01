import { Body, Controller, HttpCode, Post, Header } from '@nestjs/common';
import { z } from 'zod';
import { FlowTokenSchema } from '@lexon/contracts';
import { AdminSetupService } from './admin-setup.service.js';
import { PublicRoute, AccountRoute } from './route-access.js';
import { currentVerifiedIdentity } from './identity.types.js';
const proofSchema = z.strictObject({ token: FlowTokenSchema });
@Controller('identity/admin-setup')
export class AdminSetupController {
  constructor(private readonly setup: AdminSetupService) {}
  @Post('redeem')
  @PublicRoute()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  redeem(@Body() body: unknown) {
    return this.setup.redeem(proofSchema.parse(body).token);
  }
  @Post('complete') @AccountRoute() @HttpCode(204) complete(
    @Body() body: unknown,
  ) {
    return this.setup.complete(
      currentVerifiedIdentity(),
      proofSchema.parse(body).token,
    );
  }
}
