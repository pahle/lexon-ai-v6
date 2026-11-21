import { appendFile } from 'node:fs/promises';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  createPlatformPools,
  explainFunctionBody,
  explainWithoutIndex,
  planNodes,
  seedPlatformScale,
  seqScans,
  type PlanNode,
} from '../../src/infrastructure/db/testing/platform-console-fixture.js';

type Case = {
  name: string;
  fn: string;
  args: string[];
  // true: the spec forbids a Seq Scan on the console tables for this plan.
  gated: boolean;
};

function trigramGateOffenders(plan: PlanNode) {
  const offenders = seqScans(plan).map((relation) => `Seq Scan on ${relation}`);
  if (!planNodes(plan).some((node) => node.includes('_trgm_idx')))
    offenders.push('no trigram index in plan');
  return offenders;
}

const T = 'NULL::text';
const S = 'NULL::text[]';
const B = 'NULL::boolean[]';
const accounts = (
  q: string,
  statuses: string,
  tf: string,
  size: number,
  off: number,
) => [q, statuses, tf, String(size), String(off)];

const cases: Case[] = [
  {
    name: 'accounts first page',
    fn: 'lexon_platform_accounts',
    args: accounts(T, S, B, 20, 0),
    gated: true,
  },
  {
    name: 'accounts page 50 size 20',
    fn: 'lexon_platform_accounts',
    args: accounts(T, S, B, 20, 980),
    gated: false,
  },
  {
    name: 'accounts last page',
    fn: 'lexon_platform_accounts',
    args: accounts(T, S, B, 20, 9980),
    gated: false,
  },
  {
    name: 'accounts status facet',
    fn: 'lexon_platform_accounts',
    args: accounts(T, `ARRAY['disabled']`, B, 20, 0),
    gated: false,
  },
  {
    name: 'accounts 2fa facet',
    fn: 'lexon_platform_accounts',
    args: accounts(T, S, 'ARRAY[true]', 20, 0),
    gated: false,
  },
  {
    name: 'accounts search 2 chars',
    fn: 'lexon_platform_accounts',
    args: accounts(`'ze'`, S, B, 20, 0),
    gated: false,
  },
  {
    name: 'accounts search 5 chars',
    fn: 'lexon_platform_accounts',
    args: accounts(`'zelda'`, S, B, 20, 0),
    gated: true,
  },
  {
    name: 'accounts search 3 chars email',
    fn: 'lexon_platform_accounts',
    args: accounts(`'use'`, S, B, 20, 0),
    gated: false,
  },
  {
    name: 'accounts total unfiltered',
    fn: 'lexon_platform_accounts_total',
    args: [T, S, B],
    gated: false,
  },
  {
    name: 'organizations first page',
    fn: 'lexon_platform_organizations',
    args: [T, S, '20', '0'],
    gated: true,
  },
  {
    name: 'organizations last page',
    fn: 'lexon_platform_organizations',
    args: [T, S, '20', '1980'],
    gated: false,
  },
  {
    name: 'organizations state facet',
    fn: 'lexon_platform_organizations',
    args: [T, `ARRAY['active']`, '20', '0'],
    gated: false,
  },
  {
    name: 'organizations search 2 chars',
    fn: 'lexon_platform_organizations',
    args: [`'qu'`, S, '20', '0'],
    gated: false,
  },
  {
    name: 'organizations search 5 chars',
    fn: 'lexon_platform_organizations',
    args: [`'quill'`, S, '20', '0'],
    gated: true,
  },
  {
    name: 'invitations first page',
    fn: 'lexon_platform_account_invitations',
    args: [T, S, '20', '0'],
    gated: true,
  },
  {
    name: 'invitations status facet',
    fn: 'lexon_platform_account_invitations',
    args: [T, `ARRAY['expired']`, '20', '0'],
    gated: false,
  },
  {
    name: 'invitations search 2 chars',
    fn: 'lexon_platform_account_invitations',
    args: [`'ze'`, S, '20', '0'],
    gated: false,
  },
  {
    name: 'invitations search 5 chars',
    fn: 'lexon_platform_account_invitations',
    args: [`'zelda'`, S, '20', '0'],
    gated: true,
  },
];

test(
  'platform console plans use indexes at scale',
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
          gated: true,
        },
        {
          name: 'members last page (1000 members)',
          fn: 'lexon_platform_members',
          args: [`'${bigOrgId}'::uuid`, '20', '980'],
          gated: false,
        },
      ];
      const rows: string[] = [];
      const offenders: string[] = [];
      for (const item of all) {
        const { plan, executionMs } = await explainFunctionBody(
          pools.migrator,
          item.fn,
          item.args,
        );
        const scans = seqScans(plan);
        const probe = await explainFunctionBody(
          pools.migrator,
          item.fn,
          item.args,
          {
            seqScan: false,
            indexScan: !/search \d chars/.test(item.name) || !item.gated,
          },
        );
        const probeScans = seqScans(probe.plan);
        const usesTrigram = planNodes(probe.plan).some((node) =>
          node.includes('_trgm_idx'),
        );
        if (
          item.gated &&
          item.fn === 'lexon_platform_accounts' &&
          /search \d chars/.test(item.name) &&
          !usesTrigram
        )
          offenders.push(`${item.name}: no trigram index in plan`);
        rows.push(
          `${item.name} | ${item.gated ? 'gated' : 'recorded'} | ${executionMs.toFixed(2)} ms | seq: ${scans.join(',') || 'none'} | seq-off: ${probe.executionMs.toFixed(2)} ms, seq: ${probeScans.join(',') || 'none'}`,
        );
        console.log(`PLAN ${rows.at(-1)}\n  ${planNodes(plan).join('\n  ')}`);
        if (item.gated && probeScans.length > 0)
          offenders.push(
            `${item.name}: Seq Scan on ${probeScans.join(', ')} even with enable_seqscan = off`,
          );
      }
      console.log(`PLAN_TABLE\n${rows.join('\n')}`);
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
        const summary = `### Platform console scale check\n\nAccount search (10,000 accounts), p95 over 50 runs: ${p95.toFixed(1)} ms (not gated)\n\n| Plan | Gate | Execution | Seq Scan |\n|---|---|---|---|\n${rows.map((row) => `| ${row.split(' | ').join(' | ')} |`).join('\n')}\n`;
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

test(
  'fails without the trigram index',
  { timeout: 280_000 },
  async ({ services }) => {
    const pools = createPlatformPools(services);
    try {
      await seedPlatformScale(pools.migrator);
      const args = [`'zelda'`, 'NULL::text[]', 'NULL::boolean[]', '20', '0'];
      const withoutName = await explainWithoutIndex(
        pools.migrator,
        'user_name_trgm_idx',
        'lexon_platform_accounts',
        args,
      );
      // Control: with the index present the same detector reports nothing.
      const withIndex = await explainFunctionBody(
        pools.migrator,
        'lexon_platform_accounts',
        args,
        { seqScan: false, indexScan: false },
      );
      expect(trigramGateOffenders(withIndex.plan)).toEqual([]);
      // The detector the gate uses reports it.
      expect(trigramGateOffenders(withoutName)).toEqual([
        'no trigram index in plan',
      ]);
    } finally {
      await pools.close();
    }
  },
);
