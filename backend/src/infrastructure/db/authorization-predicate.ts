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
export interface ChatReadAuthorizationScope {
  readonly scope: 'chat-read';
  readonly orgId: string;
  readonly userId: string;
  readonly excludeDeleted: true;
}
export interface SharedChatAuthorizationScope {
  readonly scope: 'shared-chat';
  readonly orgId: string;
  readonly userId: string;
  readonly excludeDeleted: true;
}
export type ChatAuthorizationScope =
  | OwnedChatAuthorizationScope
  | ChatReadAuthorizationScope
  | SharedChatAuthorizationScope;
export interface ChatAuthorizationPredicate {
  readonly orgId: string;
  readonly userId: string;
  readonly excludeDeleted: true;
  /** Emits the scope's SQL fragment against the given chats-table alias with
   * caller-supplied parameter placeholders so it composes into queries whose
   * parameter order differs. Every fragment comes from
   * `ops.lexon_org_member`/`ops.lexon_project_access`/`app.chat_shares` — no
   * repository hand-rolls project or share EXISTS clauses (F6 §4.1). */
  readonly where: (
    alias: string,
    orgParam: string,
    userParam: string,
  ) => string;
}
const contextSchema = z.object({
  orgId: z.uuid(),
  userId: z.uuid().optional(),
});
const chatScopeSchema = z
  .object({
    scope: z.enum(['owned-chat', 'chat-read', 'shared-chat']),
    orgId: z.uuid(),
    userId: z.uuid(),
    excludeDeleted: z.literal(true),
  })
  .strict();

// F6 §4.1 fragments. The alias is a fixed table alias supplied by the caller
// (never user input); the parameters are positional placeholders the caller
// binds to validated UUIDs. `ops.lexon_project_access` is claim-bound and
// checks the deny table before every role arm — deny wins on every fragment.
function ownedChatWhere(
  alias: string,
  orgParam: string,
  userParam: string,
): string {
  return (
    `${alias}.org_id=${orgParam} AND ${alias}.owner_user_id=${userParam} ` +
    `AND ${alias}.deleted_at IS NULL ` +
    `AND (${alias}.project_id IS NULL OR ` +
    `ops.lexon_project_access(${alias}.org_id,${alias}.project_id,${userParam})<>'none')`
  );
}

function chatReadWhere(
  alias: string,
  orgParam: string,
  userParam: string,
): string {
  return (
    `${alias}.org_id=${orgParam} AND ${alias}.deleted_at IS NULL ` +
    `AND ops.lexon_org_member(${alias}.org_id,${userParam}) ` +
    `AND ((${alias}.project_id IS NULL AND (${alias}.owner_user_id=${userParam} ` +
    `OR EXISTS (SELECT 1 FROM app.chat_shares s ` +
    `WHERE s.org_id=${alias}.org_id AND s.chat_id=${alias}.id ` +
    `AND s.user_id=${userParam}))) ` +
    `OR (${alias}.project_id IS NOT NULL ` +
    `AND ops.lexon_project_access(${alias}.org_id,${alias}.project_id,${userParam})<>'none'))`
  );
}

function sharedChatWhere(
  alias: string,
  orgParam: string,
  userParam: string,
): string {
  return (
    `${alias}.org_id=${orgParam} AND ${alias}.deleted_at IS NULL ` +
    `AND ${alias}.project_id IS NULL AND ${alias}.owner_user_id<>${userParam} ` +
    `AND EXISTS (SELECT 1 FROM app.chat_shares s ` +
    `WHERE s.org_id=${alias}.org_id AND s.chat_id=${alias}.id ` +
    `AND s.user_id=${userParam})`
  );
}

const CHAT_SCOPE_WHERE: Record<
  ChatAuthorizationScope['scope'],
  (alias: string, orgParam: string, userParam: string) => string
> = {
  'owned-chat': ownedChatWhere,
  'chat-read': chatReadWhere,
  'shared-chat': sharedChatWhere,
};

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
  scope: ChatAuthorizationScope,
): Readonly<ChatAuthorizationPredicate>;
export function buildAuthorizationPredicate(
  ctx: TenantContext | ChatAuthorizationScope,
): Readonly<{ orgId: string } | ChatAuthorizationPredicate> {
  if (!ctx || typeof ctx !== 'object')
    throw new Error('Invalid tenant context');
  if ('scope' in ctx) {
    const parsed = chatScopeSchema.safeParse(ctx);
    if (!parsed.success)
      throw new Error(
        `Invalid chat authorization scope: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
      );
    const where = CHAT_SCOPE_WHERE[parsed.data.scope];
    return Object.freeze({
      orgId: parsed.data.orgId,
      userId: parsed.data.userId,
      excludeDeleted: parsed.data.excludeDeleted,
      where,
    });
  }
  return Object.freeze({ orgId: validateTenantContext(ctx).orgId });
}
