import { act, Profiler, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LexonMark } from '@/components/chat/indicator/lexon-mark';
import { ThinkingIndicator } from '@/components/chat/indicator/thinking-indicator';
import {
  forget,
  noteRunning,
  resetIndicatorRuns,
  takeFinish,
} from '@/components/chat/indicator/indicator-run-store';
import { MARKS } from '@/components/chat/indicator/indicator-geometry';
import {
  createSeededRandom,
  createTimeline,
  type PhaseKind,
} from '@/components/chat/indicator/indicator-sequence';
import { render } from './render';

// --- manual frame clock ------------------------------------------------------
let now = 0;
let nextFrameId = 1;
const frames = new Map<number, FrameRequestCallback>();
let rafCalls = 0;
let cancelCalls: number[] = [];

async function advance(ms: number) {
  await act(async () => {
    let left = ms;
    while (left > 0) {
      const step = Math.min(16, left);
      left -= step;
      now += step;
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback(now);
    }
  });
}

// --- matchMedia and visibility stubs ----------------------------------------
let reduced = false;
const mediaListeners = new Set<() => void>();
let visibility: 'visible' | 'hidden' = 'visible';

async function setReduced(value: boolean) {
  reduced = value;
  await act(async () => {
    for (const listener of [...mediaListeners]) listener();
  });
}
async function setVisibility(value: 'visible' | 'hidden') {
  visibility = value;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  now = 0;
  nextFrameId = 1;
  frames.clear();
  rafCalls = 0;
  cancelCalls = [];
  reduced = false;
  visibility = 'visible';
  mediaListeners.clear();
  resetIndicatorRuns();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      rafCalls += 1;
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      cancelCalls.push(id);
      frames.delete(id);
    }),
  );
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('prefers-reduced-motion') ? reduced : false;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) =>
        mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        mediaListeners.delete(listener),
    })),
  );
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// --- helpers -----------------------------------------------------------------
const SEED = 11;
const LEXON_D = MARKS.lexon.paths;

/** A time inside the first phase of `kind` (and mark, if given). */
function momentIn(
  kind: PhaseKind,
  offsetMs: number,
  mark?: string,
  skipFirst = false,
): number {
  const timeline = createTimeline(createSeededRandom(SEED));
  let skipped = !skipFirst;
  for (let t = 0; t < 120000; t += 5) {
    const { phase } = timeline.phaseAt(t);
    if (phase.kind !== kind || (mark && phase.mark !== mark)) continue;
    if (!skipped) {
      skipped = true;
      t = phase.startMs + phase.durationMs;
      continue;
    }
    return phase.startMs + offsetMs;
  }
  throw new Error('no such phase');
}

function indicator(state: 'running' | 'finished', id = 'm1'): ReactNode {
  return <ThinkingIndicator state={state} messageId={id} seed={SEED} />;
}
function svgOf(container: HTMLElement) {
  return container.querySelector('svg[aria-hidden="true"]') as SVGSVGElement;
}
function lexonOutline(container: HTMLElement) {
  return Array.from(svgOf(container).querySelectorAll('g path'));
}
function visibleDots(container: HTMLElement) {
  return Array.from(container.querySelectorAll('circle')).filter(
    (circle) => Number(circle.getAttribute('r')) > 0,
  );
}
function expectStaticLexon(container: HTMLElement) {
  const svg = svgOf(container);
  expect(svg.querySelectorAll('circle')).toHaveLength(0);
  expect(svg.getAttribute('fill')).toBe('currentColor');
  expect(
    Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('d')),
  ).toEqual([...LEXON_D]);
}

// --- LexonMark ----------------------------------------------------------------
describe('LexonMark', () => {
  it('renders the static filled monogram through renderToString', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(<LexonMark />);
    const svg = host.querySelector('svg[aria-hidden="true"]')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.querySelectorAll('path')).toHaveLength(3);
  });

  it('renders the brand micro-seal shapes in order (MARKS.lexon.paths)', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(<LexonMark className="size-5" />);
    const ds = Array.from(host.querySelectorAll('path')).map((p) =>
      p.getAttribute('d'),
    );
    expect(ds).toEqual([...MARKS.lexon.paths]);
    expect(host.querySelector('svg')!.getAttribute('class')).toBe('size-5');
  });
});

// --- run store -------------------------------------------------------------------
describe('indicator run store', () => {
  it('remembers the first start and seed for an id', () => {
    expect(noteRunning('a', 100, 5)).toEqual({ startedAtMs: 100, seed: 5 });
    expect(noteRunning('a', 900, 6)).toEqual({ startedAtMs: 100, seed: 5 });
    expect(noteRunning('b', 900, 6)).toEqual({ startedAtMs: 900, seed: 6 });
  });

  it('takeFinish is animate once for an id seen running, else static', () => {
    expect(takeFinish('never')).toBe('static');
    noteRunning('a', 0, 1);
    expect(takeFinish('a')).toBe('animate');
    expect(takeFinish('a')).toBe('static');
  });

  it('forget and reset drop entries', () => {
    noteRunning('a', 0, 1);
    forget('a');
    expect(takeFinish('a')).toBe('static');
    noteRunning('b', 0, 1);
    resetIndicatorRuns();
    expect(takeFinish('b')).toBe('static');
    expect(noteRunning('b', 50, 2)).toEqual({ startedAtMs: 50, seed: 2 });
  });
});

// --- ThinkingIndicator ------------------------------------------------------------
describe('ThinkingIndicator', () => {
  it('renders the static mark for a first-render finished state, with no frames', async () => {
    const view = await render(indicator('finished'));
    expectStaticLexon(view.container);
    await advance(1000);
    expect(rafCalls).toBe(0);
    await view.unmount();
  });

  it('puts the mark color on the wrapper as tokens for both themes', async () => {
    for (const state of ['running', 'finished'] as const) {
      const view = await render(indicator(state, `c-${state}`));
      const wrapper = svgOf(view.container).parentElement!;
      expect(wrapper.className).toContain('text-primary');
      expect(wrapper.className).toContain('dark:text-(--lexon-red-text)');
      expect(wrapper.className).not.toMatch(/#[0-9a-f]{3,6}/i);
      await view.unmount();
    }
  });

  it('runs in a fixed 20 px svg whose box never changes', async () => {
    const view = await render(indicator('running'));
    const svg = svgOf(view.container);
    const box = () =>
      [
        svg.getAttribute('width'),
        svg.getAttribute('height'),
        svg.getAttribute('viewBox'),
      ].join('|');
    const first = box();
    expect(first).toBe('20|20|0 0 20 20');
    for (const t of [200, 900, 1500, 4000, 9000]) {
      await advance(t);
      expect(svgOf(view.container)).toBe(svg);
      expect(box()).toBe(first);
    }
    await view.unmount();
  });

  it('draws the Lexon outline to stroke-dashoffset 0 within 1300 ms', async () => {
    const view = await render(indicator('running'));
    await advance(600);
    const mid = lexonOutline(view.container).map((p) =>
      Number(p.getAttribute('stroke-dashoffset')),
    );
    expect(mid.some((offset) => offset > 0)).toBe(true);
    await advance(700);
    const done = lexonOutline(view.container).map((p) =>
      p.getAttribute('stroke-dashoffset'),
    );
    expect(done).toHaveLength(3);
    expect(done.every((offset) => Number(offset) === 0)).toBe(true);
    expect(visibleDots(view.container)).toHaveLength(0);
    await view.unmount();
  });

  it('shows exactly 26 dots with a radius during a wander phase', async () => {
    const view = await render(indicator('running'));
    await advance(momentIn('wander', 2000));
    expect(view.container.querySelectorAll('circle')).toHaveLength(26);
    expect(visibleDots(view.container)).toHaveLength(26);
    expect(view.container.querySelectorAll('g path')).toHaveLength(0);
    await view.unmount();
  });

  const MOMENTS: [string, () => number][] = [
    ['mid-draw of Lexon', () => 600],
    ['hold of another mark', () => momentIn('hold', 100, undefined, true)],
    ['dissolve', () => momentIn('dissolve', 300)],
    ['wander', () => momentIn('wander', 3000)],
    ['settle', () => momentIn('settle', 500)],
  ];
  for (const [name, at] of MOMENTS) {
    it(`finishes on the filled Lexon mark within 4600 ms from ${name}`, async () => {
      const view = await render(indicator('running'));
      await advance(at());
      await view.rerender(indicator('finished'));
      await advance(4600);
      expectStaticLexon(view.container);
      expect(frames.size).toBe(0);
      const before = rafCalls;
      await advance(2000);
      expect(rafCalls).toBe(before);
      await view.unmount();
    });
  }

  for (const [name, at] of [
    ['mid-draw', 600],
    ['hold', 2000],
  ] as const) {
    it(`never un-draws or un-fills the Lexon outline when finishing in ${name}`, async () => {
      const view = await render(indicator('running'));
      await advance(at);
      const sample = () => {
        const group = view.container.querySelector('svg g');
        if (!group) return null;
        return {
          offsets: Array.from(group.querySelectorAll('path')).map((p) =>
            Number(p.getAttribute('stroke-dashoffset')),
          ),
          fill: Number(group.getAttribute('fill-opacity')),
        };
      };
      let last = sample()!;
      await view.rerender(indicator('finished'));
      for (let t = 0; t < 4600; t += 16) {
        await advance(16);
        const next = sample();
        if (!next) continue;
        next.offsets.forEach((offset, i) =>
          expect(offset).toBeLessThanOrEqual(last.offsets[i]! + 1e-9),
        );
        expect(next.fill).toBeGreaterThanOrEqual(last.fill - 1e-9);
        last = next;
      }
      await view.unmount();
    });
  }

  it('carries the half-unwritten outline through a finish mid-dissolve', async () => {
    const view = await render(indicator('running'));
    await advance(momentIn('dissolve', 550));
    const offsets = () =>
      Array.from(view.container.querySelectorAll('svg g path')).map((p) =>
        Number(p.getAttribute('stroke-dashoffset')),
      );
    const lastRunning = offsets();
    expect(lastRunning.some((o) => o !== 0)).toBe(true);
    await view.rerender(indicator('finished'));
    // The first finish frame, at the same instant as the last running frame.
    await act(async () => {
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback(now);
    });
    expect(view.container.querySelector('svg g')).not.toBeNull();
    offsets().forEach((offset, i) =>
      expect(Math.abs(offset - lastRunning[i]!)).toBeLessThan(0.01),
    );
    await advance(300);
    expect(view.container.querySelector('svg g')).not.toBeNull();
    await advance(300);
    expect(view.container.querySelector('svg g')).toBeNull();
    await view.unmount();
  });

  it('keeps the finish moving through frames before it ends', async () => {
    const view = await render(indicator('running'));
    await advance(momentIn('wander', 3000));
    await view.rerender(indicator('finished'));
    await advance(1000);
    expect(frames.size).toBe(1);
    expect(visibleDots(view.container).length).toBeGreaterThan(0);
    await view.unmount();
  });

  it('plays the finish when remounted as finished after being seen running', async () => {
    const first = await render(indicator('running', 'r1'));
    await advance(2000);
    await first.unmount();
    const second = await render(indicator('finished', 'r1'));
    const before = rafCalls;
    expect(before).toBeGreaterThan(0);
    await advance(4600);
    expectStaticLexon(second.container);
    expect(frames.size).toBe(0);
    await second.unmount();
  });

  it('continues the same run when remounted as running', async () => {
    const first = await render(indicator('running', 'r2'));
    await advance(momentIn('wander', 1000));
    await first.unmount();
    const second = await render(indicator('running', 'r2'));
    await advance(16);
    expect(visibleDots(second.container)).toHaveLength(26);
    await second.unmount();
  });

  it('renders a finished mount for an id never seen running as static', async () => {
    const view = await render(indicator('finished', 'unseen'));
    expectStaticLexon(view.container);
    expect(rafCalls).toBe(0);
    await view.unmount();
  });

  it('does not re-render React per frame', async () => {
    let commits = 0;
    const view = await render(
      <Profiler id="indicator" onRender={() => (commits += 1)}>
        {indicator('running')}
      </Profiler>,
    );
    await advance(48);
    const baseline = commits;
    await advance(600 * 16);
    expect(commits).toBe(baseline);
    await view.unmount();
  });

  it('shows the static mark and starts no frames under reduced motion', async () => {
    reduced = true;
    const view = await render(indicator('running'));
    expectStaticLexon(view.container);
    await advance(1000);
    expect(rafCalls).toBe(0);
    await view.unmount();
  });

  it('switches to the static mark and cancels the loop when reduced motion turns on', async () => {
    const view = await render(indicator('running'));
    await advance(500);
    expect(frames.size).toBe(1);
    await setReduced(true);
    expectStaticLexon(view.container);
    expect(frames.size).toBe(0);
    expect(cancelCalls.length).toBeGreaterThan(0);
    const before = rafCalls;
    await advance(1000);
    expect(rafCalls).toBe(before);
    await view.unmount();
  });

  it('pauses frame scheduling while hidden and resumes when visible', async () => {
    const view = await render(indicator('running'));
    await advance(500);
    await setVisibility('hidden');
    expect(frames.size).toBe(0);
    const before = rafCalls;
    await advance(1000);
    expect(rafCalls).toBe(before);
    await setVisibility('visible');
    expect(frames.size).toBe(1);
    await advance(100);
    expect(rafCalls).toBeGreaterThan(before);
    await view.unmount();
  });

  it('shows the static mark with no animation when finished arrives while hidden', async () => {
    const view = await render(indicator('running'));
    await advance(1500);
    await setVisibility('hidden');
    const before = rafCalls;
    await view.rerender(indicator('finished'));
    expectStaticLexon(view.container);
    await setVisibility('visible');
    await advance(1000);
    expect(rafCalls).toBe(before);
    expect(frames.size).toBe(0);
    await view.unmount();
  });

  it('cancels the pending frame on unmount', async () => {
    const view = await render(indicator('running'));
    await advance(100);
    expect(frames.size).toBe(1);
    const pending = [...frames.keys()][0]!;
    await view.unmount();
    expect(cancelCalls).toContain(pending);
    expect(frames.size).toBe(0);
  });

  it('defaults the seed from crypto.getRandomValues', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const view = await render(
      <ThinkingIndicator state="running" messageId="seedless" />,
    );
    expect(spy).toHaveBeenCalled();
    await view.unmount();
  });
});
