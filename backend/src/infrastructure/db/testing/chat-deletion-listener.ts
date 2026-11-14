import { Client } from 'pg';

export async function chatDeletionListenerPids(
  appUrl: string,
): Promise<number[]> {
  const client = new Client({ connectionString: appUrl });
  try {
    await client.connect();
    const result = await client.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE datname=current_database() AND usename=current_user
         AND application_name='lexon-chat-deletion-events'`,
    );
    return result.rows.map((row) => row.pid);
  } finally {
    await client.end();
  }
}

export async function terminateChatDeletionListeners(
  appUrl: string,
): Promise<number> {
  const client = new Client({ connectionString: appUrl });
  try {
    await client.connect();
    const result = await client.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
       WHERE datname=current_database() AND usename=current_user
         AND application_name='lexon-chat-deletion-events'`,
    );
    return result.rows.filter((row) => row.terminated).length;
  } finally {
    await client.end();
  }
}
