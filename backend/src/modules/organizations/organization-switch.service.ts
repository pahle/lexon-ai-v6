import { Injectable } from '@nestjs/common';
import type {
  OrganizationSelectionPort,
  VerifiedIdentity,
} from '../identity-access/index.js';
import type { SwitchResult } from '@lexon/contracts';
@Injectable()
export class OrganizationSwitchService {
  constructor(private readonly selections: OrganizationSelectionPort) {}
  select(
    identity: VerifiedIdentity,
    organizationId: string,
  ): Promise<SwitchResult> {
    return this.selections.select(identity, organizationId);
  }
}
