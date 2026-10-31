import { TenantDatabase } from '../tenant-database.js';
import { inspectPool } from '../tenant-session.js';
import type { TenantContext } from '../authorization-predicate.js';

export async function unscopedProbe(options: {
  appUrl: string;
  reuseAfter?: TenantContext;
  rollback?: boolean;
}): Promise<unknown[]> {
  const db = new TenantDatabase({
    appUrl: options.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  try {
    if (options.reuseAfter) {
      try {
        await db.withTenant(options.reuseAfter, async () => {
          if (options.rollback) throw new Error('fixture rollback');
        });
      } catch (error) {
        if (!options.rollback) throw error;
      }
    }
    return (
      await inspectPool(db).query('SELECT id, value FROM app.tenant_fixture')
    ).rows;
  } finally {
    await db.close();
  }
}
