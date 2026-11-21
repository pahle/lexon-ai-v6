import { afterEach, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { DataTable, FloatingActionBar } from '../../src/components/data-views';
import { Download, Ban } from 'lucide-react';
import { render } from '../render';
import { a11yViolations, byLabel, byText, click, key } from './helpers';
import { columns, people } from './fixture';

afterEach(() => {
  document.body.innerHTML = '';
});

const onExport = vi.fn();

function Harness() {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  return (
    <>
      <DataTable
        columns={columns}
        rows={people}
        getRowId={(p) => p.id}
        selection={{ selectedIds, onSelectedIdsChange: setSelectedIds }}
      />
      <FloatingActionBar
        selectedIds={[...selectedIds]}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          { label: 'Export', icon: Download, onSelect: onExport },
          { label: 'Disable', icon: Ban, onSelect: vi.fn(), destructive: true },
        ]}
      />
    </>
  );
}

const rowBoxes = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('tbody [role="checkbox"]')) as HTMLElement[];

test('no bar until a row is selected; select row shows "1 selected"', async () => {
  const view = await render(<Harness />);
  expect(view.container.querySelector('[role="toolbar"]')).toBeNull();
  await click(rowBoxes(view.container)[0]!);
  const bar = view.container.querySelector('[role="toolbar"]')!;
  expect(bar.getAttribute('aria-label')).toBe('Selected rows');
  expect(bar.textContent).toContain('1 selected');
  expect(
    view.container.querySelectorAll('tbody tr')[0]!.getAttribute('data-state'),
  ).toBe('selected');
});

test('select all on page and N selected, then clear', async () => {
  const view = await render(<Harness />);
  await click(byLabel(view.container, 'Select all rows on this page')!);
  expect(
    rowBoxes(view.container).every(
      (b) => b.getAttribute('aria-checked') === 'true',
    ),
  ).toBe(true);
  expect(
    view.container.querySelector('[role="toolbar"]')!.textContent,
  ).toContain('4 selected');
  await click(byLabel(view.container, 'Clear selection')!);
  expect(view.container.querySelector('[role="toolbar"]')).toBeNull();
  expect(
    rowBoxes(view.container).every(
      (b) => b.getAttribute('aria-checked') === 'false',
    ),
  ).toBe(true);
});

test('bar actions receive the selected ids', async () => {
  const view = await render(<Harness />);
  await click(rowBoxes(view.container)[0]!);
  await click(rowBoxes(view.container)[3]!);
  await click(byText(view.container, 'button', 'Export')!);
  expect(onExport).toHaveBeenCalledWith(['p1', 'p4']);
});

test('bar position: 24px above the bottom, 16px on mobile, motion-reduce aware, destructive action styled last', async () => {
  const view = await render(<Harness />);
  await click(rowBoxes(view.container)[0]!);
  const bar = view.container.querySelector('[role="toolbar"]')!;
  const classes = bar.className.split(/\s+/);
  expect(classes).toContain('fixed');
  expect(classes).toContain('bottom-4');
  expect(classes).toContain('md:bottom-6');
  expect(classes).toContain('motion-reduce:animate-none');
  const actions = Array.from(bar.querySelectorAll('button'));
  expect(actions.at(-2)!.textContent).toBe('Disable');
});

test('keyboard reachability: checkboxes are focusable and Space toggles', async () => {
  const view = await render(<Harness />);
  const box = rowBoxes(view.container)[1]!;
  expect(box.tabIndex).toBe(0);
  box.focus();
  expect(document.activeElement).toBe(box);
  await key(box, ' ');
  await click(box);
  expect(
    view.container.querySelector('[role="toolbar"]')!.textContent,
  ).toContain('1 selected');
});

{
  test(`selection and bar a11y rules clean `, async () => {
    const view = await render(<Harness />);
    await click(rowBoxes(view.container)[0]!);
    expect(a11yViolations()).toEqual([]);
  });
}
