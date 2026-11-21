import { appendFile } from 'node:fs/promises';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  createPlatformPools,
  explainFunctionBody,
  planIndexes,
  seedPlatformScale,
  seqScans,
} from '../../src/infrastructure/db/testing/platform-console-fixture.js';

const T = 'NULL::text';
const S = 'NULL::text[]';
const B = 'NULL::boolean[]';
const ACCOUNTS = 'lexon_platform_accounts';
const ORGS = 'lexon_platform_organizations';
const INVITES = 'lexon_platform_account_invitations';

// Gate probe: generic plan with seq scans penalized. count(*) OVER () must read
// every row, so a Seq Scan is the natural plan for an unfiltered 10k-row page;
// the probe shows which index the planner uses when it is discouraged. Without
// it a missing index would go unnoticed on a small table.
const LIST_PROBE = ['enable_seqscan = off', 'enable_bitmapscan = off'];
// Searches: ordered scans discouraged too, so a bitmap over the trigram indexes
// is the only way to avoid scanning the whole table.
const SEARCH_PROBE = ['enable_seqscan = off', 'enable_indexscan = off'];
const probeFor = (name: string) =>
  /search [3-9] chars/.test(name) ? SEARCH_PROBE : LIST_PROBE;

type Case = {
  name: string;
  fn: string;
  args: string[];
  // Gated plans must use one of these indexes and no Seq Scan on a console table.
  gate?: string[];
  // Competing indexes dropped (rolled back) for the probe. At 2,000 organizations
  // and 500 invitations the planner prefers a full bitmap scan of the ordered
  // partial index over the trigram index, even for a generic plan with seq and
  // ordered scans discouraged; with that index gone the trigram index is the only
  // way to avoid scanning the table, which shows it is present and usable.
  without?: string[];
};

const cases: Case[] = [
  {
    name: 'accounts first page',
    fn: ACCOUNTS,
    args: [T, S, B, '20', '0'],
    gate: ['user_created_at_id_idx'],
  },
  {
    name: 'accounts page 50 size 20',
    fn: ACCOUNTS,
    args: [T, S, B, '20', '980'],
  },
  { name: 'accounts last page', fn: ACCOUNTS, args: [T, S, B, '20', '9980'] },
  {
    name: 'accounts status facet',
    fn: ACCOUNTS,
    args: [T, `ARRAY['disabled']`, B, '20', '0'],
  },
  {
    name: 'accounts 2fa facet',
    fn: ACCOUNTS,
    args: [T, S, 'ARRAY[true]', '20', '0'],
  },
  {
    name: 'accounts search 2 chars',
    fn: ACCOUNTS,
    args: [`'ze'`, S, B, '20', '0'],
  },
  {
    name: 'accounts search 5 chars name',
    fn: ACCOUNTS,
    args: [`'zelda'`, S, B, '20', '0'],
    gate: ['user_name_trgm_idx'],
  },
  {
    name: 'accounts search 3 chars email',
    fn: ACCOUNTS,
    args: [`'use'`, S, B, '20', '0'],
    gate: ['user_email_trgm_idx'],
  },
  {
    name: 'accounts total unfiltered',
    fn: 'lexon_platform_accounts_total',
    args: [T, S, B],
  },
  {
    name: 'organizations first page',
    fn: ORGS,
    args: [T, S, '20', '0'],
    gate: ['organization_team_created_idx'],
  },
  { name: 'organizations last page', fn: ORGS, args: [T, S, '20', '1980'] },
  {
    name: 'organizations state facet',
    fn: ORGS,
    args: [T, `ARRAY['active']`, '20', '0'],
    gate: ['organization_team_created_idx'],
  },
  {
    name: 'organizations search 2 chars',
    fn: ORGS,
    args: [`'qu'`, S, '20', '0'],
  },
  {
    name: 'organizations search 5 chars',
    fn: ORGS,
    args: [`'quill'`, S, '20', '0'],
    gate: ['organization_name_trgm_idx', 'organization_slug_trgm_idx'],
    without: ['organization_team_created_idx'],
  },
  {
    name: 'invitations first page',
    fn: INVITES,
    args: [T, S, '20', '0'],
    gate: ['lexon_account_invitation_pending_sent_idx'],
  },
  {
    name: 'invitations status facet',
    fn: INVITES,
    args: [T, `ARRAY['expired']`, '20', '0'],
  },
  {
    name: 'invitations search 2 chars',
    fn: INVITES,
    args: [`'ze'`, S, '20', '0'],
  },
  {
    name: 'invitations search 5 chars',
    fn: INVITES,
    args: [`'zelda'`, S, '20', '0'],
    gate: [
      'lexon_account_invitation_email_trgm_idx',
      'lexon_account_invitation_name_trgm_idx',
    ],
    without: [
      'lexon_account_invitation_pending_sent_idx',
      'lexon_account_invitation_pending_email_idx',
    ],
  },
];

function gateOffenders(plan: Parameters<typeof seqScans>[0], gate: string[]) {
  const offenders = seqScans(plan).map((relation) => `Seq Scan on ${relation}`);
  const used = planIndexes(plan);
  if (!gate.some((index) => used.includes(index)))
    offenders.push(`missing index ${gate.join(' or ')}`);
  return offenders;
}

test(
  'platform console generic plans use the named indexes at scale',
  { timeout: 280_000 },
  async ({ services }) => {
    const pools = createPlatformPools(services);
    try {
      const { bigOrgId } = await seedPlatformScale(pools.migrator);
      const all: Case[] = [
        ...cases,
        {
          name: 'members first page (1000 members)',
          fn: 'lexon_platform_members',
          args: [`'${bigOrgId}'::uuid`, '20', '0'],
          gate: ['member_org_created_idx'],
        },
        {
          name: 'members last page (1000 members)',
          fn: 'lexon_platform_members',
          args: [`'${bigOrgId}'::uuid`, '20', '980'],
        },
      ];
      const rows: string[] = [];
      const offenders: string[] = [];
      for (const item of all) {
        const generic = await explainFunctionBody(
          pools.migrator,
          item.fn,
          item.args,
        );
        const custom = await explainFunctionBody(
          pools.migrator,
          item.fn,
          item.args,
          { planCache: 'custom' },
        );
        const probe = await explainFunctionBody(
          pools.migrator,
          item.fn,
          item.args,
          { gucs: probeFor(item.name), dropIndexes: item.without },
        );
        const scans = seqScans(generic.plan);
        rows.push(
          `| ${item.name} | ${item.gate ? 'gated' : 'recorded'} | ${generic.executionMs.toFixed(2)} | ${custom.executionMs.toFixed(2)} | ${scans.join(', ') || 'none'} | ${probe.executionMs.toFixed(2)} | ${[...new Set(planIndexes(probe.plan))].join(', ') || 'none'} |`,
        );
        if (item.gate)
          for (const offender of gateOffenders(probe.plan, item.gate))
            offenders.push(`${item.name}: ${offender}`);
      }
      const table = `| Plan | Gate | Generic ms | Custom ms | Natural Seq Scan | Probe ms | Probe indexes |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}`;
      console.log(table);
      expect(offenders).toEqual([]);

      if (process.env.CI && process.platform === 'linux') {
        const samples: number[] = [];
        for (let i = 0; i < 50; i++) {
          const started = performance.now();
          await pools.auth.query(
            `SELECT * FROM auth.lexon_platform_accounts('zelda', NULL, NULL, 20, 0)`,
          );
          samples.push(performance.now() - started);
        }
        samples.sort((a, b) => a - b);
        const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
        const summary = `### Platform console scale check\n\nDirect function call lexon_platform_accounts('zelda') on 10,000 accounts, p95 over 50 runs: ${p95.toFixed(1)} ms (not gated)\n\n${table}\n`;
        if (process.env.GITHUB_STEP_SUMMARY)
          await appendFile(
            process.env.GITHUB_STEP_SUMMARY,
            `${summary}\n`,
            'utf8',
          );
        console.log(summary);
      }
    } finally {
      await pools.close();
    }
  },
);

const negatives: { index: string; caseName: string }[] = [
  { index: 'user_created_at_id_idx', caseName: 'accounts first page' },
  { index: 'user_name_trgm_idx', caseName: 'accounts search 5 chars name' },
  { index: 'user_email_trgm_idx', caseName: 'accounts search 3 chars email' },
  {
    index: 'organization_team_created_idx',
    caseName: 'organizations first page',
  },
  {
    index: 'organization_name_trgm_idx',
    caseName: 'organizations search 5 chars',
  },
  {
    index: 'lexon_account_invitation_pending_sent_idx',
    caseName: 'invitations first page',
  },
  {
    index: 'lexon_account_invitation_email_trgm_idx',
    caseName: 'invitations search 5 chars',
  },
];

test(
  'the gate reports each missing index',
  { timeout: 280_000 },
  async ({ services }) => {
    const pools = createPlatformPools(services);
    try {
      await seedPlatformScale(pools.migrator);
      for (const { index, caseName } of negatives) {
        const item = cases.find((candidate) => candidate.name === caseName)!;
        const { plan } = await explainFunctionBody(
          pools.migrator,
          item.fn,
          item.args,
          {
            dropIndexes: [...(item.without ?? []), index],
            gucs: probeFor(item.name),
          },
        );
        expect(
          gateOffenders(plan, [index]),
          `${caseName} without ${index}`,
        ).toContain(`missing index ${index}`);
      }
    } finally {
      await pools.close();
    }
  },
);
