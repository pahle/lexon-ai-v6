import { Client } from 'pg';

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
