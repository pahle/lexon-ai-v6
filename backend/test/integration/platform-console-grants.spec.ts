import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  createPlatformPools,
  platformFunctions,
} from '../../src/infrastructure/db/testing/platform-console-fixture.js';

test('lexon_app cannot execute any platform console function', async ({
  services,
}) => {
  expect(Object.keys(platformFunctions)).toHaveLength(17);
  const pools = createPlatformPools(services);
  const app = pools.app;
  try {
    for (const [name, { args }] of Object.entries(platformFunctions)) {
      await expect(
        app.query(`SELECT * FROM auth.${name}(${args})`),
        name,
      ).rejects.toMatchObject({ code: '42501' });
    }
  } finally {
    await pools.close();
  }
});

test('lexon_app cannot select lexon_account_invitation and holds no privilege on it', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const app = pools.app;
  try {
    await expect(
      app.query('SELECT * FROM auth.lexon_account_invitation'),
    ).rejects.toMatchObject({ code: '42501' });
    // 0004 already grants lexon_app USAGE on schema auth (column-level reads);
    // the new table must stay closed to it at every privilege.
    const table = await app.query<{ ok: boolean }>(
      `SELECT bool_or(has_table_privilege('lexon_app','auth.lexon_account_invitation',p)) AS ok
       FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`,
    );
    expect(table.rows[0]!.ok).toBe(false);
  } finally {
    await pools.close();
  }
});

test('lexon_auth reaches the invitation table only through functions', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const auth = pools.auth;
  try {
    await expect(
      auth.query('SELECT * FROM auth.lexon_account_invitation'),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await pools.close();
  }
});

test('PUBLIC has no execute, lexon_auth has execute, volatility is as owner-fixed', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const migrator = pools.migrator;
  try {
    const rows = (
      await migrator.query<{
        proname: string;
        pub: boolean;
        auth: boolean;
        provolatile: string;
      }>(
        `SELECT p.proname, has_function_privilege('public',p.oid,'EXECUTE') AS pub,
                has_function_privilege('lexon_auth',p.oid,'EXECUTE') AS auth, p.provolatile
         FROM pg_proc p WHERE p.pronamespace='auth'::regnamespace AND p.proname = ANY($1)`,
        [Object.keys(platformFunctions)],
      )
    ).rows;
    expect(rows).toHaveLength(17);
    for (const row of rows) {
      expect(row.pub, row.proname).toBe(false);
      expect(row.auth, row.proname).toBe(true);
      expect(row.provolatile, row.proname).toBe(
        platformFunctions[row.proname]!.volatility,
      );
    }
  } finally {
    await pools.close();
  }
});
