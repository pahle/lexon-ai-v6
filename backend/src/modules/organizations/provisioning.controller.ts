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
import {
  ProvisioningInputSchema,
  EmailAddressSchema,
  UuidSchema,
} from '@lexon/contracts';
import {
  PlatformRoute,
  currentVerifiedIdentity,
} from '../identity-access/index.js';
import { ProvisioningService } from './provisioning.service.js';
const querySchema = z.strictObject({
  limit: z.coerce.number().optional(),
  cursor: UuidSchema.optional(),
});
const ownerSchema = z.strictObject({ ownerEmail: EmailAddressSchema });
@Controller('platform/provisioning')
@PlatformRoute()
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}
  @Post() create(@Body() input: unknown) {
    return this.provisioning.create(
      currentVerifiedIdentity(),
      ProvisioningInputSchema.parse(input),
    );
  }
  @Get() list(@Query() input: unknown) {
    const page = querySchema.parse(input);
    return this.provisioning.list(currentVerifiedIdentity(), {
      ...(page.limit !== undefined ? { limit: page.limit } : {}),
      ...(page.cursor ? { cursor: page.cursor } : {}),
    });
  }
  @Get(':organizationId') get(@Param('organizationId') id: string) {
    return this.provisioning.get(
      currentVerifiedIdentity(),
      UuidSchema.parse(id),
    );
  }
  @Delete(':organizationId') @HttpCode(204) cancel(
    @Param('organizationId') id: string,
  ) {
    return this.provisioning.cancel(
      currentVerifiedIdentity(),
      UuidSchema.parse(id),
    );
  }
  @Post(':organizationId/resend') @HttpCode(200) resend(
    @Param('organizationId') id: string,
  ) {
    return this.provisioning.resend(
      currentVerifiedIdentity(),
      UuidSchema.parse(id),
    );
  }
  @Patch(':organizationId/owner-email') replace(
    @Param('organizationId') id: string,
    @Body() input: unknown,
  ) {
    return this.provisioning.replaceOwnerEmail(
      currentVerifiedIdentity(),
      UuidSchema.parse(id),
      ownerSchema.parse(input).ownerEmail,
    );
  }
}
