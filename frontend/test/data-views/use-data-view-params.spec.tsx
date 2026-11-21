import { afterEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { useDataViewParams } from '../../src/components/data-views';
import { render } from '../render';

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  search: 'query=notaris&status=active&page=4',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/platform/accounts',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

afterEach(() => nav.replace.mockClear());

type Hook = ReturnType<typeof useDataViewParams>;
async function mount() {
  const box: { current?: Hook } = {};
  const Probe = () => {
    box.current = useDataViewParams(['status']);
    return null;
  };
  await render(<Probe />);
  return box as { current: Hook };
}

test('a page-size change is one replace with pageSize and page 1', async () => {
  const hook = await mount();
  await act(async () => hook.current.set({ pageSize: 50 }));
  expect(nav.replace).toHaveBeenCalledExactlyOnceWith(
    '/platform/accounts?query=notaris&status=active&pageSize=50',
  );
});

test('two sequential sets both survive', async () => {
  const hook = await mount();
  await act(async () => {
    hook.current.set({ query: 'ayu' });
    hook.current.set({ facets: { status: ['disabled'] } });
  });
  expect(nav.replace).toHaveBeenLastCalledWith(
    '/platform/accounts?query=ayu&status=disabled',
  );
});

test('a page-only patch keeps the filters', async () => {
  const hook = await mount();
  await act(async () => hook.current.set({ page: 2 }));
  expect(nav.replace).toHaveBeenCalledWith(
    '/platform/accounts?query=notaris&status=active&page=2',
  );
});

test('reads query, repeated facets, page and page size from the URL', async () => {
  nav.search = 'query=ayu&status=active&status=disabled&page=2&pageSize=50';
  const hook = await mount();
  nav.search = 'query=notaris&status=active&page=4';
  expect(hook.current).toMatchObject({
    query: 'ayu',
    facets: { status: ['active', 'disabled'] },
    page: 2,
    pageSize: 50,
  });
});

test('reset clears query and facets and the page', async () => {
  const hook = await mount();
  await act(async () => hook.current.reset());
  expect(nav.replace).toHaveBeenCalledExactlyOnceWith('/platform/accounts');
});
