import { z } from 'zod';

export interface TenantContext {
  readonly orgId: string;
  readonly userId?: string;
}
export interface OwnedChatAuthorizationScope {
  readonly scope: 'owned-chat';
  readonly orgId: string;
  readonly userId: string;
  readonly excludeDeleted: true;
}
const contextSchema = z.object({
  orgId: z.uuid(),
  userId: z.uuid().optional(),
});
const ownedChatScopeSchema = z
  .object({
    scope: z.literal('owned-chat'),
    orgId: z.uuid(),
    userId: z.uuid(),
    excludeDeleted: z.literal(true),
  })
  .strict();

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
): Readonly<{ orgId: string }>;
export function buildAuthorizationPredicate(
  scope: OwnedChatAuthorizationScope,
): Readonly<Omit<OwnedChatAuthorizationScope, 'scope'>>;
export function buildAuthorizationPredicate(
  ctx: TenantContext | OwnedChatAuthorizationScope,
): Readonly<{ orgId: string } | Omit<OwnedChatAuthorizationScope, 'scope'>> {
  if (!ctx || typeof ctx !== 'object')
    throw new Error('Invalid tenant context');
  if ('scope' in ctx) {
    const parsed = ownedChatScopeSchema.safeParse(ctx);
    if (!parsed.success)
      throw new Error(
        `Invalid owned chat scope: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
      );
    return Object.freeze({
      orgId: parsed.data.orgId,
      userId: parsed.data.userId,
      excludeDeleted: parsed.data.excludeDeleted,
    });
  }
  return Object.freeze({ orgId: validateTenantContext(ctx).orgId });
}
