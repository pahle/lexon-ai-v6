import { afterEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { DataTable } from '../../src/components/data-views';
import { render } from '../render';
import { a11yViolations, click } from './helpers';
import { columns, people } from './fixture';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const table = (extra = {}) => (
  <DataTable
    columns={columns}
    rows={people}
    getRowId={(p) => p.id}
    {...extra}
  />
);

test('semantic table with column headers and aria-sort only on the sorted column', async () => {
  const view = await render(
    table({ sort: { key: 'date', direction: 'descending' } }),
  );
  const heads = Array.from(view.container.querySelectorAll('th'));
  expect(heads.map((h) => h.textContent)).toContain('Record');
  expect(heads.every((h) => h.getAttribute('scope') === 'col')).toBe(true);
  const sorted = heads.filter((h) => h.hasAttribute('aria-sort'));
  expect(sorted).toHaveLength(1);
  expect(sorted[0]!.getAttribute('aria-sort')).toBe('descending');
  expect(sorted[0]!.textContent).toBe('Date');
  expect(view.container.querySelectorAll('tbody tr')).toHaveLength(4);
});

test('cells render identity, money, number alignment', async () => {
  const view = await render(table());
  expect(view.container.textContent).toContain('Rp 1.250.000');
  expect(view.container.textContent).toContain('ayu@hukum-nusantara.co.id');
  expect(view.container.querySelector('td.text-right')).not.toBeNull();
});

test('whole-row open calls onOpen; inner buttons do not', async () => {
  const onOpen = vi.fn();
  const view = await render(table({ onOpen }));
  await click(view.container.querySelectorAll('tbody tr')[1]!);
  expect(onOpen).toHaveBeenCalledWith(people[1]);
  const inner = document.createElement('button');
  view.container
    .querySelectorAll('tbody tr')[0]!
    .querySelector('td')!
    .append(inner);
  await click(inner);
  expect(onOpen).toHaveBeenCalledOnce();
});

function mockWidth(width: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        this.cb(
          [{ target, contentRect: { width } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

test('mobile rows below the breakpoint', async () => {
  mockWidth(400);
  const view = await render(table());
  expect(view.container.querySelector('table')).toBeNull();
  const rows = view.container.querySelectorAll('[data-slot="data-mobile-row"]');
  expect(rows).toHaveLength(4);
  expect(rows[0]!.textContent).toContain('Ayu Wardani');
});

test('table above the breakpoint', async () => {
  mockWidth(900);
  const view = await render(table());
  expect(view.container.querySelector('table')).not.toBeNull();
  expect(
    view.container.querySelector('[data-slot="data-mobile-row"]'),
  ).toBeNull();
});

for (const theme of ['light', 'dark'] as const) {
  test(`a11y rules clean in ${theme}`, async () => {
    await render(table({ onOpen: vi.fn() }));
    await act(async () => {});
    expect(a11yViolations(theme)).toEqual([]);
  });
}
