import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
export {
  bootstrapDatabase,
  configureRuntimeRolePasswords,
} from '../bootstrap.js';
export { migrateDatabase } from '../migrate.js';

export function roleUrl(
  base: string,
  role: string,
  password: string,
  database: string,
): string {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}
export async function cloneDatabase(
  adminUrl: string,
  template: string,
  database: string,
): Promise<void> {
  if (
    ![template, database].every((name) => /^[a-z][a-z0-9_]{0,62}$/.test(name))
  )
    throw new Error('Invalid fixture database name');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(
      `CREATE DATABASE "${database}" TEMPLATE "${template}" OWNER lexon_migrator`,
    );
  } finally {
    await client.end();
  }
}
export async function dropDatabase(
  adminUrl: string,
  database: string,
): Promise<void> {
  if (!/^lexon_test_[a-f0-9]+$/.test(database))
    throw new Error('Refusing to drop an unowned database');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

export async function reapplyChatMutation0032ForUpgradeTest(
  migratorUrl: string,
): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    const role = await client.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (role.rows[0]?.current_user !== 'lexon_migrator')
      throw new Error('Wrong migration test role');
    const journal = JSON.parse(
      await readFile(
        new URL('../../../../drizzle/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: Array<{ tag: string; when: number }> };
    const migration = journal.entries.find(
      (entry) => entry.tag === '0032_chat_mutation_requests',
    );
    if (!migration) throw new Error('Migration 0032 journal entry missing');
    const sql = await readFile(
      new URL(
        '../../../../drizzle/0032_chat_mutation_requests.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await client.query('BEGIN');
    const receiptTable = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('app.chat_mutation_requests') IS NOT NULL AS exists",
    );
    if (!receiptTable.rows[0]?.exists)
      throw new Error('Migration 0032 receipt table is unavailable');
    await client.query('DROP TABLE app.chat_mutation_requests');
    const removed = await client.query(
      'DELETE FROM drizzle.__drizzle_migrations WHERE created_at=$1::bigint',
      [migration.when],
    );
    if (removed.rowCount !== 1)
      throw new Error('Expected to remove the 0032 migration journal row');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function chatMutationSendReceiptRows(
  migratorUrl: string,
  requestIds: readonly string[],
): Promise<
  Array<{
    request_id: string;
    chat_id: string;
    user_message_id: string;
    assistant_message_id: string;
  }>
> {
  const client = new Client({ connectionString: migratorUrl });
  try {
    await client.connect();
    const role = await client.query<{ current_user: string }>(
      'SELECT current_user',
    );
    if (role.rows[0]?.current_user !== 'lexon_migrator')
      throw new Error('Wrong migration test role');
    const result = await client.query<{
      request_id: string;
      chat_id: string;
      user_message_id: string;
      assistant_message_id: string;
    }>(
      `SELECT request_id,chat_id,user_message_id,assistant_message_id
       FROM app.chat_mutation_requests
       WHERE mutation_kind='send' AND request_id=ANY($1::uuid[])
       ORDER BY chat_id,user_message_id`,
      [requestIds],
    );
    return result.rows;
  } finally {
    await client.end();
  }
}
