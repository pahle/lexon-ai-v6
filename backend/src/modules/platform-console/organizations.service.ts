import { Injectable } from '@nestjs/common';
import {
  NumberedPageQuerySchema,
  PlatformOrganizationsQuerySchema,
  type PlatformMembersPage,
  type PlatformOrganizationDetail,
  type PlatformOrganizationsPage,
} from '@lexon/contracts';
import {
  IdentityError,
  OrganizationAuthPort,
  type VerifiedIdentity,
} from '../identity-access/index.js';
import { PlatformConsoleRepository } from './platform-console.repository.js';

@Injectable()
export class PlatformOrganizationsService {
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly repository: PlatformConsoleRepository,
  ) {}
  list(
    identity: VerifiedIdentity,
    input: unknown,
  ): Promise<PlatformOrganizationsPage> {
    const { page, pageSize, ...filter } =
      PlatformOrganizationsQuerySchema.parse(input);
    return this.port.platformRead(identity, (tx) =>
      this.repository.organizations(tx, filter, { page, pageSize }),
    );
  }
  get(
    identity: VerifiedIdentity,
    id: string,
  ): Promise<PlatformOrganizationDetail> {
    return this.port.platformRead(identity, async (tx) => {
      const organization = await this.repository.organization(tx, id);
      if (!organization) throw new IdentityError('NOT_FOUND', 404);
      return organization;
    });
  }
  members(
    identity: VerifiedIdentity,
    id: string,
    input: unknown,
  ): Promise<PlatformMembersPage> {
    const page = NumberedPageQuerySchema.parse(input);
    return this.port.platformRead(identity, async (tx) => {
      const organization = await this.repository.organization(tx, id);
      if (!organization) throw new IdentityError('NOT_FOUND', 404);
      // Provisioning organizations have no members yet.
      if (organization.state !== 'active')
        return {
          items: [],
          page: page.page,
          pageSize: page.pageSize,
          total: 0,
        };
      return this.repository.members(tx, id, page);
    });
  }
}
