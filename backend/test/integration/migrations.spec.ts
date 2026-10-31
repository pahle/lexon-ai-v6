import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { inspectFoundation } from '../../src/infrastructure/db/testing/inspect.js';
import { migrateDatabase } from '../../src/infrastructure/db/testing/provision.js';

test('migrates as non-superuser owner with isolated application roles', async ({
  services,
}) => {
  const before = await inspectFoundation(services);
  expect(before.schemas).toEqual([
    { name: 'app', owner: 'lexon_migrator' },
    { name: 'auth', owner: 'lexon_migrator' },
    { name: 'ops', owner: 'lexon_migrator' },
  ]);
  expect(before.extension).toBe(true);
  expect(before.roles).toEqual([
    {
      name: 'lexon_app',
      superuser: false,
      bypassRls: false,
      createRole: false,
    },
    {
      name: 'lexon_auth',
      superuser: false,
      bypassRls: false,
      createRole: false,
    },
    {
      name: 'lexon_migrator',
      superuser: false,
      bypassRls: false,
      createRole: true,
    },
  ]);
  expect(before.appCanAssumeMigrator).toBe(false);
  expect(before.appCanAssumeAuth).toBe(false);
  expect(before.appAuthUsage).toBe(true);
  await migrateDatabase(services.migratorUrl);
  expect((await inspectFoundation(services)).migrationCount).toBe(
    before.migrationCount,
  );
});
