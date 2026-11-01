import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CreateOrganizationInputSchema,
  OrganizationSettingsInputSchema,
  UuidSchema,
} from '@lexon/contracts';
import { currentVerifiedIdentity } from '../identity-access/index.js';
import { OrganizationService } from './organization.service.js';

const querySchema = z
  .object({
    limit: z.coerce.number().optional(),
    cursor: UuidSchema.optional(),
  })
  .strict();
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}
  @Get()
  list(@Query() input: unknown) {
    const query = querySchema.parse(input);
    return this.organizations.list(currentVerifiedIdentity(), {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  }
  @Post()
  create(@Body() input: unknown) {
    return this.organizations.create(
      currentVerifiedIdentity(),
      CreateOrganizationInputSchema.parse(input),
    );
  }
  @Patch(':organizationId/settings')
  settings(
    @Param('organizationId') organizationId: string,
    @Body() input: unknown,
  ) {
    return this.organizations.settings(
      currentVerifiedIdentity(),
      UuidSchema.parse(organizationId),
      OrganizationSettingsInputSchema.parse(input),
    );
  }
}
