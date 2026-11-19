import { expect } from 'vitest';
import { Pool } from 'pg';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';

// A-17: every table in the `app` schema is tenant-fenced.
async function appTables(migrator: Pool): Promise<string[]> {
  return (
    await migrator.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='app' AND c.relkind='r' ORDER BY c.relname`,
    )
  ).rows.map((row) => row.relname);
}

test('every app table has row-level security enabled and forced', async ({
  services,
}) => {
  const migrator = new Pool({ connectionString: services.migratorUrl });
  try {
    const rows = (
      await migrator.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='app' AND c.relkind='r'`,
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.filter((row) => !row.relrowsecurity || !row.relforcerowsecurity),
    ).toEqual([]);
  } finally {
    await migrator.end();
  }
});

test('an app connection without the tenant GUC sees no rows in any app table', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const migrator = new Pool({ connectionString: services.migratorUrl });
  const app = new Pool({ connectionString: services.appUrl });
  try {
    // Seed through the fixture (owner-side setup) so the zero counts are not vacuous.
    for (let org = 0; org < 2; org++) await ai.start(org);
    const tables = await appTables(migrator);
    const owned: Record<string, number> = {};
    const visible: Record<string, number> = {};
    for (const table of tables) {
      const count = async (pool: Pool) =>
        Number(
          (
            await pool.query<{ count: string }>(
              `SELECT count(*) FROM app."${table}"`,
            )
          ).rows[0]!.count,
        );
      owned[table] = await count(migrator);
      visible[table] = await count(app);
    }
    expect(owned['ai_runs']).toBeGreaterThan(0);
    expect(Object.values(visible).filter((n) => n > 0)).toEqual([]);
  } finally {
    await Promise.all([ai.close(), migrator.end(), app.end()]);
  }
});
