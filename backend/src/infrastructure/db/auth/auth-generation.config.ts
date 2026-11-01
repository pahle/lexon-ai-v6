import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { createAuthEngine } from './auth-factory.js';

// Generation is offline; this connection is never opened. No runtime secret here.
export const auth = createAuthEngine(
  {
    authUrl: 'postgresql://localhost/lexon_schema_generation',
    origin: 'http://localhost:3000',
    secret: 'schema-generation-only-not-a-runtime-secret',
    mail: {
      sendVerification: async () => {},
      sendPasswordReset: async () => {},
    },
  },
  drizzleAdapter(drizzle('postgresql://localhost/lexon_schema_generation'), {
    provider: 'pg',
    schemaName: 'auth',
    transaction: true,
  }),
);
