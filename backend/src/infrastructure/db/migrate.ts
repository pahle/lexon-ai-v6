import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export async function migrateDatabase(migratorUrl: string): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    const role = await client.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (role.rows[0]?.current_user !== 'lexon_migrator')
      throw new Error('Wrong migration role');
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(
        new URL('../../../drizzle/', import.meta.url),
      ),
    });
  } catch {
    throw new Error('Database migration failed');
  } finally {
    await client.end();
  }
}
