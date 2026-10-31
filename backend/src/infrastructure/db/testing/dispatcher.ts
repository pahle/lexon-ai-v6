import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
interface Services {
  appUrl: string;
}
async function using<T>(
  services: Services,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: services.appUrl });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end();
  }
}
export async function inspectOutbox(services: Services, id: string) {
  return using(services, async (client) => {
    const result = await client.query<{
      sent: boolean;
      attempts: number;
      token: string | null;
      error: string | null;
      delayMs: number;
    }>(
      `SELECT sent_at IS NOT NULL AS sent,attempts,claim_token AS token,last_error_code AS error,(extract(epoch FROM (next_attempt_at - clock_timestamp()))*1000)::double precision AS "delayMs" FROM ops.outbox WHERE id=$1`,
      [id],
    );
    return result.rows[0]!;
  });
}
export async function insertRawOutbox(
  services: Services,
  options: { invalid?: boolean; notify?: boolean; rollback?: boolean } = {},
) {
  return using(services, async (client) => {
    const id = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO ops.outbox (id,type,org_id,payload) VALUES ($1,$2,$3,$4)',
      [
        id,
        'platform.noop.v1',
        randomUUID(),
        options.invalid
          ? { probeId: 'secret-content' }
          : { probeId: randomUUID() },
      ],
    );
    if (options.notify)
      await client.query("SELECT pg_notify('lexon_outbox','')");
    await client.query(options.rollback ? 'ROLLBACK' : 'COMMIT');
    return id;
  });
}
export async function terminateDispatcherLock(services: Services) {
  await using(services, async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=1279613007 AND objid=0 AND granted`,
    );
  });
}
export async function dispatcherConnections(
  services: Services,
): Promise<number> {
  return using(
    services,
    async (client) =>
      (
        await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name='lexon-dispatcher'`,
        )
      ).rows[0]!.count,
  );
}
