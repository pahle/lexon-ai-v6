import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createAuthEngine } from './auth-factory.js';
import { createAuthTransactions } from './auth-transaction.js';
import * as schema from './auth-schema.js';
import type { AuthEngineOptions, AuthIntegration } from './auth-types.js';

// Infrastructure composition only. Neither this engine nor its context is
// returned by createAuthIntegration or exported through the database barrel.
export async function composeAuthIntegration(options: AuthEngineOptions) {
  const pool = new Pool({ connectionString: options.authUrl, max: 5 });
  try {
    const result = await pool.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (result.rows[0]?.current_user !== 'lexon_auth')
      throw new Error('Wrong auth database role');
    const transactions = createAuthTransactions(drizzle(pool, { schema }));
    const auth = createAuthEngine(
      {
        ...options,
        mail: {
          ...(options.mail.sendInvitation
            ? {
                sendInvitation: (
                  message: Parameters<
                    NonNullable<typeof options.mail.sendInvitation>
                  >[0],
                ) =>
                  transactions.afterCommit(() =>
                    options.mail.sendInvitation!(message),
                  ),
              }
            : {}),
          sendVerification: (message) =>
            transactions.afterCommit(() =>
              options.mail.sendVerification(message),
            ),
          sendPasswordReset: (message) =>
            transactions.afterCommit(() =>
              options.mail.sendPasswordReset(message),
            ),
        },
      },
      transactions.adapterFactory,
      transactions.accountLocks,
      transactions.securityPrimitives,
      transactions.organizationPrimitives,
      transactions.selectionPrimitives,
      transactions.provisioningPrimitives,
      transactions.adminSetupPrimitives,
    );
    await auth.$context;
    const transaction: AuthIntegration['transaction'] = (work) =>
      transactions.transaction(auth.api, work);
    let closing: Promise<void> | undefined;
    const integration: AuthIntegration = Object.freeze({
      transaction,
      // A Response may carry session cookies/tokens. It must remain private
      // until the real PostgreSQL COMMIT has succeeded.
      handle: async (request: Request) => {
        const rollback = new Error('Auth HTTP operation failed');
        let failedResponse: Response | undefined;
        try {
          return await transaction(async () => {
            const response = await auth.handler(request);
            if (response.status >= 400) {
              failedResponse = response;
              throw rollback;
            }
            return response;
          });
        } catch (error) {
          if (error === rollback && failedResponse) return failedResponse;
          throw error;
        }
      },
      close: () => (closing ??= pool.end()),
    });
    return { auth, integration };
  } catch {
    await pool.end();
    throw new Error('Auth integration initialization failed');
  }
}

export async function createAuthIntegration(
  options: AuthEngineOptions,
): Promise<AuthIntegration> {
  return (await composeAuthIntegration(options)).integration;
}
