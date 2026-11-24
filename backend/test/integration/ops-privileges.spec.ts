import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { JobEnvelopeSchema } from '../../src/infrastructure/db/index.js';

// B-07: `ops` must grant lexon_app nothing by default (0000 granted it like
// `app`; 0041 narrows it). Every entry lexon_app receives through
// lexon_migrator's default privileges, over every defaclobjtype, is pinned
// here — a change to any default (or a new objtype) fails this list.
test('lexon_app default privileges: pinned for app, nothing for ops', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const migrator = pools.migrator;
  try {
    const rows = (
      await migrator.query<{
        schema: string;
        objtype: string;
        privilege: string;
        grantable: boolean;
      }>(
        `SELECT COALESCE(n.nspname, '') AS schema, d.defaclobjtype AS objtype,
                a.privilege_type AS privilege, a.is_grantable AS grantable
         FROM pg_default_acl d
         LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
         CROSS JOIN LATERAL aclexplode(d.defaclacl) a
         WHERE d.defaclrole = 'lexon_migrator'::regrole
           AND a.grantee = 'lexon_app'::regrole
         ORDER BY schema, objtype, privilege`,
      )
    ).rows;
    expect(rows).toEqual([
      { schema: 'app', objtype: 'S', privilege: 'SELECT', grantable: false },
      { schema: 'app', objtype: 'S', privilege: 'USAGE', grantable: false },
      { schema: 'app', objtype: 'r', privilege: 'DELETE', grantable: false },
      { schema: 'app', objtype: 'r', privilege: 'INSERT', grantable: false },
      { schema: 'app', objtype: 'r', privilege: 'SELECT', grantable: false },
      { schema: 'app', objtype: 'r', privilege: 'UPDATE', grantable: false },
    ]);
  } finally {
    await pools.close();
  }
});

// B-07: a table or sequence created in `ops` after the narrowing grants
// lexon_app no privilege at all. Rolled back, so nothing persists.
test('a new ops table or sequence grants lexon_app nothing', async ({
  services,
}) => {
  const pools = createPlatformPools(services);
  const client = await pools.migrator.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE ops.f44_probe(id int)');
    await client.query('CREATE SEQUENCE ops.f44_probe_seq');
    const table = (
      await client.query<{ p: string }>(
        `SELECT p FROM unnest(
           ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
         ) p
         WHERE has_table_privilege('lexon_app', 'ops.f44_probe', p)`,
      )
    ).rows.map((row) => row.p);
    expect(table).toEqual([]);
    const sequence = (
      await client.query<{ p: string }>(
        `SELECT p FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) p
         WHERE has_sequence_privilege('lexon_app', 'ops.f44_probe_seq', p)`,
      )
    ).rows.map((row) => row.p);
    expect(sequence).toEqual([]);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pools.close();
  }
});

// B-07 inventory, hand-pinned on 2026-11-23 from the migrated database: every
// `ops` table (relkind r/p), its K1-capable columns (free text or loose
// content types), and the exact set of privileges lexon_app holds on it. A
// new ops table, a new text/jsonb(-family) column, or a new grant fails the
// deep-equal and must be reviewed and granted deliberately.
const OPS_INVENTORY: ReadonlyArray<{
  relname: string;
  relkind: string;
  columns: ReadonlyArray<{ name: string; type: string }>;
  privileges: readonly string[];
}> = [
  {
    relname: 'ai_engine_capacity',
    relkind: 'r',
    columns: [{ name: 'config_fingerprint', type: 'text' }],
    privileges: ['INSERT', 'SELECT'],
  },
  { relname: 'ai_run_slots', relkind: 'r', columns: [], privileges: [] },
  {
    relname: 'audit_events',
    relkind: 'r',
    columns: [
      { name: 'metadata', type: 'jsonb' },
      { name: 'outcome', type: 'text' },
      { name: 'type', type: 'text' },
    ],
    privileges: ['INSERT'],
  },
  {
    relname: 'outbox',
    relkind: 'r',
    columns: [
      { name: 'last_error_code', type: 'text' },
      { name: 'payload', type: 'jsonb' },
      { name: 'queue_name', type: 'text' },
      { name: 'type', type: 'text' },
    ],
    privileges: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  },
  {
    relname: 'processed_jobs',
    relkind: 'r',
    columns: [],
    privileges: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  },
];

test('the ops inventory matches the pinned allowlist', async ({ services }) => {
  const pools = createPlatformPools(services);
  const migrator = pools.migrator;
  try {
    const rows = (
      await migrator.query<{
        relname: string;
        relkind: string;
        columns: Array<{ name: string; type: string }>;
        privileges: string[];
      }>(
        `SELECT c.relname, c.relkind,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('name', a.attname, 'type', t.typname) ORDER BY a.attname)
                          FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
                          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                            AND t.typname IN ('text','varchar','bpchar','json','jsonb','xml')),
                         '[]'::jsonb) AS columns,
                COALESCE((SELECT jsonb_agg(p ORDER BY p)
                          FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
                          WHERE has_table_privilege('lexon_app', c.oid::regclass, p)),
                         '[]'::jsonb) AS privileges
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ops' AND c.relkind IN ('r','p')
         ORDER BY c.relname`,
      )
    ).rows;
    expect(rows).toEqual(OPS_INVENTORY);
  } finally {
    await pools.close();
  }
});

// B-07: outbox payloads are queue metadata, never K1 content — every field of
// every registered JobEnvelopeSchema option must resolve to an id, enum,
// literal, number or timestamp. Enumerating the discriminated union means a
// new payload type is covered without editing this test.
interface ZodInternalDef {
  type?: string;
  format?: string;
  shape?: Record<string, unknown>;
  innerType?: unknown;
  options?: readonly unknown[];
  values?: readonly unknown[];
}

const zodDef = (schema: unknown): ZodInternalDef =>
  (schema as { _zod?: { def?: ZodInternalDef } } | null | undefined)?._zod
    ?.def ?? {};

const WRAPPER_TYPES = new Set([
  'optional',
  'nullable',
  'nonoptional',
  'default',
  'prefault',
  'readonly',
  'catch',
]);

const ALLOWED_LEAVES = new Set([
  'string:uuid',
  'string:datetime',
  'date',
  'enum',
  'literal',
  'number',
]);

test('every job envelope field is an id, enum, literal, number or timestamp', () => {
  const violations: string[] = [];
  const walk = (schema: unknown, path: string): void => {
    const def = zodDef(schema);
    if (def.type === 'object' && def.shape) {
      for (const [key, child] of Object.entries(def.shape))
        walk(child, `${path}.${key}`);
      return;
    }
    if (def.type && WRAPPER_TYPES.has(def.type)) {
      walk(def.innerType, path);
      return;
    }
    const leaf = `${def.type ?? 'unknown'}${def.format ? `:${def.format}` : ''}`;
    if (!ALLOWED_LEAVES.has(leaf)) violations.push(`${path} (${leaf})`);
  };
  const options = zodDef(JobEnvelopeSchema).options ?? [];
  expect(options.length).toBeGreaterThan(0);
  for (const option of options) {
    const typeField = zodDef(option).shape?.['type'];
    const label = String(zodDef(typeField).values?.[0] ?? 'unknown');
    walk(option, `envelope[${label}]`);
  }
  expect(violations).toEqual([]);
});
