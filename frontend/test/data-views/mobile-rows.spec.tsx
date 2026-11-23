import { afterEach, expect, test, vi } from 'vitest';
import {
  DataTable,
  IdentityAvatar,
  IdentityCell,
} from '../../src/components/data-views';
import { render } from '../render';
import { columns, people } from './fixture';

// Prototype revision 16 `.dv-mrow` at 390×844: padding 12px 8px 12px 16px,
// gap 12px, 1px bottom rule; text column gap 3px at line height 1.3
// (title 14px → 18.2px, second line 12px → 15.6px, 13px badge and meta
// lines → 16.9px); lead `.dv-av` 32px, round for people and invitations
// (dashed), 8px radius for organizations. A person row is 104.7px high.
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
const cls = (el: Element | null | undefined) =>
  new Set((el?.getAttribute('class') ?? '').split(/\s+/));
const expectTokens = (el: Element | null | undefined, tokens: string[]) => {
  const set = cls(el);
  for (const t of tokens) expect(set.has(t), t).toBe(true);
};

test('mobile row paddings, gaps, and 1.3 line heights', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        this.cb(
          [{ target, contentRect: { width: 356 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  const v = await render(
    <DataTable
      columns={columns}
      rows={people}
      getRowId={(p) => p.id}
      mobileRow={(p) => ({
        lead: <IdentityAvatar initials="AW" />,
        title: p.name,
        sub: p.email,
        badge: <span>Active</span>,
        meta: <span>meta</span>,
      })}
    />,
  );
  const row = v.container.querySelector('[data-slot="data-mobile-row"]')!;
  expectTokens(row, [
    'flex',
    'items-start',
    'gap-3',
    'py-3',
    'pr-2',
    'pl-4',
    'border-b',
    'last:border-b-0',
  ]);
  expectTokens(row.parentElement, ['border-t']);
  const text = row.querySelector('b')!.parentElement!;
  expectTokens(text, ['gap-[3px]', 'leading-[1.3]', 'text-[13px]']);
  expectTokens(row.querySelector('b'), ['text-sm', 'leading-[1.3]']);
  expectTokens(row.querySelector('small'), ['text-xs', 'leading-[1.3]']);
});

test('identity avatar: 32px; round person, 8px organization, round dashed invitation', async () => {
  const v = await render(
    <>
      <IdentityAvatar initials="AW" />
      <IdentityAvatar shape="organization" initials="HN" />
      <IdentityAvatar shape="invitation" />
    </>,
  );
  const [person, org, invitation] = Array.from(
    v.container.querySelectorAll('[data-slot="identity-avatar"]'),
  );
  for (const el of [person, org, invitation])
    expectTokens(el, ['size-8', 'flex-none', 'text-xs', 'font-semibold']);
  expectTokens(person, ['rounded-full', 'bg-muted']);
  expectTokens(org, ['rounded-[8px]', 'bg-sidebar-primary']);
  expect(cls(org).has('rounded-lg')).toBe(false);
  expectTokens(invitation, ['rounded-full', 'border', 'border-dashed']);
  expect(invitation!.querySelector('svg')).not.toBeNull();
  // The table identity cell uses the same avatar.
  const cell = await render(
    <IdentityCell shape="organization" name="Hukum" initials="HN" />,
  );
  expectTokens(cell.container.querySelector('[data-slot="identity-avatar"]'), [
    'rounded-[8px]',
  ]);
});
