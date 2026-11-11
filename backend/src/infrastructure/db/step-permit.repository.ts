import type { StepClaim } from './ai-records.js';
import { AiStepRepository } from './ai-step.repository.js';
import { TenantDatabase } from './tenant-database.js';
import { requireSession, type TenantSession } from './tenant-session.js';

export interface StepPermitOwner {
  readonly orgId: string;
  readonly slot: number;
  readonly ownerToken: string;
}

export interface StepPermitReference extends StepPermitOwner {
  readonly runId: string;
  readonly sequence: number;
  readonly expectedVersion: number;
  readonly stepId: string;
  readonly fence: number;
}

interface PermitRow extends StepPermitReference {
  userId: string;
}

export class StepPermitReferenceRepository {
  private readonly steps = new AiStepRepository();

  constructor(private readonly database?: TenantDatabase) {}

  async record(owner: StepPermitOwner, claim: StepClaim): Promise<void> {
    if (
      owner.orgId !== claim.orgId ||
      !Number.isSafeInteger(owner.slot) ||
      owner.slot < 0 ||
      owner.slot > 1 ||
      !/^[0-9a-f-]{36}$/i.test(owner.ownerToken)
    )
      throw new Error('Invalid step permit reference');
    if (!this.database) throw new Error('Permit reference database required');
    await this.database.withTenant(
      { orgId: claim.orgId, userId: claim.userId },
      async (tx) => {
        await this.steps.lockTenantClaimGuard(tx);
        if (!(await this.steps.lockClaim(tx, claim)))
          throw new Error('AI step claim lost');
        const { client } = requireSession(tx);
        await client.query(
          `DELETE FROM app.ai_step_permit_references
           WHERE org_id=$1 AND user_id=$2 AND run_id=$3 AND sequence=$4`,
          [claim.orgId, claim.userId, claim.runId, claim.sequence],
        );
        await client.query(
          `INSERT INTO app.ai_step_permit_references
           (org_id,user_id,run_id,sequence,expected_version,step_id,fence,slot,owner_token)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            claim.orgId,
            claim.userId,
            claim.runId,
            claim.sequence,
            claim.expectedVersion,
            claim.stepId,
            claim.fence,
            owner.slot,
            owner.ownerToken,
          ],
        );
      },
    );
  }

  async releaseRecord(
    tx: TenantSession,
    reference: StepPermitReference,
  ): Promise<void> {
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId || ctx.orgId !== reference.orgId) return;
    await client.query(
      `DELETE FROM app.ai_step_permit_references
       WHERE org_id=$1 AND user_id=$2 AND run_id=$3 AND sequence=$4
         AND expected_version=$5 AND step_id=$6 AND fence=$7 AND slot=$8 AND owner_token=$9`,
      [
        reference.orgId,
        ctx.userId,
        reference.runId,
        reference.sequence,
        reference.expectedVersion,
        reference.stepId,
        reference.fence,
        reference.slot,
        reference.ownerToken,
      ],
    );
  }

  async remove(owner: StepPermitOwner, claim: StepClaim): Promise<void> {
    if (!this.database) throw new Error('Permit reference database required');
    await this.database.withTenant(
      { orgId: claim.orgId, userId: claim.userId },
      (tx) =>
        this.releaseRecord(tx, {
          ...owner,
          runId: claim.runId,
          sequence: claim.sequence,
          expectedVersion: claim.expectedVersion,
          stepId: claim.stepId,
          fence: claim.fence,
        }),
    );
  }

  async listForRuns(
    tx: TenantSession,
    runIds: readonly string[],
  ): Promise<readonly StepPermitReference[]> {
    if (!runIds.length) return [];
    const { client, ctx } = requireSession(tx);
    if (!ctx.userId) return [];
    const result = await client.query<PermitRow>(
      `SELECT org_id AS "orgId",run_id AS "runId",sequence,
        expected_version AS "expectedVersion",step_id AS "stepId",fence,slot,
        owner_token AS "ownerToken",user_id AS "userId"
       FROM app.ai_step_permit_references
       WHERE org_id=$1 AND user_id=$2 AND run_id=ANY($3::uuid[])
       ORDER BY run_id,sequence`,
      [ctx.orgId, ctx.userId, runIds],
    );
    return result.rows.map((row) => {
      const { fence, userId } = row;
      void userId;
      const reference = {
        orgId: row.orgId,
        runId: row.runId,
        sequence: row.sequence,
        expectedVersion: row.expectedVersion,
        stepId: row.stepId,
        slot: row.slot,
        ownerToken: row.ownerToken,
      };
      const numericFence = Number(fence);
      if (!Number.isSafeInteger(numericFence) || numericFence < 1)
        throw new Error('Invalid persisted permit fence');
      return { ...reference, fence: numericFence };
    });
  }
}
