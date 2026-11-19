import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTreePolling } from '../src/components/chat/use-tree-polling.js';
import { render } from './render.js';

type Opts = Parameters<typeof useTreePolling>[0];
let handle: ReturnType<typeof useTreePolling> | undefined;
function Probe(props: { readonly opts: Opts }) {
  handle = useTreePolling(props.opts);
  return null;
}
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}
async function mount(opts: Partial<Opts> & Pick<Opts, 'fetchTree'>) {
  return render(
    <Probe
      opts={{ isUrgent: () => false, onFailures: () => undefined, ...opts }}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

it('polls every 1 s while urgent', async () => {
  const fetchTree = vi.fn(async () => undefined);
  const view = await mount({ fetchTree, isUrgent: () => true });
  await vi.advanceTimersByTimeAsync(3_000);
  expect(fetchTree).toHaveBeenCalledTimes(3);
  await view.unmount();
});

it('polls every 5 s otherwise', async () => {
  const fetchTree = vi.fn(async () => undefined);
  const view = await mount({ fetchTree });
  await vi.advanceTimersByTimeAsync(4_999);
  expect(fetchTree).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchTree).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fetchTree).toHaveBeenCalledTimes(3);
  await view.unmount();
});

it('no fetch while hidden', async () => {
  const fetchTree = vi.fn(async () => undefined);
  const view = await mount({ fetchTree, isUrgent: () => true });
  setVisibility('hidden');
  await vi.advanceTimersByTimeAsync(20_000);
  expect(fetchTree).not.toHaveBeenCalled();
  await view.unmount();
});

it('one immediate fetch on visible', async () => {
  const fetchTree = vi.fn(async () => undefined);
  const view = await mount({ fetchTree });
  setVisibility('hidden');
  await vi.advanceTimersByTimeAsync(20_000);
  setVisibility('visible');
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchTree).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it('one immediate fetch on window focus', async () => {
  const fetchTree = vi.fn(async () => undefined);
  const view = await mount({ fetchTree });
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchTree).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it('a superseded fetch is aborted', async () => {
  const signals: AbortSignal[] = [];
  const fetchTree = vi.fn(
    (signal: AbortSignal) =>
      new Promise<void>(() => {
        signals.push(signal);
      }),
  );
  const view = await mount({ fetchTree });
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(signals).toHaveLength(2);
  expect(signals[0]!.aborted).toBe(true);
  expect(signals[1]!.aborted).toBe(false);
  await view.unmount();
});

it('5 consecutive failures call onFailures', async () => {
  const fetchTree = vi.fn(async () => {
    throw new Error('offline');
  });
  const onFailures = vi.fn();
  const view = await mount({ fetchTree, onFailures, isUrgent: () => true });
  await vi.advanceTimersByTimeAsync(4_000);
  expect(onFailures).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(onFailures).toHaveBeenCalledWith(5);
  await view.unmount();
});

it('a success resets the failure count', async () => {
  let fail = true;
  const fetchTree = vi.fn(async () => {
    if (fail) throw new Error('offline');
  });
  const onFailures = vi.fn();
  const view = await mount({ fetchTree, onFailures, isUrgent: () => true });
  await vi.advanceTimersByTimeAsync(4_000);
  fail = false;
  await vi.advanceTimersByTimeAsync(1_000);
  fail = true;
  await vi.advanceTimersByTimeAsync(4_000);
  expect(onFailures).not.toHaveBeenCalled();
  await view.unmount();
});

it('run ends while hidden: one fetch on return shows the final state', async () => {
  let state = 'running';
  let shown = '';
  const fetchTree = vi.fn(async () => {
    shown = state;
  });
  const view = await mount({ fetchTree, isUrgent: () => true });
  setVisibility('hidden');
  state = 'finished';
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetchTree).not.toHaveBeenCalled();
  setVisibility('visible');
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchTree).toHaveBeenCalledTimes(1);
  expect(shown).toBe('finished');
  await view.unmount();
});

it('refreshNow fetches immediately', async () => {
  const fetchTree = vi.fn(async () => undefined);
  const view = await mount({ fetchTree });
  handle!.refreshNow();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchTree).toHaveBeenCalledTimes(1);
  await view.unmount();
});
