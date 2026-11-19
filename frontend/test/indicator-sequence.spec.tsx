import { describe, expect, it } from 'vitest';
import {
  BLEND_MS,
  createSeededRandom,
  createTimeline,
  planFinish,
  planWander,
  shuffleRound,
  type MarkId,
  type PatternId,
  type Phase,
  type Random,
} from '@/components/chat/indicator/indicator-sequence';

const ALL_MARKS: readonly MarkId[] = [
  'lexon',
  'section',
  'writing',
  'paper',
  'highlighter',
  'column',
  'pilcrow',
];
const ALL_PATTERNS: readonly PatternId[] = [
  'scatter',
  'orbit',
  'swarm',
  'spiral',
  'figure8',
];

const DRAW_MS: Record<MarkId, number> = {
  lexon: 1300,
  section: 900,
  writing: 1200,
  paper: 1000,
  highlighter: 700,
  column: 1000,
  pilcrow: 800,
};
const SETTLED_DRAW_MS: Record<MarkId, number> = {
  lexon: 1820,
  section: 1260,
  writing: 1680,
  paper: 1400,
  highlighter: 980,
  column: 1400,
  pilcrow: 1120,
};
const HOLD_MS: Record<MarkId, number> = {
  lexon: 1900,
  section: 900,
  writing: 900,
  paper: 900,
  highlighter: 1300,
  column: 1400,
  pilcrow: 900,
};

const zero: Random = () => 0;
const high: Random = () => 0.999;

function scripted(values: readonly number[]) {
  let used = 0;
  const random: Random = () => {
    if (used >= values.length) throw new Error('random exhausted');
    return values[used++]!;
  };
  return { random, used: () => used };
}

// Walks the timeline from 0 and returns the first `count` phases.
function walk(random: Random, count: number): Phase[] {
  const timeline = createTimeline(random);
  const phases: Phase[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const { phase } = timeline.phaseAt(t);
    phases.push(phase);
    t = phase.startMs + phase.durationMs;
  }
  return phases;
}

describe('createSeededRandom', () => {
  it('yields the mulberry32 sequence for seed 1 on every call', () => {
    const expected = [
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
      0.9810509674716741, 0.9683778982143849,
    ];
    for (let run = 0; run < 2; run++) {
      const random = createSeededRandom(1);
      expect(Array.from({ length: 5 }, () => random())).toEqual(expected);
    }
  });

  it('yields different sequences for different seeds', () => {
    const two = createSeededRandom(2);
    expect(Array.from({ length: 5 }, () => two())).toEqual([
      0.7342509443406016, 0.32499843230471015, 0.28529605525545776,
      0.5379551574587822, 0.8752879470121115,
    ]);
    const zeroSeed = createSeededRandom(0);
    expect(zeroSeed()).toBe(0.26642920868471265);
  });

  it('stays inside [0, 1)', () => {
    const random = createSeededRandom(99);
    for (let i = 0; i < 2000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('shuffleRound', () => {
  it('starts with lexon and holds the other six marks exactly once', () => {
    const round = shuffleRound(createSeededRandom(5));
    expect(round).toHaveLength(7);
    expect(round[0]).toBe('lexon');
    expect([...round].sort()).toEqual([...ALL_MARKS].sort());
  });

  it('gives the exact Fisher-Yates order for a known seed', () => {
    expect(shuffleRound(createSeededRandom(42))).toEqual([
      'lexon',
      'writing',
      'section',
      'column',
      'pilcrow',
      'paper',
      'highlighter',
    ]);
  });

  it('draws one random number per swap and nothing more', () => {
    const lows = scripted([0, 0, 0, 0, 0]);
    expect(shuffleRound(lows.random)).toEqual([
      'lexon',
      'writing',
      'paper',
      'highlighter',
      'column',
      'pilcrow',
      'section',
    ]);
    expect(lows.used()).toBe(5);

    const highs = scripted([0.999, 0.999, 0.999, 0.999, 0.999]);
    expect(shuffleRound(highs.random)).toEqual([
      'lexon',
      'section',
      'writing',
      'paper',
      'highlighter',
      'column',
      'pilcrow',
    ]);
    expect(highs.used()).toBe(5);
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(shuffleRound(createSeededRandom(3))).toEqual(
      shuffleRound(createSeededRandom(3)),
    );
    expect(shuffleRound(createSeededRandom(3))).not.toEqual(
      shuffleRound(createSeededRandom(4)),
    );
  });

  it('puts every non-lexon mark in every position 1-6 over 200 seeds', () => {
    const seen = new Map<string, Set<number>>();
    for (let seed = 0; seed < 200; seed++) {
      shuffleRound(createSeededRandom(seed)).forEach((mark, position) => {
        const positions = seen.get(mark) ?? new Set<number>();
        positions.add(position);
        seen.set(mark, positions);
      });
    }
    expect([...seen.get('lexon')!]).toEqual([0]);
    for (const mark of ALL_MARKS.slice(1)) {
      expect([...seen.get(mark)!].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });
});

describe('planWander', () => {
  it('exports the blend length', () => {
    expect(BLEND_MS).toBe(1600);
  });

  it('keeps the duration inside [10000, 14000] at both extremes', () => {
    expect(planWander(zero).durationMs).toBe(10000);
    const top = planWander(high).durationMs;
    expect(top).toBeCloseTo(10000 + 0.999 * 4000, 6);
    expect(top).toBeLessThanOrEqual(14000);
  });

  it('plans exact segments from a scripted random', () => {
    // duration, first pattern, then (gap, pattern) pairs and one rejected gap
    const script = scripted([0.5, 0, 0.2, 0, 0.4, 0.99, 0]);
    const plan = planWander(script.random);
    expect(plan.durationMs).toBe(12000);
    expect(plan.segments).toEqual([
      { pattern: 'scatter', startMs: 0 },
      { pattern: 'orbit', startMs: 3800 },
      { pattern: 'figure8', startMs: 9500 },
    ]);
    expect(script.used()).toBe(7);
  });

  it('picks the first pattern uniformly over the five patterns', () => {
    const picks = [0, 0.2, 0.4, 0.6, 0.8, 0.999].map(
      (r) =>
        planWander(scripted([0, r, 0.999, 0.999, 0.999, 0.999]).random)
          .segments[0]!.pattern,
    );
    expect(picks).toEqual([
      'scatter',
      'orbit',
      'swarm',
      'spiral',
      'figure8',
      'figure8',
    ]);
  });

  it('picks the next pattern uniformly over the four others', () => {
    const next = [0, 0.25, 0.5, 0.75, 0.999].map(
      (r) =>
        planWander(scripted([0, 0, 0, r, 0.999, 0.999, 0.999]).random)
          .segments[1]!.pattern,
    );
    expect(next).toEqual(['orbit', 'swarm', 'spiral', 'figure8', 'figure8']);
    const fromLast = planWander(scripted([0, 0.999, 0, 0, 0.999]).random);
    expect(fromLast.segments.map((s) => s.pattern)).toEqual([
      'figure8',
      'scatter',
    ]);
  });

  it('starts the first segment at 0 and spaces switches 3500-5000 after each blend', () => {
    for (const random of [zero, high]) {
      const plan = planWander(random);
      expect(plan.segments[0]!.startMs).toBe(0);
      expect(plan.segments[1]!.startMs).toBeGreaterThanOrEqual(3500);
      expect(plan.segments[1]!.startMs).toBeLessThanOrEqual(5000);
    }
    expect(planWander(zero).segments).toEqual([
      { pattern: 'scatter', startMs: 0 },
      { pattern: 'orbit', startMs: 3500 },
      { pattern: 'scatter', startMs: 8600 },
    ]);
  });

  it('keeps every invariant over 300 seeds', () => {
    for (let seed = 0; seed < 300; seed++) {
      const plan = planWander(createSeededRandom(seed));
      expect(plan.durationMs).toBeGreaterThanOrEqual(10000);
      expect(plan.durationMs).toBeLessThan(14000);
      const { segments } = plan;
      expect(segments[0]!.startMs).toBe(0);
      expect(segments.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < segments.length; i++) {
        const previous = segments[i - 1]!;
        const segment = segments[i]!;
        expect(segment.pattern).not.toBe(previous.pattern);
        expect(ALL_PATTERNS).toContain(segment.pattern);
        const gap =
          segment.startMs - (i === 1 ? 0 : previous.startMs + BLEND_MS);
        expect(gap).toBeGreaterThanOrEqual(3500);
        expect(gap).toBeLessThan(5000);
        expect(segment.startMs).toBeLessThan(plan.durationMs);
      }
    }
  });

  it('excludes a switch that would start exactly at the end and keeps one just before', () => {
    // switches at 4250 and 4250 + 1600 + 4625 = 10475
    const exact = planWander(scripted([0.11875, 0, 0.5, 0, 0.75]).random);
    expect(exact.durationMs).toBe(10475);
    expect(exact.segments.map((s) => s.startMs)).toEqual([0, 4250]);
    const justInside = planWander(
      scripted([0.119, 0, 0.5, 0, 0.75, 0.5, 0]).random,
    );
    expect(justInside.segments.map((s) => s.startMs)).toEqual([0, 4250, 10475]);
  });
});

describe('createTimeline', () => {
  it('lays out the first round exactly with a zero random', () => {
    const phases = walk(zero, 12);
    expect(
      phases.map((p) => [p.kind, p.mark, p.startMs, p.durationMs]),
    ).toEqual([
      ['draw', 'lexon', 0, 1300],
      ['hold', 'lexon', 1300, 1900],
      ['dissolve', 'lexon', 3200, 1100],
      ['wander', 'lexon', 4300, 10000],
      ['settle', 'writing', 14300, 1600],
      ['draw', 'writing', 15900, 1680],
      ['hold', 'writing', 17580, 900],
      ['dissolve', 'writing', 18480, 1100],
      ['wander', 'writing', 19580, 10000],
      ['settle', 'paper', 29580, 1600],
      ['draw', 'paper', 31180, 1400],
      ['hold', 'paper', 32580, 900],
    ]);
  });

  it('attaches a wander plan to wander phases only', () => {
    const phases = walk(createSeededRandom(8), 20);
    for (const phase of phases) {
      if (phase.kind === 'wander') {
        expect(phase.wander).toBeDefined();
        expect(phase.durationMs).toBe(phase.wander!.durationMs);
      } else {
        expect(Object.hasOwn(phase, 'wander')).toBe(false);
      }
    }
  });

  it('uses the prototype draw, hold, dissolve, and settle durations per mark', () => {
    const phases = walk(zero, 7 * 5 * 3 + 1);
    const settledOnce = new Set<MarkId>();
    for (const phase of phases) {
      if (phase.kind === 'settle') {
        expect(phase.durationMs).toBe(1600);
        settledOnce.add(phase.mark);
      }
      if (phase.kind === 'hold') {
        expect(phase.durationMs).toBe(HOLD_MS[phase.mark]);
      }
      if (phase.kind === 'dissolve') expect(phase.durationMs).toBe(1100);
      if (phase.kind === 'draw') {
        expect(phase.durationMs).toBe(
          phase === phases[0]
            ? DRAW_MS[phase.mark]
            : SETTLED_DRAW_MS[phase.mark],
        );
      }
    }
    expect(settledOnce.size).toBe(7);
  });

  it('keeps the first draw unscaled and scales only draws after a settle', () => {
    const [first, , , , , second] = walk(zero, 6);
    expect(first!.durationMs).toBe(DRAW_MS.lexon);
    expect(second!.durationMs).toBe(SETTLED_DRAW_MS.writing);
  });

  it('runs each mark as settle, draw, hold, dissolve, wander and starts a new round with lexon', () => {
    const phases = walk(createSeededRandom(11), 4 + 20 * 5);
    // first mark has no settle
    const kinds = phases.map((p) => p.kind);
    expect(kinds.slice(0, 4)).toEqual(['draw', 'hold', 'dissolve', 'wander']);
    for (let m = 0; m < 20; m++) {
      const at = 4 + m * 5;
      expect(kinds.slice(at, at + 5)).toEqual([
        'settle',
        'draw',
        'hold',
        'dissolve',
        'wander',
      ]);
      const mark = phases[at]!.mark;
      for (let k = 0; k < 4; k++) expect(phases[at + k]!.mark).toBe(mark);
      expect(phases[at + 4]!.mark).toBe(phases[at + 3]!.mark);
    }
  });

  it('plays three rounds with no mark skipped or repeated within a round', () => {
    const phases = walk(createSeededRandom(21), 4 + 20 * 5);
    const marks = phases.filter((p) => p.kind === 'draw').map((p) => p.mark);
    expect(marks).toHaveLength(21);
    for (let round = 0; round < 3; round++) {
      const slice = marks.slice(round * 7, round * 7 + 7);
      expect(slice[0]).toBe('lexon');
      expect([...slice].sort()).toEqual([...ALL_MARKS].sort());
    }
  });

  it('reshuffles each round with the injected random', () => {
    const rounds = [0, 1, 2, 3].map((round) =>
      walk(createSeededRandom(77), 4 + 35 * 5)
        .filter((p) => p.kind === 'draw')
        .slice(round * 7, round * 7 + 7)
        .map((p) => p.mark),
    );
    const distinct = new Set(rounds.map((r) => r.join(',')));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('is deterministic for a seed and varies between seeds', () => {
    expect(walk(createSeededRandom(5), 40)).toEqual(
      walk(createSeededRandom(5), 40),
    );
    expect(walk(createSeededRandom(5), 40)).not.toEqual(
      walk(createSeededRandom(6), 40),
    );
  });

  it('takes the wander plan, then the shuffle, from the injected random only', () => {
    const calls: number[] = [];
    const counting: Random = () => {
      calls.push(1);
      return 0.5;
    };
    const timeline = createTimeline(counting);
    expect(calls).toHaveLength(0);
    timeline.phaseAt(0);
    // creation is lazy; the first block draws a shuffle (5) and a wander plan.
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });
});

describe('phaseAt', () => {
  const timeline = createTimeline(zero);

  it('reports progress 0 at a phase start and the next phase at its end', () => {
    const phases = walk(zero, 14);
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i]!;
      const at = timeline.phaseAt(phase.startMs);
      expect(at.phase).toEqual(phase);
      expect(at.progress).toBe(0);
      if (i > 0) {
        const justBefore = timeline.phaseAt(phase.startMs - 0.001);
        expect(justBefore.phase).toEqual(phases[i - 1]);
        expect(justBefore.progress).toBeGreaterThan(0.999);
        expect(justBefore.progress).toBeLessThan(1);
      }
    }
  });

  it('reports progress strictly inside (0, 1) within a phase', () => {
    const { phase, progress } = timeline.phaseAt(650);
    expect(phase.kind).toBe('draw');
    expect(progress).toBe(0.5);
    expect(timeline.phaseAt(1).progress).toBeGreaterThan(0);
    expect(timeline.phaseAt(1299).progress).toBeLessThan(1);
    expect(timeline.phaseAt(1300 + 475).progress).toBe(0.25);
  });

  it('clamps negative elapsed time to 0', () => {
    const { phase, progress } = timeline.phaseAt(-5000);
    expect(phase.kind).toBe('draw');
    expect(phase.mark).toBe('lexon');
    expect(progress).toBe(0);
  });

  it('answers ten minutes of elapsed time and then earlier times again', () => {
    const tenMinutes = 10 * 60 * 1000;
    const late = timeline.phaseAt(tenMinutes);
    expect(late.progress).toBeGreaterThanOrEqual(0);
    expect(late.progress).toBeLessThan(1);
    expect(late.phase.startMs).toBeLessThanOrEqual(tenMinutes);
    expect(late.phase.startMs + late.phase.durationMs).toBeGreaterThan(
      tenMinutes,
    );
    expect(timeline.phaseAt(0).phase.kind).toBe('draw');
    expect(timeline.phaseAt(3300).phase.kind).toBe('dissolve');
  });

  it('keeps phases contiguous with no gaps over 10 minutes', () => {
    const phases = walk(createSeededRandom(2), 400);
    expect(phases[0]!.startMs).toBe(0);
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i]!.startMs).toBe(
        phases[i - 1]!.startMs + phases[i - 1]!.durationMs,
      );
    }
    const last = phases.at(-1)!;
    expect(last.startMs + last.durationMs).toBeGreaterThan(10 * 60 * 1000);
  });

  it('returns the same phase object for repeated queries (cached)', () => {
    const fresh = createTimeline(createSeededRandom(3));
    const a = fresh.phaseAt(5000).phase;
    const b = fresh.phaseAt(5001).phase;
    expect(b).toBe(a);
  });

  it('does not consume more random numbers when re-reading cached phases', () => {
    let count = 0;
    const base = createSeededRandom(4);
    const timeline2 = createTimeline(() => {
      count++;
      return base();
    });
    timeline2.phaseAt(60000);
    const after = count;
    timeline2.phaseAt(1000);
    timeline2.phaseAt(60000);
    expect(count).toBe(after);
  });

  it('extends only as far as needed', () => {
    let count = 0;
    const base = createSeededRandom(4);
    const lazy = createTimeline(() => {
      count++;
      return base();
    });
    lazy.phaseAt(0);
    const early = count;
    lazy.phaseAt(10 * 60 * 1000);
    expect(count).toBeGreaterThan(early);
    expect(early).toBeLessThan(20);
  });
});

describe('planFinish', () => {
  const total = (plan: readonly { durationMs: number }[]) =>
    plan.reduce((sum, step) => sum + step.durationMs, 0);

  it('completes and fills when already on the lexon mark', () => {
    for (const kind of ['draw', 'hold'] as const) {
      const plan = planFinish({ kind, mark: 'lexon' });
      expect(plan).toEqual([
        { kind: 'complete-draw', durationMs: 500 },
        { kind: 'fill', durationMs: 500 },
      ]);
    }
  });

  it('dissolves, settles, draws, and fills from another mark drawing or holding', () => {
    for (const mark of ALL_MARKS.slice(1)) {
      for (const kind of ['draw', 'hold'] as const) {
        expect(planFinish({ kind, mark })).toEqual([
          { kind: 'dissolve', durationMs: 800 },
          { kind: 'settle', durationMs: 1280 },
          { kind: 'draw', durationMs: 1820 },
          { kind: 'fill', durationMs: 700 },
        ]);
      }
    }
  });

  it('settles, draws, and fills from dissolve, wander, or settle', () => {
    for (const mark of ALL_MARKS) {
      for (const kind of ['dissolve', 'wander', 'settle'] as const) {
        expect(planFinish({ kind, mark })).toEqual([
          { kind: 'settle', durationMs: 1280 },
          { kind: 'draw', durationMs: 1820 },
          { kind: 'fill', durationMs: 700 },
        ]);
      }
    }
  });

  it('always ends with fill and never exceeds 4600 ms', () => {
    const kinds = ['draw', 'hold', 'dissolve', 'wander', 'settle'] as const;
    for (const mark of ALL_MARKS) {
      for (const kind of kinds) {
        const plan = planFinish({ kind, mark });
        expect(plan.at(-1)!.kind).toBe('fill');
        expect(total(plan)).toBeLessThanOrEqual(4600);
      }
    }
    expect(total(planFinish({ kind: 'hold', mark: 'paper' }))).toBe(4600);
    expect(total(planFinish({ kind: 'draw', mark: 'lexon' }))).toBe(1000);
    expect(total(planFinish({ kind: 'wander', mark: 'column' }))).toBe(3800);
  });

  it('returns a fresh plan on each call', () => {
    const a = planFinish({ kind: 'wander', mark: 'lexon' });
    const b = planFinish({ kind: 'wander', mark: 'lexon' });
    expect(a).toEqual(b);
  });
});
