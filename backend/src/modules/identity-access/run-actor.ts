declare const runActorBrand: unique symbol;

export type RunActor = Readonly<{
  orgId: string;
  userId: string;
  [runActorBrand]: true;
}>;

export function createRunActor(orgId: string, userId: string): RunActor {
  return Object.freeze({ orgId, userId }) as RunActor;
}
