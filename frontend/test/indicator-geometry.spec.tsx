import { describe, expect, it } from 'vitest';
import {
  DOT_COUNT,
  MARKS,
  blend,
  clamp01,
  createDotSeeds,
  easeInOutCubic,
  patternPosition,
  reseedAnchors,
  smoothstep,
} from '@/components/chat/indicator/indicator-geometry';
import {
  MARK_PATH_LENGTHS,
  MARK_POINTS,
} from '@/components/chat/indicator/indicator-points';
import {
  createSeededRandom,
  type MarkId,
  type PatternId,
} from '@/components/chat/indicator/indicator-sequence';

const PATTERNS: readonly PatternId[] = [
  'scatter',
  'orbit',
  'swarm',
  'spiral',
  'figure8',
];
const MARK_IDS: readonly MarkId[] = [
  'lexon',
  'section',
  'writing',
  'paper',
  'highlighter',
  'column',
  'pilcrow',
];

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

describe('patterns', () => {
  const seeds = createDotSeeds(createSeededRandom(7));

  it('creates one seed per dot with prototype ranges', () => {
    expect(DOT_COUNT).toBe(26);
    expect(seeds).toHaveLength(26);
    for (const s of seeds) {
      expect(s.phase).toBeGreaterThanOrEqual(0);
      expect(s.phase).toBeLessThan(6.28);
      expect(s.size).toBeGreaterThanOrEqual(0.75);
      expect(s.size).toBeLessThan(1.25);
      expect(s.speed).toBeGreaterThanOrEqual(0.8);
      expect(s.speed).toBeLessThan(1.3);
      expect(s.jitter).toBeGreaterThanOrEqual(0);
      expect(s.jitter).toBeLessThan(1);
      expect([s.anchorX, s.anchorY]).toEqual([10, 10]);
    }
  });

  it('draws seeds in the prototype order (phase, size, speed, jitter)', () => {
    const values = [0.5, 0.25, 0.5, 0.75];
    let n = 0;
    const first = at(
      createDotSeeds(() => at(values, n++ % 4)),
      0,
    );
    expect(first).toEqual({
      phase: 0.5 * 6.28,
      size: 0.75 + 0.25 * 0.5,
      speed: 0.8 + 0.5 * 0.5,
      jitter: 0.75,
      anchorX: 10,
      anchorY: 10,
    });
  });

  it.each(PATTERNS)('%s stays finite and inside [-2, 22]', (pattern) => {
    for (const t of [0, 1.7, 30, 600]) {
      for (let i = 0; i < 26; i += 1) {
        const [x, y] = patternPosition(pattern, i, t, at(seeds, i));
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-2);
        expect(x).toBeLessThanOrEqual(22);
        expect(y).toBeGreaterThanOrEqual(-2);
        expect(y).toBeLessThanOrEqual(22);
      }
    }
  });

  it.each(PATTERNS)('%s is continuous over one frame', (pattern) => {
    const reseeded = reseedAnchors(seeds, createSeededRandom(3));
    for (const set of [seeds, reseeded]) {
      for (const t of [0, 1.7, 30, 600]) {
        for (let i = 0; i < 26; i += 1) {
          const [x0, y0] = patternPosition(pattern, i, t, at(set, i));
          const [x1, y1] = patternPosition(pattern, i, t + 1 / 60, at(set, i));
          expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(1.5);
        }
      }
    }
  });

  it('matches hand-computed prototype values', () => {
    const s = {
      phase: 1,
      size: 1,
      speed: 1,
      jitter: 0.5,
      anchorX: 8,
      anchorY: 12,
    };
    const near = (a: readonly [number, number], b: [number, number]) => {
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    };
    near(patternPosition('scatter', 0, 0, s), [
      8 + 1.7 * Math.sin(1) + 0.9 * Math.sin(3),
      12 + 1.7 * Math.cos(1.4) + 0.9 * Math.sin(2),
    ]);
    const a = 1 + 2.2;
    const r = (4.2 + 1.6 * Math.sin(1.7)) * (1 + 0.12 * Math.sin(2.1 + 1));
    near(patternPosition('orbit', 1, 1, s), [
      10 + r * Math.cos(a),
      10 + r * Math.sin(a) * 0.92,
    ]);
    near(patternPosition('swarm', 0, 1, s), [
      10 + 5.6 * Math.sin(1.1 + 1) * Math.cos(0.6 + 1.5),
      10 + 5.6 * Math.sin(1.6 + 1.3),
    ]);
    const f = 13 / 26;
    const sa = f * 9.5 + 1 * (2.4 - 1.2 * f);
    const sr = 1.2 + 6.2 * f * (1 + 0.15 * Math.sin(1.8));
    near(patternPosition('spiral', 13, 1, s), [
      10 + sr * Math.cos(sa),
      10 + sr * Math.sin(sa),
    ]);
    const fa = 1.6 + (13 / 26) * 6.28;
    near(patternPosition('figure8', 13, 1, s), [
      10 + 6 * Math.sin(fa),
      10 + 3.6 * Math.sin(2 * fa) + 0.6 * Math.sin(3 + 1),
    ]);
  });

  it('reseedAnchors keeps size, speed, jitter and moves anchors and phase', () => {
    const next = reseedAnchors(seeds, createSeededRandom(11));
    expect(next).toHaveLength(26);
    next.forEach((n, i) => {
      expect(n.size).toBe(at(seeds, i).size);
      expect(n.speed).toBe(at(seeds, i).speed);
      expect(n.jitter).toBe(at(seeds, i).jitter);
      expect(n.anchorX).toBeGreaterThanOrEqual(3.5);
      expect(n.anchorX).toBeLessThanOrEqual(16.5);
      expect(n.anchorY).toBeGreaterThanOrEqual(3.5);
      expect(n.anchorY).toBeLessThanOrEqual(16.5);
      expect(n.phase).toBeGreaterThanOrEqual(0);
      expect(n.phase).toBeLessThan(6.28);
    });
    expect(at(next, 0).anchorX).not.toBe(at(seeds, 0).anchorX);
    expect(at(next, 0).phase).not.toBe(at(seeds, 0).phase);
  });

  it('reseedAnchors draws anchorX, anchorY, phase per dot, in order', () => {
    const values = [0, 0.5, 1, 0.25];
    let n = 0;
    const first = at(
      reseedAnchors(seeds, () => at(values, n++ % 4)),
      0,
    );
    expect(first.anchorX).toBe(3.5);
    expect(first.anchorY).toBe(3.5 + 0.5 * 13);
    expect(first.phase).toBe(6.28);
  });

  it('does not mutate the seeds it is given', () => {
    const before = JSON.stringify(seeds);
    reseedAnchors(seeds, createSeededRandom(5));
    expect(JSON.stringify(seeds)).toBe(before);
  });
});

describe('interpolation and easing', () => {
  it('blend returns a at 0, b at 1, and the midpoint at 0.5', () => {
    const a = [2, 4] as const;
    const b = [10, 20] as const;
    expect(blend(a, b, 0)).toEqual([2, 4]);
    expect(blend(a, b, 1)).toEqual([10, 20]);
    expect(blend(a, b, 0.5)).toEqual([6, 12]);
  });

  it.each([
    ['easeInOutCubic', easeInOutCubic],
    ['smoothstep', smoothstep],
  ])('%s is 0 at 0, 1 at 1, and monotonic', (_name, fn) => {
    expect(fn(0)).toBe(0);
    expect(fn(1)).toBe(1);
    expect(fn(0.5)).toBeCloseTo(0.5, 12);
    let previous = -Infinity;
    for (let n = 0; n <= 20; n += 1) {
      const value = fn(n / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('matches the prototype curves', () => {
    expect(easeInOutCubic(0.25)).toBeCloseTo(4 * 0.25 ** 3, 12);
    expect(easeInOutCubic(0.75)).toBeCloseTo(1 - Math.pow(-1.5 + 2, 3) / 2, 12);
    expect(smoothstep(0.25)).toBeCloseTo(0.0625 * 2.5, 12);
  });

  it('clamp01 clamps', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(7)).toBe(1);
  });
});

describe('marks', () => {
  it('defines all seven marks with generated point tables', () => {
    expect(Object.keys(MARKS).sort()).toEqual([...MARK_IDS].sort());
    for (const id of MARK_IDS) {
      expect(MARKS[id].id).toBe(id);
      expect(MARK_POINTS[id]).toHaveLength(26);
      expect(MARK_PATH_LENGTHS[id]).toHaveLength(MARKS[id].paths.length);
    }
  });

  it('carries the prototype stroke widths and extras', () => {
    expect(MARKS.lexon.strokeWidth).toBe(1.1);
    for (const id of MARK_IDS.filter((m) => m !== 'lexon')) {
      expect(MARKS[id].strokeWidth).toBe(1.5);
    }
    expect(MARKS.writing.dim).toEqual([0]);
    expect(MARKS.highlighter.dim).toEqual([0, 1, 2]);
    expect(MARKS.highlighter.accent).toBe('M3 10h14');
    expect(MARKS.column.shimmer).toEqual([2, 3, 4]);
    expect(MARKS.paper.paths).toHaveLength(5);
    expect(MARKS.column.paths).toHaveLength(7);
    expect(MARKS.pilcrow.paths).toHaveLength(3);
    expect(MARKS.section.paths).toHaveLength(2);
    expect(MARKS.writing.paths).toHaveLength(2);
    expect(MARKS.highlighter.paths).toHaveLength(3);
  });

  it('marks only the lexon monogram as fillAfter', () => {
    expect(MARKS.lexon.fillAfter).toBe(true);
    for (const id of MARK_IDS.filter((m) => m !== 'lexon')) {
      expect(MARKS[id].fillAfter).toBeFalsy();
    }
  });
});
