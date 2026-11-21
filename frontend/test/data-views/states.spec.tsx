import { afterEach, expect, test, vi } from 'vitest';
import { DataStates } from '../../src/components/data-views';
import { render } from '../render';
import { byText, click } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

const base = {
  pageSize: 10,
  onRetry: vi.fn(),
  onReset: vi.fn(),
  emptyText: 'Provision an organization and invite its first owner.',
};

test('loading renders one skeleton row per page row', async () => {
  const view = await render(
    <DataStates {...base} pageSize={7} status="loading" />,
  );
  expect(
    view.container.querySelectorAll('[data-slot="data-skeleton-row"]'),
  ).toHaveLength(7);
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
});

test('empty shows the caller text and no reset button', async () => {
  const view = await render(<DataStates {...base} status="empty" />);
  expect(view.container.textContent).toContain('Nothing here yet');
  expect(view.container.textContent).toContain(base.emptyText);
  expect(byText(view.container, 'button', 'Reset filters')).toBeUndefined();
});

test('no results offers Reset filters, which calls onReset', async () => {
  const onReset = vi.fn();
  const view = await render(
    <DataStates
      {...base}
      onReset={onReset}
      status="no-results"
      query="notaris"
    />,
  );
  expect(view.container.textContent).toContain('No records match “notaris”');
  await click(byText(view.container, 'button', 'Reset filters')!);
  expect(onReset).toHaveBeenCalledOnce();
});

test('failure shows Try again, which calls onRetry', async () => {
  const onRetry = vi.fn();
  const view = await render(
    <DataStates {...base} onRetry={onRetry} status="error" />,
  );
  expect(view.container.querySelector('[role="alert"]')!.textContent).toContain(
    'We could not load',
  );
  await click(byText(view.container, 'button', 'Try again')!);
  expect(onRetry).toHaveBeenCalledOnce();
});

test('failure never shows the empty text', async () => {
  const view = await render(<DataStates {...base} status="error" />);
  expect(view.container.textContent).not.toContain(base.emptyText);
  expect(view.container.textContent).not.toContain('Nothing here yet');
});

test('ready renders nothing', async () => {
  const view = await render(<DataStates {...base} status="ready" />);
  expect(view.container.innerHTML).toBe('');
});
