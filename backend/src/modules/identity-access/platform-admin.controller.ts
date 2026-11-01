import { Body, Controller, HttpCode, Param, Patch } from '@nestjs/common';
import { z } from 'zod';
import { UuidSchema } from '@lexon/contracts';
import { PlatformRoute } from './route-access.js';
import { currentVerifiedIdentity } from './identity.types.js';
import { PlatformAdminService } from './platform-admin.service.js';
const inputSchema = z.strictObject({ disabled: z.boolean() });
@Controller('platform/users')
@PlatformRoute()
export class PlatformAdminController {
  constructor(private readonly platform: PlatformAdminService) {}
  @Patch(':userId/disabled') @HttpCode(204) disabled(
    @Param('userId') userId: string,
    @Body() input: unknown,
  ) {
    return this.platform.setDisabled(
      currentVerifiedIdentity(),
      UuidSchema.parse(userId),
      inputSchema.parse(input).disabled,
    );
  }
}
