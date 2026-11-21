import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { z } from 'zod';

export const PLATFORM_READ_NAMES = [
  'accounts',
  'accountsTotal',
  'account',
  'accountTeams',
  'organizations',
  'organizationsTotal',
  'organization',
  'members',
  'membersTotal',
  'invitations',
  'invitationsTotal',
] as const;
export type PlatformReadName = (typeof PLATFORM_READ_NAMES)[number];
export type PlatformReadParam =
  string | number | boolean | null | (string | boolean)[];
export interface PlatformReadPrimitives {
  run(
    name: PlatformReadName,
    params: PlatformReadParam[],
  ): Promise<Record<string, unknown>[]>;
}
const param = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.boolean()])),
]);
export function platformReadPlugin(primitives: PlatformReadPrimitives) {
  return {
    id: 'lexon-platform-read',
    endpoints: {
      lexonPlatformRead: createAuthEndpoint(
        '/lexon/platform/read',
        {
          method: 'POST',
          metadata: { scope: 'server' },
          body: z.strictObject({
            name: z.enum(PLATFORM_READ_NAMES),
            params: z.array(param).max(5),
          }),
        },
        async (ctx) => ({
          rows: await primitives.run(ctx.body.name, ctx.body.params),
        }),
      ),
    },
  } satisfies BetterAuthPlugin;
}
