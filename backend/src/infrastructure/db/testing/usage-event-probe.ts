import { TenantDatabase } from '../tenant-database.js';
import { inspectPool } from '../tenant-session.js';
import type { TenantContext } from '../authorization-predicate.js';

export async function unscopedUsageEventProbe(input: {
  appUrl: string;
  attemptId: string;
  reuseAfter?: TenantContext;
}): Promise<string[]> {
  const db = new TenantDatabase({
    appUrl: input.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10_000,
  });
  try {
    if (input.reuseAfter)
      await db.withTenant(input.reuseAfter, async () => undefined);
    const result = await inspectPool(db).query<{ attempt_id: string }>(
      'SELECT attempt_id FROM app.usage_events WHERE attempt_id=$1',
      [input.attemptId],
    );
    return result.rows.map((row) => row.attempt_id);
  } finally {
    await db.close();
  }
}
