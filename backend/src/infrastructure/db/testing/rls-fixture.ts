import { Pool } from 'pg';

/** A-17 catalog and no-context checks over every table in the app schema. */
export function createRlsInspector(options: {
  appUrl: string;
  migratorUrl: string;
}) {
  const app = new Pool({ connectionString: options.appUrl });
  const migrator = new Pool({ connectionString: options.migratorUrl });
  const count = async (pool: Pool, table: string) =>
    Number(
      (
        await pool.query<{ count: string }>(
          `SELECT count(*) FROM app."${table}"`,
        )
      ).rows[0]!.count,
    );
  const tenantOf = async () =>
    (
      await migrator.query<{ org_id: string; user_id: string }>(
        'SELECT org_id, initiating_user_id AS user_id FROM app.ai_runs ORDER BY created_at, id LIMIT 1',
      )
    ).rows[0]!;
  const contextCount = async (table: string) => {
    const tenant = await tenantOf();
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.org_id',$1,true), set_config('app.user_id',$2,true)",
        [tenant.org_id, tenant.user_id],
      );
      return Number(
        (
          await client.query<{ count: string }>(
            `SELECT count(*) FROM app."${table}"`,
          )
        ).rows[0]!.count,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  };
  return {
    async unfencedTables() {
      return (
        await migrator.query<{ relname: string }>(
          `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='app' AND c.relkind='r'
             AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
           ORDER BY c.relname`,
        )
      ).rows.map((row) => row.relname);
    },
    async runIds() {
      return (
        await migrator.query<{ id: string }>(
          'SELECT id FROM app.ai_runs ORDER BY created_at, id',
        )
      ).rows.map((row) => row.id);
    },
    async tableCount() {
      return (
        await migrator.query(
          `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='app' AND c.relkind='r'`,
        )
      ).rowCount;
    },
    /**
     * Per table: rows an app session sees with the seeded tenant's context
     * (proves the table holds data), and rows it sees without any context.
     * The owner cannot prove this: it has no SELECT policy on every table.
     */
    async visibility() {
      const tables = (
        await migrator.query<{ relname: string }>(
          `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='app' AND c.relkind='r' ORDER BY c.relname`,
        )
      ).rows.map((row) => row.relname);
      const result: Record<string, { withContext: number; noContext: number }> =
        {};
      for (const table of tables) {
        const withContext = await contextCount(table);
        result[table] = { withContext, noContext: await count(app, table) };
      }
      return result;
    },
    /**
     * Owner-side seeding: one row in every app table that is still empty. FK
     * columns copy an existing parent row; other required columns get a typed
     * dummy value; `overrides` supply values a CHECK constraint needs. Returns
     * the tables that could not be seeded with the database's error.
     */
    async seedEmptyTables(
      overrides: Record<string, Record<string, string>> = {},
    ) {
      const failures: Record<string, string> = {};
      // Rows are written as the owner with the tenant GUC of the first seeded
      // organization, because the tenant policies also bind owner writes.
      const tenant = (
        await migrator.query<{ org_id: string; user_id: string }>(
          'SELECT org_id, initiating_user_id AS user_id FROM app.ai_runs ORDER BY created_at, id LIMIT 1',
        )
      ).rows[0]!;
      for (let pass = 0; pass < 6; pass++) {
        const tables = (
          await migrator.query<{ relname: string }>(
            `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='app' AND c.relkind='r' ORDER BY c.relname`,
          )
        ).rows.map((row) => row.relname);
        let progressed = false;
        for (const table of tables) {
          if (await contextCount(table)) continue;
          const columns = (
            await migrator.query<{ attname: string; typ: string }>(
              `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS typ
               FROM pg_attribute a WHERE a.attrelid=('app.'||quote_ident($1))::regclass
                 AND a.attnum>0 AND NOT a.attisdropped AND a.attidentity='' AND a.attgenerated=''
                 AND a.attnotnull AND NOT a.atthasdef`,
              [table],
            )
          ).rows;
          const fks = (
            await migrator.query<{
              cols: string[];
              parent: string;
              pcols: string[];
            }>(
              `SELECT (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) AS cols,
                      c.confrelid::regclass::text AS parent,
                      (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum) AS pcols
               FROM pg_constraint c WHERE c.conrelid=('app.'||quote_ident($1))::regclass AND c.contype='f'`,
              [table],
            )
          ).rows;
          const values = new Map<string, string>();
          let blocked = false;
          for (const fk of fks) {
            // Identity tables are not readable by the owner; the tenant ids are known.
            if (fk.parent.startsWith('auth.')) continue;
            const parent = await migrator.query(
              `SELECT ${fk.pcols.map((c) => `"${c}"`).join(',')} FROM ${fk.parent} WHERE ${
                (
                  await migrator.query(
                    `SELECT 1 FROM pg_attribute WHERE attrelid='${fk.parent}'::regclass AND attname='org_id' AND NOT attisdropped`,
                  )
                ).rowCount
                  ? `org_id=${literal(tenant.org_id)}`
                  : 'true'
              } LIMIT 1`,
            );
            const row = parent.rows[0] as Record<string, unknown> | undefined;
            const required = fk.cols.every((c) =>
              columns.some((col) => col.attname === c),
            );
            if (!row) {
              if (required) {
                blocked = true;
                failures[table] = `parent ${fk.parent} has no row`;
              }
              continue;
            }
            fk.cols.forEach((c, i) => {
              const v = row[fk.pcols[i]!];
              values.set(c, v === null ? 'NULL' : literal(v));
            });
          }
          if (blocked) continue;
          // Tenant policies bind rows to the seeded organization and user, even
          // where a foreign key would copy some other user from its parent.
          for (const name of fks.flatMap((fk) => fk.cols)) {
            if (name === 'org_id') values.set(name, literal(tenant.org_id));
            else if (name.endsWith('user_id'))
              values.set(name, literal(tenant.user_id));
          }
          for (const col of columns)
            if (!values.has(col.attname))
              values.set(
                col.attname,
                col.attname === 'org_id'
                  ? literal(tenant.org_id)
                  : col.attname.endsWith('user_id')
                    ? literal(tenant.user_id)
                    : dummy(col.typ),
              );
          for (const [c, v] of Object.entries(overrides[table] ?? {}))
            values.set(c, v);
          const names = [...values.keys()];
          const client = await migrator.connect();
          try {
            await client.query('BEGIN');
            await client.query(
              "SELECT set_config('app.org_id',$1,true), set_config('app.user_id',$2,true)",
              [tenant.org_id, tenant.user_id],
            );
            await client.query(
              `INSERT INTO app."${table}" (${names.map((n) => `"${n}"`).join(',')}) VALUES (${names.map((n) => values.get(n)).join(',')})`,
            );
            await client.query('COMMIT');
            delete failures[table];
            progressed = true;
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            failures[table] = (error as Error).message;
          } finally {
            client.release();
          }
        }
        if (!progressed) break;
      }
      const remaining: Record<string, string> = {};
      for (const [table, message] of Object.entries(failures))
        if (!(await contextCount(table))) remaining[table] = message;
      return remaining;
    },
    async close() {
      await Promise.all([app.end(), migrator.end()]);
    },
  };
}

function literal(value: unknown): string {
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dummy(type: string): string {
  if (type === 'uuid') return 'gen_random_uuid()';
  if (/^(text|character)/.test(type)) return "'seed'";
  if (/(int|numeric|real|double)/.test(type)) return '1';
  if (type === 'boolean') return 'false';
  if (type.startsWith('timestamp')) return 'now()';
  if (type.startsWith('json')) return "'{}'";
  if (type === 'bytea') return "'\\x00'";
  return 'DEFAULT';
}
