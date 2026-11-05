export interface StepClaim {
  readonly runId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly sequence: number;
  readonly expectedVersion: number;
  readonly fence: number;
  readonly leaseUntil: Date;
}
