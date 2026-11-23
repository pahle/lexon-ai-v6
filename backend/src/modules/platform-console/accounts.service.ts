import { Injectable } from '@nestjs/common';
import {
  AccountInvitationsQuerySchema,
  PlatformAccountsQuerySchema,
  type AccountInvitationsPage,
  type PlatformAccountDetail,
  type PlatformAccountsPage,
} from '@lexon/contracts';
import {
  IdentityError,
  OrganizationAuthPort,
  type VerifiedIdentity,
} from '../identity-access/index.js';
import { PlatformConsoleRepository } from './platform-console.repository.js';

@Injectable()
export class AccountsService {
  constructor(
    private readonly port: OrganizationAuthPort,
    private readonly repository: PlatformConsoleRepository,
  ) {}
  list(
    identity: VerifiedIdentity,
    input: unknown,
  ): Promise<PlatformAccountsPage> {
    const { page, pageSize, ...filter } =
      PlatformAccountsQuerySchema.parse(input);
    return this.port.platformRead(identity, (tx) =>
      this.repository.accounts(tx, filter, { page, pageSize }),
    );
  }
  get(identity: VerifiedIdentity, id: string): Promise<PlatformAccountDetail> {
    return this.port.platformRead(identity, async (tx) => {
      const account = await this.repository.accountDetail(tx, id);
      if (!account) throw new IdentityError('NOT_FOUND', 404);
      return account;
    });
  }
  invitations(
    identity: VerifiedIdentity,
    input: unknown,
  ): Promise<AccountInvitationsPage> {
    const { page, pageSize, ...filter } =
      AccountInvitationsQuerySchema.parse(input);
    return this.port.platformRead(identity, (tx) =>
      this.repository.invitations(tx, filter, { page, pageSize }),
    );
  }
}
