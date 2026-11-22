import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, useState } from 'react';
import { DataToolbar, FacetFilter } from '../../src/components/data-views';
import {
  parseDataViewParams,
  serializeDataViewParams,
} from '../../src/components/data-views/data-view-params';
import { render, settle } from '../render';
import { byText, click, typeInto } from './helpers';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

test('no request under 2 characters, debounced at 300 ms from 2', async () => {
  const onQuery = vi.fn();
  const view = await render(
    <DataToolbar query="" onQuery={onQuery} onReset={vi.fn()} />,
  );
  const input = view.container.querySelector('input')!;
  await typeInto(input, 'n');
  await advance(1000);
  expect(onQuery).not.toHaveBeenCalled();
  await typeInto(input, 'no');
  await advance(299);
  expect(onQuery).not.toHaveBeenCalled();
  await advance(2);
  expect(onQuery).toHaveBeenCalledExactlyOnceWith('no');
});

test('clearing the box sends an empty query', async () => {
  const onQuery = vi.fn();
  const view = await render(
    <DataToolbar query="notaris" onQuery={onQuery} onReset={vi.fn()} />,
  );
  await typeInto(view.container.querySelector('input')!, '');
  await advance(400);
  expect(onQuery).toHaveBeenCalledExactlyOnceWith('');
});

test('Reset shows with a query or a facet and clears both', async () => {
  vi.useRealTimers();
  const onReset = vi.fn();
  const view = await render(
    <DataToolbar query="notaris" onQuery={vi.fn()} onReset={onReset} />,
  );
  await click(byText(view.container, 'button', 'Reset')!);
  expect(onReset).toHaveBeenCalledOnce();
  const idle = await render(
    <DataToolbar query="" onQuery={vi.fn()} onReset={vi.fn()} />,
  );
  expect(byText(idle.container, 'button', 'Reset')).toBeUndefined();
  const faceted = await render(
    <DataToolbar query="" hasFilters onQuery={vi.fn()} onReset={vi.fn()} />,
  );
  expect(byText(faceted.container, 'button', 'Reset')).toBeDefined();
});

const options = [
  { value: 'active', label: 'Active' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'disabled', label: 'Disabled' },
];

function Facet({ onChange }: { onChange: (v: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>(['unverified']);
  return (
    <FacetFilter
      label="Status"
      options={options}
      selected={selected}
      onChange={(next) => {
        setSelected(next);
        onChange(next);
      }}
    />
  );
}

test('facet shows chips, selects, and Clear filter empties it', async () => {
  vi.useRealTimers();
  const onChange = vi.fn();
  const view = await render(<Facet onChange={onChange} />);
  const trigger = view.container.querySelector('button')!;
  expect(trigger.textContent).toContain('Status');
  expect(trigger.textContent).toContain('Unverified');
  await click(trigger);
  await settle();
  const items = Array.from(
    document.body.querySelectorAll('[role="menuitemcheckbox"]'),
  );
  expect(items.map((i) => i.textContent)).toEqual([
    'Active',
    'Unverified',
    'Disabled',
  ]);
  expect(items[1]!.getAttribute('aria-checked')).toBe('true');
  await click(items[0]!);
  expect(onChange).toHaveBeenLastCalledWith(['unverified', 'active']);
  await click(byText(document.body, '[role="menuitem"]', 'Clear filter')!);
  expect(onChange).toHaveBeenLastCalledWith([]);
});

test('URL params round-trip: query, facets (repeated), page, page size', () => {
  const facets = ['status', 'tag'];
  const state = {
    query: 'notaris',
    page: 3,
    pageSize: 50,
    facets: { status: ['active', 'disabled'], tag: ['owner'] },
  };
  const search = serializeDataViewParams(state, facets);
  expect(search).toBe(
    'query=notaris&status=active&status=disabled&tag=owner&page=3&pageSize=50',
  );
  expect(parseDataViewParams(new URLSearchParams(search), facets)).toEqual(
    state,
  );
});

test('URL params drop defaults and reject bad values', () => {
  const facets = ['status'];
  expect(
    serializeDataViewParams(
      { query: '', page: 1, pageSize: 20, facets: { status: [] } },
      facets,
    ),
  ).toBe('');
  expect(
    parseDataViewParams(
      new URLSearchParams('page=0&pageSize=33&query=%20'),
      facets,
    ),
  ).toEqual({
    query: '',
    page: 1,
    pageSize: 20,
    facets: { status: [] },
  });
});

// WCAG 2.5.3 (axe label-content-name-mismatch): once chips show, a fixed
// aria-label would hide them from the accessible name.
test('facet trigger name always contains its visible text', async () => {
  vi.useRealTimers();
  for (const selected of [[], ['unverified'], ['active', 'disabled']]) {
    const view = await render(
      <FacetFilter
        label="Status"
        options={options}
        selected={selected}
        onChange={() => {}}
      />,
    );
    const trigger = view.container.querySelector('button')!;
    const visible = trigger.textContent!;
    const name = trigger.getAttribute('aria-label') ?? visible;
    expect(name, selected.join()).toContain(visible);
    if (!selected.length)
      expect(trigger.getAttribute('aria-label')).toBe('Status');
    await view.unmount();
  }
});

test('two toggles before the selection prop updates keep both', async () => {
  vi.useRealTimers();
  const onChange = vi.fn();
  // The parent never re-renders with the new selection (a pending URL).
  const view = await render(
    <FacetFilter
      label="Status"
      options={options}
      selected={[]}
      onChange={onChange}
    />,
  );
  await click(view.container.querySelector('button')!);
  await settle();
  const items = Array.from(
    document.body.querySelectorAll('[role="menuitemcheckbox"]'),
  ) as HTMLElement[];
  await act(async () => {
    items[1]!.click();
    items[2]!.click();
  });
  expect(onChange).toHaveBeenLastCalledWith(['unverified', 'disabled']);
  await view.unmount();
});
