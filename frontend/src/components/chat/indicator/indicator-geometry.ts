// Pure geometry for the thinking indicator: mark paths, the five dot
// patterns, easing, and seeds. No DOM, no clock, no ambient randomness.
// Everything comes from the prototype's lqMount script
// (docs/design/f4.1-prototype/source/prototype.html, LQ_SCENES and PAT).
// The sampled point tables live in indicator-points.ts, generated from the
// paths below by scripts/generate-indicator-points.mjs.
import type { MarkId, PatternId, Random } from './indicator-sequence';

export const DOT_COUNT = 26; // K

export interface MarkDef {
  id: MarkId;
  paths: readonly string[];
  strokeWidth: number;
  dim?: readonly number[];
  accent?: string;
  shimmer?: readonly number[];
  fillAfter?: boolean;
}

// Path data is the prototype's LQ_SCENES[].p, in a 20x20 viewBox. The lexon
// monogram is the brand monogram (docs/brand/lexon-2026/01_VECTOR/
// LEXON-monogram-seal.svg) scaled to that box.
export const MARKS: Record<MarkId, MarkDef> = {
  lexon: {
    id: 'lexon',
    paths: [
      'M 4.27 1.405 H 11.734 V 2.217 C 10.606 2.283 10.2 2.613 9.671 3.952 H 6.334 C 5.805 2.613 5.398 2.283 4.27 2.217 Z',
      'M 6.553 4.413 H 9.451 V 15.587 H 6.553 Z',
      'M 4.27 17.783 C 5.398 17.717 5.805 17.387 6.334 16.048 H 9.671 C 10.066 16.773 11.12 17.475 12.305 17.783 C 13.952 17.87 15.688 16.544 16.676 15.368 L 17.398 15.974 L 17.442 18.595 H 4.27 Z',
    ],
    strokeWidth: 1.1,
    fillAfter: true,
  },
  section: {
    id: 'section',
    paths: [
      'M12.6 4.6c-1.4-1.3-4.8-1-4.8 1.2 0 2.7 5.6 2.5 5.6 5.3 0 1.5-1.4 2.3-2.9 2.3',
      'M7.4 15.4c1.4 1.3 4.8 1 4.8-1.2 0-2.7-5.6-2.5-5.6-5.3 0-1.5 1.4-2.3 2.9-2.3',
    ],
    strokeWidth: 1.5,
  },
  writing: {
    id: 'writing',
    paths: [
      'M2 16.5h16',
      'M2.5 13c2-5 3.6-7.4 4.6-5.6.9 1.6-1 5-.1 5.6 1 .7 2.6-3.6 4-3.4 1.2.2.3 3 1.4 3.1 1.3.1 2.3-2.6 4.9-2.7',
    ],
    strokeWidth: 1.5,
    dim: [0],
  },
  paper: {
    id: 'paper',
    paths: [
      'M5 3h7l3 3v11H5z',
      'M12 3v3h3',
      'M7.5 9.2h5',
      'M7.5 11.7h5',
      'M7.5 14.2h3.5',
    ],
    strokeWidth: 1.5,
  },
  highlighter: {
    id: 'highlighter',
    paths: ['M3 6h14', 'M3 10h14', 'M3 14h9'],
    strokeWidth: 1.5,
    dim: [0, 1, 2],
    accent: 'M3 10h14',
  },
  column: {
    id: 'column',
    paths: [
      'M2.8 6.4 10 2.6l7.2 3.8',
      'M3.6 7.6h12.8',
      'M6.3 9.2v5.9',
      'M10 9.2v5.9',
      'M13.7 9.2v5.9',
      'M4.3 16.3h11.4',
      'M2.8 17.8h14.4',
    ],
    strokeWidth: 1.5,
    shimmer: [2, 3, 4],
  },
  pilcrow: {
    id: 'pilcrow',
    paths: ['M14 3.6v12.8', 'M11 3.6v12.8', 'M14 3.6H9.6a3.3 3.3 0 0 0 0 6.6H11'],
    strokeWidth: 1.5,
  },
};

export interface DotSeed {
  phase: number; // sd.ph
  size: number; // sd.rr
  speed: number; // sd.w
  jitter: number; // sd.j
  anchorX: number; // sd.ax
  anchorY: number; // sd.ay
}

// Array.from({length:K}, () => ({ph, rr, w, j, ax:10, ay:10})), drawn in
// that order.
export function createDotSeeds(random: Random): readonly DotSeed[] {
  return Array.from({ length: DOT_COUNT }, () => {
    const phase = random() * 6.28;
    const size = 0.75 + random() * 0.5;
    const speed = 0.8 + random() * 0.5;
    const jitter = random();
    return { phase, size, speed, jitter, anchorX: 10, anchorY: 10 };
  });
}

// reseed(): a new anchor and phase per wander, drawn ax, ay, ph per dot.
export function reseedAnchors(
  seeds: readonly DotSeed[],
  random: Random,
): readonly DotSeed[] {
  return seeds.map((seed) => {
    const anchorX = 3.5 + random() * 13;
    const anchorY = 3.5 + random() * 13;
    const phase = random() * 6.28;
    return { ...seed, anchorX, anchorY, phase };
  });
}

type Point = readonly [number, number];

export function patternPosition(
  pattern: PatternId,
  index: number,
  tSeconds: number,
  seed: DotSeed,
): Point {
  const t = tSeconds;
  switch (pattern) {
    case 'scatter':
      return [
        seed.anchorX +
          1.7 * Math.sin(t * 1.1 * seed.speed + seed.phase) +
          0.9 * Math.sin(t * 1.9 + seed.jitter * 6),
        seed.anchorY +
          1.7 * Math.cos(t * 0.9 * seed.speed + seed.phase * 1.4) +
          0.9 * Math.sin(t * 1.5 + seed.jitter * 4),
      ];
    case 'orbit': {
      const a = seed.phase + t * 2.2 * seed.speed;
      const r =
        (4.2 + 1.6 * Math.sin(index * 1.7)) *
        (1 + 0.12 * Math.sin(t * 2.1 + seed.phase));
      return [10 + r * Math.cos(a), 10 + r * Math.sin(a) * 0.92];
    }
    case 'swarm':
      return [
        10 +
          5.6 *
            Math.sin(1.1 * t * seed.speed + seed.phase) *
            Math.cos(0.6 * t + seed.jitter * 3),
        10 + 5.6 * Math.sin(1.6 * t * seed.speed + seed.phase * 1.3),
      ];
    case 'spiral': {
      const f = index / DOT_COUNT;
      const a = f * 9.5 + t * (2.4 - 1.2 * f);
      const r = 1.2 + 6.2 * f * (1 + 0.15 * Math.sin(t * 1.8));
      return [10 + r * Math.cos(a), 10 + r * Math.sin(a)];
    }
    case 'figure8': {
      const a = t * 1.6 + (index / DOT_COUNT) * 6.28;
      return [
        10 + 6 * Math.sin(a),
        10 + 3.6 * Math.sin(2 * a) + 0.6 * Math.sin(t * 3 + seed.phase),
      ];
    }
  }
}

export function blend(a: Point, b: Point, k: number): Point {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}
