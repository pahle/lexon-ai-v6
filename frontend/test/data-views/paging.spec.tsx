import { afterEach, expect, test, vi } from 'vitest';
import { PagedFooter } from '../../src/components/data-views';
import { render, settle } from '../render';
import { byLabel, click } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

const props = { onPage: vi.fn(), onPageSize: vi.fn() };
const disabled = (el: HTMLElement | null) =>
  (el as HTMLButtonElement).disabled ||
  el?.getAttribute('aria-disabled') === 'true';

test('shows count, Rows per page, and Page N of M', async () => {
  const view = await render(
    <PagedFooter {...props} page={2} pageSize={10} total={45} />,
  );
  expect(view.container.textContent).toContain('45 records');
  expect(view.container.textContent).toContain('Rows per page');
  expect(view.container.textContent).toContain('Page 2 of 5');
});

test('first and previous are disabled on page 1', async () => {
  const view = await render(
    <PagedFooter {...props} page={1} pageSize={10} total={45} />,
  );
  expect(disabled(byLabel(view.container, 'First page'))).toBe(true);
  expect(disabled(byLabel(view.container, 'Previous page'))).toBe(true);
  expect(disabled(byLabel(view.container, 'Next page'))).toBe(false);
});

test('next and last are disabled on the last page', async () => {
  const view = await render(
    <PagedFooter {...props} page={5} pageSize={10} total={45} />,
  );
  expect(disabled(byLabel(view.container, 'Next page'))).toBe(true);
  expect(disabled(byLabel(view.container, 'Last page'))).toBe(true);
  expect(disabled(byLabel(view.container, 'Previous page'))).toBe(false);
});

test('icon buttons move to first, previous, next, last', async () => {
  const onPage = vi.fn();
  const view = await render(
    <PagedFooter
      {...props}
      onPage={onPage}
      page={3}
      pageSize={10}
      total={45}
    />,
  );
  for (const label of ['First page', 'Previous page', 'Next page', 'Last page'])
    await click(byLabel(view.container, label)!);
  expect(onPage.mock.calls.map((c) => c[0])).toEqual([1, 2, 4, 5]);
});

test('page-size change resets to page 1', async () => {
  const onPage = vi.fn();
  const onPageSize = vi.fn();
  const view = await render(
    <PagedFooter
      onPage={onPage}
      onPageSize={onPageSize}
      page={3}
      pageSize={10}
      total={45}
    />,
  );
  await click(view.container.querySelector('[data-slot="select-trigger"]')!);
  await settle();
  const options = Array.from(document.body.querySelectorAll('[role="option"]'));
  expect(options.map((o) => o.textContent)).toEqual(['10', '20', '50']);
  await click(options[2]!);
  expect(onPageSize).toHaveBeenCalledWith(50);
  expect(onPage).toHaveBeenCalledWith(1);
});

test('out-of-range page moves to last page', async () => {
  const onPage = vi.fn();
  await render(
    <PagedFooter
      {...props}
      onPage={onPage}
      page={9}
      pageSize={10}
      total={45}
    />,
  );
  expect(onPage).toHaveBeenCalledWith(5);
});

test('an empty total has one page and does not move', async () => {
  const onPage = vi.fn();
  const view = await render(
    <PagedFooter {...props} onPage={onPage} page={1} pageSize={10} total={0} />,
  );
  expect(view.container.textContent).toContain('Page 1 of 1');
  expect(onPage).not.toHaveBeenCalled();
});
