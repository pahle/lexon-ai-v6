import { pathToFileURL } from 'node:url';
import pino from 'pino';
import {
  bootstrapDatabase,
  configureRuntimeRolePasswords,
} from './bootstrap.js';
import { migrateDatabase } from './migrate.js';
export async function runDatabaseSetup(
  command: string | undefined,
  env: Record<string, string | undefined>,
): Promise<void> {
  const value = (key: string) => {
    if (!env[key]) throw new Error('Missing database setup configuration');
    return env[key];
  };
  if (command === 'bootstrap')
    await bootstrapDatabase({
      adminUrl: value('DATABASE_ADMIN_URL'),
      databaseName: value('DATABASE_NAME'),
      migratorPassword: value('DATABASE_MIGRATOR_PASSWORD'),
    });
  else if (command === 'migrate') {
    const url = value('DATABASE_MIGRATOR_URL');
    await migrateDatabase(url);
    await configureRuntimeRolePasswords(url, {
      appPassword: value('DATABASE_APP_PASSWORD'),
      authPassword: value('DATABASE_AUTH_PASSWORD'),
      ...(env.DATABASE_SETUP_PASSWORD
        ? { setupPassword: value('DATABASE_SETUP_PASSWORD') }
        : {}),
    });
  } else throw new Error('Invalid database setup command');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runDatabaseSetup(process.argv[2], process.env);
  } catch {
    pino({ base: { operation: 'database_setup' } }).error({
      event: 'setup_failed',
    });
    process.exitCode = 1;
  }
}
