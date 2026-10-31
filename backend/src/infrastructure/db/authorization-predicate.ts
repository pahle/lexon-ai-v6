import { z } from 'zod';

export interface TenantContext {
  readonly orgId: string;
  readonly userId?: string;
}
const contextSchema = z.object({
  orgId: z.uuid(),
  userId: z.uuid().optional(),
});

export function validateTenantContext(ctx: TenantContext): TenantContext {
  const result = contextSchema.safeParse(ctx);
  if (!result.success)
    throw new Error(
      `Invalid tenant context: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return Object.freeze({
    orgId: result.data.orgId,
    ...(result.data.userId === undefined ? {} : { userId: result.data.userId }),
  });
}

export function buildAuthorizationPredicate(
  ctx: TenantContext,
): Readonly<{ orgId: string }> {
  return Object.freeze({ orgId: validateTenantContext(ctx).orgId });
}
