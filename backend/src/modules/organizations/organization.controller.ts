import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CreateOrganizationInputSchema,
  OrganizationSettingsInputSchema,
  UuidSchema,
  ActiveOrganizationInputSchema,
} from '@lexon/contracts';
import {
  currentVerifiedIdentity,
  AccountRoute,
} from '../identity-access/index.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationSwitchService } from './organization-switch.service.js';

const querySchema = z
  .object({
    limit: z.coerce.number().optional(),
    cursor: UuidSchema.optional(),
  })
  .strict();
@Controller('organizations')
export class OrganizationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly switching: OrganizationSwitchService,
  ) {}
  @Get()
  @AccountRoute()
  list(@Query() input: unknown) {
    const query = querySchema.parse(input);
    return this.organizations.list(currentVerifiedIdentity(), {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  }
  @Post()
  @AccountRoute()
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
  @Post('active')
  @HttpCode(200)
  @AccountRoute({ allowOrganizationSelection: true })
  select(@Body() input: unknown) {
    return this.switching.select(
      currentVerifiedIdentity(),
      ActiveOrganizationInputSchema.parse(input).organizationId,
    );
  }
}
