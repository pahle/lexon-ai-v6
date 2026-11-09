import { Injectable } from '@nestjs/common';
import {
  UsageEventRepository,
  type UsageEventDescriptor,
  type UsageEventSettlement,
  type StepClaim,
  type TenantSession,
  type AttemptRecord,
} from '../../infrastructure/db/index.js';

@Injectable()
export class UsageEventsService {
  private readonly repository = new UsageEventRepository();

  reserve(
    tx: TenantSession,
    claim: StepClaim,
    attempt: AttemptRecord,
    descriptor: UsageEventDescriptor,
  ): Promise<void> {
    return this.repository.reserve(tx, claim, attempt, descriptor);
  }

  async metadata(
    tx: TenantSession,
    attemptId: string,
    metadata: { generationId: string; provider?: string },
  ): Promise<void> {
    if (!(await this.repository.metadata(tx, attemptId, metadata)))
      throw new Error('Usage event metadata unavailable');
  }

  settle(
    tx: TenantSession,
    attemptId: string,
    result: UsageEventSettlement,
  ): Promise<'recorded' | 'duplicate'> {
    return this.repository.settle(tx, attemptId, result);
  }

  markUnknown(tx: TenantSession, attemptId: string): Promise<void> {
    return this.repository.markUnknown(tx, attemptId);
  }
}
