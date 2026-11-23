import { afterEach, expect, test } from 'vitest';
import { Mail, Users } from 'lucide-react';
import {
  DetailsCard,
  RecordHeader,
  RecordPage,
  RelatedTable,
  StatTiles,
} from '../../src/components/data-views';
import { render } from '../render';
import { columns, people } from './fixture';

// Measured in prototype revision 16 at 390×844 (`?shot=1&m=1`) and 1440×900;
// Lexon Inter "normal" line height is 17px at 14px, 16px at 13px, 15px at
// 12px, 19px at 15px. See docs/references/F4.3-acceptance.md, round 3.
afterEach(() => {
  document.body.innerHTML = '';
});
const cls = (el: Element | null | undefined) =>
  new Set((el?.getAttribute('class') ?? '').split(/\s+/));
const expectTokens = (el: Element | null | undefined, tokens: string[]) => {
  const set = cls(el);
  for (const t of tokens) expect(set.has(t), t).toBe(true);
};

test('record page: .dv-page padding 20px 16px on mobile (28px 24px 40px desktop), gap 16/20', async () => {
  const v = await render(
    <RecordPage>
      <p>x</p>
    </RecordPage>,
  );
  expectTokens(v.container.firstElementChild, [
    'px-4',
    'pt-5',
    'pb-5',
    'gap-4',
    'md:px-6',
    'md:pt-7',
    'md:pb-10',
    'md:gap-5',
  ]);
});

test('record header: back link 29px (.slink 6px 10px, gap 8px, radius 8px, normal line height); meta lines 16px', async () => {
  const v = await render(
    <RecordHeader
      backHref="/platform/accounts"
      backLabel="Accounts"
      initials="AW"
      title="Ayu Wardani"
      meta={[
        { icon: Mail, text: 'ayu@x.id' },
        { icon: Users, text: 'Joined 2 Sep 2026' },
      ]}
      actions={<button>Disable</button>}
    />,
  );
  expectTokens(v.container.querySelector('a'), [
    'px-2.5',
    'py-1.5',
    'gap-2',
    'rounded-[8px]',
    'leading-[normal]',
    '-mb-2',
    '-ml-2.5',
  ]);
  const meta =
    v.container.querySelector('h1')!.parentElement!.nextElementSibling!;
  expectTokens(meta, ['text-[13px]', 'leading-[normal]', 'gap-4']);
});

test('stat tiles: radius 12px, padding 12px 14px mobile / 14px 16px desktop, label and supporting normal, value line height 1.2', async () => {
  const v = await render(
    <StatTiles
      items={[
        { icon: Users, label: 'Members', value: '0', supporting: 'Until' },
        { icon: Mail, label: 'State', value: 'On' },
      ]}
    />,
  );
  const tile = v.container.querySelector('[data-slot="stat-tile"]')!;
  expectTokens(tile.parentElement, ['gap-2', 'md:gap-3']);
  expectTokens(tile, [
    'rounded-[12px]',
    'px-3.5',
    'py-3',
    'md:px-4',
    'md:py-3.5',
    'gap-x-3',
    'gap-y-0.5',
  ]);
  expect(cls(tile).has('rounded-xl')).toBe(false);
  expectTokens(tile.children[0], ['text-xs', 'leading-[normal]']);
  expectTokens(tile.querySelector('b'), [
    'text-lg',
    'md:text-[22px]',
    'leading-[1.2]',
  ]);
  expectTokens(tile.querySelector('small'), ['text-xs', 'leading-[normal]']);
});

test('details card: radius 12px; header h2 normal line height; rows 11px, 104px/12px mobile, 132px/16px desktop, normal line height', async () => {
  const v = await render(
    <DetailsCard
      rows={[
        { label: 'Email', value: 'ayu@x.id' },
        { label: 'ID', value: '3c8e', copy: true },
      ]}
    />,
  );
  const card = v.container.querySelector('[data-slot="data-table-card"]')!;
  expectTokens(card, ['rounded-[12px]', 'border']);
  expect(cls(card).has('rounded-xl')).toBe(false);
  expectTokens(card.firstElementChild, [
    'px-4',
    'py-3.5',
    'md:px-5',
    'md:py-4',
    'border-b',
  ]);
  expectTokens(v.container.querySelector('h2'), [
    'text-[15px]',
    'leading-[normal]',
  ]);
  expectTokens(v.container.querySelector('dl'), [
    'px-4',
    'pt-1',
    'pb-2',
    'md:px-5',
  ]);
  expectTokens(v.container.querySelector('dl > div'), [
    'py-[11px]',
    'grid-cols-[104px_minmax(0,1fr)]',
    'gap-3',
    'md:grid-cols-[132px_minmax(0,1fr)]',
    'md:gap-4',
    'leading-[normal]',
  ]);
});

test('related table card: radius 12px and a normal-line-height title', async () => {
  const v = await render(
    <RelatedTable
      title="Teams"
      columns={columns}
      rows={people}
      getRowId={(p) => p.id}
      status="ready"
      onRetry={() => undefined}
      emptyText="None"
    />,
  );
  expectTokens(v.container.querySelector('[data-slot="data-table-card"]'), [
    'rounded-[12px]',
  ]);
  expectTokens(v.container.querySelector('h2'), ['leading-[normal]']);
});

// `.dv-empty`: padding 40px 20px 44px, gap 6px; 40px icon tile radius 10px
// with 4px below; 15px semibold title; 13px text at 1.5, max 360px; the
// button 8px further down. In a record card it sits under a 1px rule.
test('empty state follows .dv-empty; a related card draws the rule above it', async () => {
  const v = await render(
    <RelatedTable
      title="Teams"
      columns={columns}
      rows={[]}
      getRowId={(p) => p.id}
      status="empty"
      onRetry={() => undefined}
      emptyTitle="No teams yet"
      emptyText="This account is not a member of any team."
    />,
  );
  const empty = v.container.querySelector('[data-slot="empty"]')!;
  expectTokens(empty, ['px-5', 'pt-10', 'pb-11', 'gap-1.5']);
  expect(cls(empty).has('p-6')).toBe(false);
  expectTokens(empty.parentElement, ['border-t', 'border-border']);
  expectTokens(v.container.querySelector('[data-slot="empty-header"]'), [
    'gap-1.5',
    'max-w-[360px]',
  ]);
  expectTokens(v.container.querySelector('[data-slot="empty-icon"]'), [
    'size-10',
    'rounded-[10px]',
    'mb-1',
  ]);
  expectTokens(v.container.querySelector('[data-slot="empty-title"]'), [
    'text-[15px]',
    'font-semibold',
    'leading-[normal]',
  ]);
  expectTokens(v.container.querySelector('[data-slot="empty-description"]'), [
    'text-[13px]',
    'leading-normal',
  ]);
});
