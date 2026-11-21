import { Pool, type PoolClient } from 'pg';

export type { Pool, PoolClient };

export const UUID = '00000000-0000-4000-8000-000000000001';

// Every function of migration 0040 with a call that is valid by signature.
export const platformFunctions: Record<
  string,
  { args: string; volatility: 's' | 'v' }
> = {
  lexon_platform_accounts: {
    args: `NULL::text,NULL::text[],NULL::boolean[],10,0`,
    volatility: 's',
  },
  lexon_platform_accounts_total: {
    args: `NULL::text,NULL::text[],NULL::boolean[]`,
    volatility: 's',
  },
  lexon_platform_account: { args: `'${UUID}'::uuid`, volatility: 's' },
  lexon_platform_account_teams: { args: `'${UUID}'::uuid`, volatility: 's' },
  lexon_platform_organizations: {
    args: `NULL::text,NULL::text[],10,0`,
    volatility: 's',
  },
  lexon_platform_organizations_total: {
    args: `NULL::text,NULL::text[]`,
    volatility: 's',
  },
  lexon_platform_organization: { args: `'${UUID}'::uuid`, volatility: 's' },
  lexon_platform_members: { args: `'${UUID}'::uuid,10,0`, volatility: 's' },
  lexon_platform_members_total: { args: `'${UUID}'::uuid`, volatility: 's' },
  lexon_platform_account_invitations: {
    args: `NULL::text,NULL::text[],10,0`,
    volatility: 's',
  },
  lexon_platform_account_invitations_total: {
    args: `NULL::text,NULL::text[]`,
    volatility: 's',
  },
  lexon_platform_lock_enabled_admins: { args: ``, volatility: 'v' },
  lexon_create_account_invitation: {
    args: `'a@example.test','A','digest-x','${UUID}'::uuid`,
    volatility: 'v',
  },
  lexon_resend_account_invitation: {
    args: `'${UUID}'::uuid,'digest-y'`,
    volatility: 'v',
  },
  lexon_cancel_account_invitation: { args: `'${UUID}'::uuid`, volatility: 'v' },
  lexon_account_invitation_signup_facts: {
    args: `'digest-x'`,
    volatility: 's',
  },
  lexon_accept_account_invitation: {
    args: `'digest-x','${UUID}'::uuid`,
    volatility: 'v',
  },
};

/** One pool per role used by the platform console tests. */
export function createPlatformPools(urls: {
  appUrl: string;
  authUrl: string;
  migratorUrl: string;
}) {
  const app = new Pool({ connectionString: urls.appUrl });
  const auth = new Pool({ connectionString: urls.authUrl });
  const migrator = new Pool({ connectionString: urls.migratorUrl });
  return {
    app,
    auth,
    migrator,
    async close() {
      await Promise.all([app.end(), auth.end(), migrator.end()]);
    },
  };
}
